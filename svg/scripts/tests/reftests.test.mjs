// Synthetic pixels test the adapter, not an SVG renderer or SVG conformance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';
import * as reftests from '../svg_reftests.mjs';

const SVG = 'https://www.w3.org/TR/2018/CR-SVG2-20181004/render.html#RenderingOrder';
const emptySvg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
const pixel = values => [1, 1, Buffer.from(values)];
const expectation = status => ({ id: 'a', status, reason: 'Adapter test, not conformance', spec: SVG });
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'svg-reftests-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root;
}
function png(name, values = [3, 5, 7, 9]) { fs.writeFileSync(name, PNG.sync.write({ width: 1, height: 1, data: Buffer.from(values) })); }
const nodeCommand = script => [process.execPath, '-e', script, '--', '{input}', '{output}'];

test('tolerances bound channels and pixel count', () => {
  const a = Buffer.from([10, 20, 30, 255, 10, 20, 30, 255]); const b = Buffer.from([12, 20, 30, 255, 10, 24, 30, 255]);
  const result = reftests.compareRgba([2, 1, a], [2, 1, b], 2, 0);
  assert.equal(result.match, false); assert.equal(result.different_pixels, 1); assert.equal(result.max_channel_difference, 4);
  assert.equal(reftests.compareRgba([2, 1, a], [2, 1, b], 2, 1).match, true);
});
test('dimensions, alpha and RGBA buffer length are compared', () => {
  assert.equal(reftests.compareRgba([1, 1, Buffer.alloc(4)], [2, 1, Buffer.alloc(8)]).match, false);
  assert.equal(reftests.compareRgba(pixel([0, 0, 0, 0]), pixel([0, 0, 0, 1])).match, false);
  assert.throws(() => reftests.compareRgba([1, 1, Buffer.alloc(3)], pixel([0, 0, 0, 0])), /buffer length/);
});
test('antialias tolerance preserves opaque and transparent samples', () => {
  const compared = (a, b) => reftests.compareRgba(pixel(a), pixel(b), 0, 0, 80).match;
  assert.equal(compared([32, 64, 128, 100], [32, 64, 128, 180]), true);
  for (const [a, b] of [[[32, 64, 128, 100], [32, 64, 128, 181]], [[32, 64, 128, 255], [33, 64, 128, 255]], [[32, 64, 128, 0], [32, 64, 128, 1]], [[32, 64, 128, 254], [32, 64, 128, 255]]]) assert.equal(compared(a, b), false);
});
test('unexpected pass and failure are gate failures', () => {
  assert.equal(reftests.outcome('fail', true), 'unexpected-pass'); assert.equal(reftests.outcome('pass', false), 'unexpected-fail');
  assert.equal(reftests.outcome('spec-difference', true), 'unexpected-pass'); assert.equal(reftests.outcome('spec-difference', false), 'spec-difference');
  assert.throws(() => reftests.outcome('skip', true));
});
test('expectations require reasons, tolerance rationale and normative anchors', () => {
  const entry = { id: 'a', status: 'fail', spec: SVG }; assert.throws(() => reftests.validateExpectation(entry), /reason/);
  Object.assign(entry, { reason: 'Known shape discrepancy', status: 'pass', tolerance: { channel: 2, pixels: 1 } });
  assert.throws(() => reftests.validateExpectation(entry), /reason/);
  delete entry.tolerance;
  for (const spec of ['http://example.org/#a', 'https://example.org/', 'https://example.org/#']) { entry.spec = spec; assert.throws(() => reftests.validateExpectation(entry), /anchor/); }
});
test('spec difference requires both observed results', () => {
  const entry = expectation('spec-difference'); assert.throws(() => reftests.validateExpectation(entry), /spec_result/);
  entry.spec_result = 'red'; assert.throws(() => reftests.validateExpectation(entry), /reference_result/);
  entry.reference_result = 'blue'; reftests.validateExpectation(entry);
});
test('expectation loading rejects duplicate IDs and wrong suite', t => {
  const name = path.join(temporary(t), 'expectations.json');
  fs.writeFileSync(name, JSON.stringify({ version: 1, suite: 'wpt', cases: [expectation('pass'), expectation('pass')] }));
  assert.throws(() => reftests.loadExpectations(name, 'wpt'), /duplicate/); assert.throws(() => reftests.loadExpectations(name, 'resvg'), /mismatch/);
});
test('WPT standalone references and script boundary', t => {
  const root = temporary(t); const name = path.join(root, 'test.svg'); fs.writeFileSync(path.join(root, 'ref.svg'), emptySvg);
  fs.writeFileSync(name, '<svg xmlns="http://www.w3.org/2000/svg"><link xmlns="http://www.w3.org/1999/xhtml" rel="match" href="ref.svg"/></svg>');
  assert.deepEqual(reftests.wptCases(root)[0].references, [{ path: 'ref.svg', relation: '==' }]);
  fs.writeFileSync(name, '<svg xmlns="http://www.w3.org/2000/svg" onload="run()"><link rel="match" href="ref.svg"/></svg>');
  assert.match(reftests.wptCases(root)[0].skip_reason, /script/);
});
test('WPT external references are never fetched or allowed to escape', t => {
  const root = temporary(t); const name = path.join(root, 'test.svg');
  for (const [href, reason] of [['../escape.svg', /outside/], ['%2e%2e/escape.svg', /outside/], ['https://example.org/ref.svg', /external/], ['//example.org/ref.svg', /external/], ['ref.svg?q', /query/], ['ref.svg#id', /fragment/], ['bad%5cpath.svg', /invalid/], ['missing.svg', /absent/]]) {
    fs.writeFileSync(name, `<svg xmlns="http://www.w3.org/2000/svg"><link rel="match" href="${href}"/></svg>`);
    assert.match(reftests.wptCases(root)[0].skip_reason, reason);
  }
});
test('WPT rejects DTD, scripts, foreignObject, wait classes, malformed XML and HTML layout', t => {
  const root = temporary(t); fs.writeFileSync(path.join(root, 'ref.svg'), emptySvg); const name = path.join(root, 'test.svg');
  const link = '<link rel="match" href="ref.svg"/>';
  for (const [text, reason] of [
    [`<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg">${link}</svg>`, /DTD/],
    [`<svg xmlns="http://www.w3.org/2000/svg"><script/>${link}</svg>`, /script/],
    [`<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/>${link}</svg>`, /foreignObject/],
    [`<svg xmlns="http://www.w3.org/2000/svg" class="reftest-wait">${link}</svg>`, /wait/],
    [`<svg xmlns="http://www.w3.org/2000/svg">${link}<g></svg>`, /./],
    [`<html>${link}</html>`, /non-SVG/],
  ]) { fs.writeFileSync(name, text); assert.match(reftests.wptCases(root)[0].skip_reason, reason); }
  fs.unlinkSync(name); fs.writeFileSync(path.join(root, 'test.html'), `<html>${link}</html>`); assert.match(reftests.wptCases(root)[0].skip_reason, /HTML layout/);
});
test('WPT scopes a full tree, keeps resources and supports encoded/root references', t => {
  const root = temporary(t); fs.mkdirSync(path.join(root, 'svg')); fs.mkdirSync(path.join(root, 'resources')); fs.mkdirSync(path.join(root, 'outside'));
  fs.writeFileSync(path.join(root, 'resources', 'a b.svg'), emptySvg);
  const text = '<svg xmlns="http://www.w3.org/2000/svg"><link rel="mismatch" href="/resources/a%20b.svg"/></svg>';
  fs.writeFileSync(path.join(root, 'svg', 'test.svg'), text); fs.writeFileSync(path.join(root, 'outside', 'test.svg'), text);
  const cases = reftests.wptCases(root); assert.equal(cases.length, 1); assert.deepEqual(cases[0].references, [{ path: 'resources/a b.svg', relation: '!=' }]);
});
test('renderer argv requires placeholders without shell splitting', () => {
  assert.deepEqual(reftests.rendererArgv(['renderer', '{input}', '-o', '{output}'], 'a b.svg', 'out.png'), ['renderer', 'a b.svg', '-o', 'out.png']);
  assert.deepEqual(reftests.rendererArgv(['r', '{input}', '-o', '{output}', '--resources-dir', '{root}'], 'a.svg', 'o.png', '/suite'), ['r', 'a.svg', '-o', 'o.png', '--resources-dir', '/suite']);
  for (const command of [['renderer'], 'renderer', [], [1]]) assert.throws(() => reftests.rendererArgv(command, 'a.svg', 'out.png'));
});
test('renderer errors never count as expected pixel failures', async t => {
  const entry = { id: 'a', input: 'a.svg', references: [{ path: 'a.png', relation: '==' }] };
  const result = await reftests.runCase(entry, expectation('fail'), temporary(t), ['renderer', '{input}', '{output}'], 1, null, async () => { throw new Error('renderer exited 1'); });
  assert.equal(result.outcome, 'error'); assert.equal(result.rendered, false);
});
test('skip does not invoke renderer', async () => {
  const result = await reftests.runCase({ id: 'a' }, expectation('skip'), '.', [], 1, null, () => assert.fail('renderer forbidden'));
  assert.equal(result.rendered, false); assert.equal(result.outcome, 'skip');
});
test('oversized PNG is a controlled harness error before decoder allocation', t => {
  const name = path.join(temporary(t), 'oversized.png'); png(name);
  const bytes = fs.readFileSync(name); bytes.writeUInt32BE(16000001, 16); fs.writeFileSync(name, bytes);
  assert.throws(() => reftests.readPng(name), /PNG exceeds/);
});
test('PNG decode compares exact RGBA samples and rejects other formats', t => {
  const name = path.join(temporary(t), 'sample.png'); png(name);
  assert.deepEqual(reftests.readPng(name), pixel([3, 5, 7, 9]));
  fs.writeFileSync(name, 'not PNG'); assert.throws(() => reftests.readPng(name), /not PNG/);
});
test('white viewport composites alpha at top left and crops oversized inputs', () => {
  assert.deepEqual(reftests.onWhite(pixel([0, 128, 255, 128]), [2, 1]), [2, 1, Buffer.from([127, 191, 255, 255, 255, 255, 255, 255])]);
  assert.deepEqual(reftests.onWhite([2, 1, Buffer.from([3, 5, 7, 255, 1, 2, 3, 255])], [1, 1]), pixel([3, 5, 7, 255]));
});
test('diff highlights alpha differences in magenta and does not resize images', t => {
  const name = path.join(temporary(t), 'diff', 'a.png'); reftests.writeDiff(pixel([1, 2, 3, 0]), pixel([1, 2, 3, 1]), name);
  assert.deepEqual(reftests.readPng(name), pixel([255, 0, 255, 255])); fs.unlinkSync(name);
  reftests.writeDiff(pixel([1, 2, 3, 255]), [2, 1, Buffer.alloc(8)], name); assert.equal(fs.existsSync(name), false);
});
test('WPT alternatives require one equality and every inequality; options apply only to input', async t => {
  const root = temporary(t); const calls = [];
  const entry = { id: 'a', input: 'a.svg', arguments: ['--time', '1s'], references: [{ path: 'different.svg', relation: '==' }, { path: 'same.svg', relation: '==' }, { path: 'different.svg', relation: '!=' }] };
  const renderer = async (argv, source) => { calls.push(argv); return pixel([path.basename(source) === 'different.svg' ? 1 : 0, 0, 0, 255]); };
  const result = await reftests.runCase(entry, expectation('pass'), root, ['r'], 1, null, renderer);
  assert.equal(result.outcome, 'pass'); assert.deepEqual(calls, [['r', '--time', '1s'], ['r'], ['r'], ['r']]);
  entry.references.push({ path: 'same.svg', relation: '!=' });
  assert.equal((await reftests.runCase(entry, expectation('pass'), root, ['r'], 1, null, renderer)).outcome, 'unexpected-fail');
});
test('unexpected failures write opt-in diffs while expected failures do not', async t => {
  const root = temporary(t); const diffs = path.join(root, 'diff'); const entry = { id: 'nested/a', input: 'a.svg', references: [{ path: 'ref.svg', relation: '==' }] };
  const renderer = async (_, source) => pixel([path.basename(source) === 'a.svg' ? 0 : 9, 0, 0, 255]);
  assert.equal((await reftests.runCase(entry, expectation('fail'), root, [], 1, diffs, renderer)).outcome, 'fail'); assert.equal(fs.existsSync(diffs), false);
  assert.equal((await reftests.runCase(entry, expectation('pass'), root, [], 1, diffs, renderer)).outcome, 'unexpected-fail');
  assert.deepEqual(reftests.readPng(path.join(diffs, 'nested/a-0.png')), pixel([9, 0, 0, 255]));
});
test('renderer process errors, missing output and timeouts are controlled', async t => {
  const root = temporary(t); const input = path.join(root, 'a.svg'); const output = path.join(root, 'out.png'); fs.writeFileSync(input, emptySvg);
  await assert.rejects(reftests.render(nodeCommand('process.exit(2)'), input, output, 3), /exited 2/);
  await assert.rejects(reftests.render(nodeCommand(''), input, output, 3), /did not produce/);
  await assert.rejects(reftests.render(nodeCommand('setInterval(()=>{},1000)'), input, output, 0.05), /timed out/);
});
test('malformed rejection accepts only exit one with no output', async t => {
  const root = temporary(t); fs.writeFileSync(path.join(root, 'a.svg'), '<svg');
  const entry = { ...expectation('pass'), input: 'a.svg', exit_code: 1, output_present: false };
  for (const [script, expected] of [['process.exit(1)', 'pass'], ['process.exit(2)', 'error'], ['process.kill(process.pid,"SIGTERM")', 'error'], ['require("node:fs").writeFileSync(process.argv[2],"bad");process.exit(1)', 'error']]) {
    const result = await reftests.runMalformedCase(entry, root, nodeCommand(script), 3); assert.equal(result.outcome, expected); assert.equal(result.rendered, false);
  }
});
test('malformed prefix recovery compares pixels, not only output presence', async t => {
  const root = temporary(t); fs.writeFileSync(path.join(root, 'a.svg'), '<svg'); png(path.join(root, 'ref.png'));
  const body = fs.readFileSync(path.join(root, 'ref.png')).toString('base64');
  const entry = { ...expectation('pass'), input: 'a.svg', references: [{ path: 'ref.png', relation: '==' }], exit_code: 0, output_present: true };
  const result = await reftests.runMalformedCase(entry, root, nodeCommand(`require('node:fs').writeFileSync(process.argv[2],Buffer.from('${body}','base64'))`), 3);
  assert.equal(result.outcome, 'pass'); assert.equal(result.rendered, true); assert.equal(result.expected_exit_code, 0);
  assert.equal((await reftests.runMalformedCase(entry, root, nodeCommand('require("node:fs").writeFileSync(process.argv[2],"not PNG")'), 3)).outcome, 'error');
});
test('resvg and W3C discovery retain missing-reference cases', t => {
  const root = temporary(t); fs.mkdirSync(path.join(root, 'svg')); fs.writeFileSync(path.join(root, 'svg', 'a.svg'), emptySvg);
  assert.match(reftests.discoverCases(root, 'w3c-svg11', {}, true)[0].skip_reason, /no PNG/);
  fs.mkdirSync(path.join(root, 'png')); png(path.join(root, 'png', 'a.png'));
  assert.equal(reftests.discoverCases(root, 'w3c-svg11', {}, true)[0].skip_reason, undefined);
  const source = path.join(root, 'crates/resvg/tests/tests'); fs.mkdirSync(source, { recursive: true }); fs.writeFileSync(path.join(source, 'a.svg'), emptySvg); png(path.join(source, 'a.png'));
  assert.equal(reftests.discoverCases(root, 'resvg', {}, true)[0].id, 'a');
  assert.deepEqual(reftests.discoverCases(root, 'resvg', { suites: { resvg: { curated: [{ id: 'a', files: [{ path: 'a.svg' }, { path: 'a.png' }] }] } } }, false), [{ id: 'a', input: 'a.svg', references: [{ path: 'a.png', relation: '==' }] }]);
});
test('Node CLI validation report preserves counts and validates without renderer', t => {
  const root = temporary(t); fs.writeFileSync(path.join(root, 'a.svg'), emptySvg); fs.writeFileSync(path.join(root, 'ref.svg'), emptySvg);
  const manifest = path.join(root, 'manifest.json'); const report = path.join(root, 'reports', 'result.json');
  fs.writeFileSync(manifest, JSON.stringify({ version: 1, suite: 'own', mode: 'reference', cases: [{ ...expectation('pass'), input: 'a.svg', references: [{ path: 'ref.svg', relation: '==' }] }] }));
  const command = fileURLToPath(new URL('../reftests', import.meta.url));
  const result = spawnSync(process.execPath, [command, '--suite', 'own', '--manifest', manifest, '--validate', '--report', report], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.mode, 'validate-only'); assert.equal(parsed.rendered_cases, 0); assert.equal(parsed.passed_cases, 0); assert.equal(parsed.failed_cases, 0); assert.equal(parsed.gate_failures, 0);
  assert.equal(parsed.results[0].outcome, 'validated'); assert.equal(fs.readFileSync(report, 'utf8'), result.stdout);
});
