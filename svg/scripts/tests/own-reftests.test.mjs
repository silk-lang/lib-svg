// Manifest boundaries; actual renderer acceptance belongs to reftests, not these fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadOwnManifest, OWN_FIXTURES } from '../svg_reftests.mjs';

const SPEC = 'https://www.w3.org/TR/2018/CR-SVG2-20181004/shapes.html#RectElement';
function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'svg-own-test-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'fixtures'); fs.mkdirSync(root);
  const manifest = path.join(root, 'manifest.json');
  for (const name of ['input.svg', 'reference.svg']) fs.writeFileSync(path.join(root, name), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>');
  const entry = { id: 'rectangle', input: 'input.svg', references: [{ path: 'reference.svg', relation: '==' }], status: 'pass', reason: 'Equivalent geometry', spec: SPEC, tolerance: {} };
  return { root, manifest, entry, load(malformed = false, cases = [entry]) {
    fs.writeFileSync(manifest, JSON.stringify({ version: 1, suite: 'own', mode: malformed ? 'malformed' : 'reference', cases }));
    return loadOwnManifest(manifest, malformed);
  } };
}
test('rejects traversal, absolute and symlink paths in inputs, references and IDs', t => {
  const f = fixture(t); const outside = path.join(path.dirname(f.root), 'outside.svg'); fs.writeFileSync(outside, 'outside');
  fs.symlinkSync(outside, path.join(f.root, 'escape.svg'));
  for (const name of ['../outside.svg', outside, 'escape.svg', 'a/../../outside.svg', 'a\\outside.svg']) for (const field of ['input', 'reference', 'id']) {
    const entry = structuredClone(f.entry);
    if (field === 'reference') entry.references[0].path = name; else entry[field] = name;
    assert.throws(() => f.load(false, [entry]));
  }
});
test('missing and unlisted files fail', t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.root, 'reference.svg'));
  assert.throws(() => f.load(), /missing/);
  fs.writeFileSync(path.join(f.root, 'reference.svg'), '<svg/>'); fs.writeFileSync(path.join(f.root, 'unlisted.svg'), '<svg/>');
  assert.throws(() => f.load(), /unlisted/);
});
test('SVGZ inputs preserve complete manifest coverage', t => {
  const f = fixture(t); fs.renameSync(path.join(f.root, 'input.svg'), path.join(f.root, 'input.svgz')); f.entry.input = 'input.svgz';
  assert.equal(f.load()[1][0].input, 'input.svgz');
  fs.writeFileSync(path.join(f.root, 'unlisted.svgz'), 'gzip fixture'); assert.throws(() => f.load(), /unlisted/);
});
test('invalid tolerances fail during validation', t => {
  const f = fixture(t);
  for (const tolerance of [{ channel: -1 }, { channel: 256 }, { pixels: -1 }, { pixels: true }, { pixels: 1.5 }, { channel: 1 }, { unknown: 0 }, [], null, { channel: null, reason: 'invalid' }]) {
    f.entry.tolerance = tolerance; assert.throws(() => f.load());
  }
});
test('arguments must be arrays of renderer option strings', t => {
  const f = fixture(t); f.entry.arguments = ['--time', '1s']; assert.deepEqual(f.load()[1][0].arguments, ['--time', '1s']);
  for (const args of ['--time 1s', [1], { time: '1s' }, null]) { f.entry.arguments = args; assert.throws(() => f.load(), /arguments/); }
});
test('ordinary cases cannot hide failures', t => {
  const f = fixture(t);
  for (const status of ['skip', 'fail', 'spec-difference']) { f.entry.status = status; assert.throws(() => f.load()); }
});
test('malformed requires exact CLI rejection contract', t => {
  const f = fixture(t); delete f.entry.references; fs.unlinkSync(path.join(f.root, 'reference.svg'));
  for (const [code, presence] of [[-11, false], [2, false], [1, true], [0, false], [true, false]]) {
    Object.assign(f.entry, { exit_code: code, output_present: presence }); assert.throws(() => f.load(true));
  }
  Object.assign(f.entry, { exit_code: 1, output_present: false }); assert.equal(f.load(true)[1][0].exit_code, 1);
});
test('successful malformed recovery must have references and cannot reference itself', t => {
  const f = fixture(t); Object.assign(f.entry, { exit_code: 0, output_present: true });
  assert.equal(f.load(true)[1][0].references.length, 1);
  f.entry.references = []; assert.throws(() => f.load(true), /missing references/);
  f.entry.references = [{ path: 'input.svg', relation: '==' }]; assert.throws(() => f.load(true), /itself/);
});
test('manifest rejects duplicate IDs, inputs and invalid references', t => {
  const f = fixture(t); assert.throws(() => f.load(false, [f.entry, f.entry]), /duplicate own case/);
  assert.throws(() => f.load(false, [f.entry, { ...f.entry, id: 'other' }]), /duplicate own input/);
  for (const references of [null, {}, [{ path: 'reference.svg', relation: 'unknown' }], [{ path: 'image.jpg', relation: '==' }]]) {
    f.entry.references = references; assert.throws(() => f.load());
  }
});
test('tracked own and malformed manifests retain complete fixture coverage', () => {
  for (const [folder, malformed] of [['own', false], ['malformed', true]]) {
    const [, cases, expectations] = loadOwnManifest(path.join(OWN_FIXTURES, folder, 'manifest.json'), malformed);
    assert.ok(cases.length); assert.equal(Object.keys(expectations).length, cases.length);
  }
});
