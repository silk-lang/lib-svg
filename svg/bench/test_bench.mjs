// Run explicitly: node --test svg/bench/test_bench.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import { HERE, generate_icons, generators, normalize_tiger, prepare, verify_asset } from './workloads.mjs';
import { baseline_ratios, callgrind_ir, invoke, median, parse_options, sha256, validate_result, workload_hash } from './harness.mjs';
import { generate as generateImages } from './images.mjs';
import { generate as generateNested } from './nested.mjs';
import { generate as generateSampling, source as samplingSource } from './sampling.mjs';
import { generate as generateOrientation } from './svg_orientation.mjs';

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'svg-bench-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const parse = text => new DOMParser().parseFromString(text, 'application/xml');
const attributes = node => Object.fromEntries(Array.from(node.attributes).map(a => [a.name, a.value]));

test('generated icons are deterministic and distinct', () => {
  const config = { count: 8, size: 32, seed: 7 }, first = generate_icons(config);
  assert.deepEqual(first, generate_icons(config));
  assert.equal(Object.keys(first).length, 8);
  assert.equal(new Set(Object.values(first).map(data => data.toString())).size, 8);
});
test('content hashes ignore cache location but not input', t => {
  const directory = temporary(t), left = join(directory, 'left'), right = join(directory, 'right');
  mkdirSync(left); mkdirSync(right);
  const a = join(left, 'a.svg'), b = join(right, 'a.svg');
  writeFileSync(a, '<svg/>'); writeFileSync(b, '<svg/>');
  assert.equal(workload_hash([a]), workload_hash([b]));
  writeFileSync(b, '<svg ><path/></svg>');
  assert.notEqual(workload_hash([a]), workload_hash([b]));
});
test('all generated measured workloads retain historical byte hashes', t => {
  const manifest = JSON.parse(readFileSync(join(HERE, 'workloads.json'), 'utf8'));
  const baseline = JSON.parse(readFileSync(join(HERE, 'baseline.json'), 'utf8'));
  const directory = temporary(t);
  assert.equal(sha256(join(HERE, manifest.generator)), manifest.generator_sha256);
  assert.equal(sha256(join(HERE, 'workloads.json')), baseline.workload_manifest_sha256);
  for (const [name, generate] of Object.entries(generators)) {
    const files = generate(manifest.workloads[name].config);
    assert.deepEqual(files, generate(manifest.workloads[name].config), name);
    const paths = Object.entries(files).map(([filename, data]) => {
      const path = join(directory, filename); writeFileSync(path, data); return path;
    });
    assert.ok(paths.length > 0, name);
    if (baseline.workloads[name]) {
      assert.equal(workload_hash(paths), baseline.workloads[name].sha256, name);
      assert.equal(Object.values(files).reduce((n, data) => n + data.length, 0), baseline.workloads[name].bytes, name);
    }
  }
});
test('preparation replaces mutated deterministic cache content and honors selection', async t => {
  const directory = temporary(t), manifest = JSON.parse(readFileSync(join(HERE, 'workloads.json'), 'utf8'));
  const first = await prepare(manifest, directory, false, ['iconset']);
  assert.deepEqual(Object.keys(first), ['iconset']);
  const original = readFileSync(first.iconset[0]);
  writeFileSync(first.iconset[0], '<svg/>');
  await prepare(manifest, directory, false, ['iconset']);
  assert.deepEqual(readFileSync(first.iconset[0]), original);
  await assert.rejects(prepare(manifest, directory, false, ['tiger']), /--fetch-tiger/);
});
test('Tiger rejects modified downloads and incorrect byte counts', () => {
  assert.throws(() => verify_asset(Buffer.from('not the tiger'), { sha256: '0'.repeat(64), bytes: 13 }), /SHA-256/);
  const data = Buffer.from('pinned'), sha256 = createHash('sha256').update(data).digest('hex');
  assert.throws(() => verify_asset(data, { sha256, bytes: 1 }), /byte count/);
});
test('Tiger viewport normalization preserves geometry, paint, text, and historical serialization', () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900" id="root"><g transform="matrix(2,0,0,2,3,4)" fill="#ffc" stroke="#000"><path id="shape" d="M1 2C3 4 5 6 7 8Z" stroke-width="0.17200001"/></g></svg>';
  const config = { viewBox: '0 0 900 900', width: 900, height: 900 };
  const original = parse(source).documentElement, data = normalize_tiger(Buffer.from(source), config), sized = parse(data.toString()).documentElement;
  assert.equal(sized.tagName, original.tagName);
  assert.deepEqual(attributes(sized), { ...attributes(original), width: '900', height: '900' });
  const descendants = root => Array.from(root.getElementsByTagName('*')).map(node => ({ tag: node.tagName, attributes: attributes(node), text: node.textContent }));
  assert.deepEqual(descendants(sized), descendants(original));
  assert.equal(data.toString(), "<?xml version='1.0' encoding='utf-8'?>\n" + source.replace('id="root"', 'id="root" width="900" height="900"').replace('/>', ' />'));
  assert.throws(() => normalize_tiger(Buffer.from(source), { ...config, viewBox: '0 0 1 1' }), /viewBox/);
});
test('Callgrind uses the named Ir event column', () => {
  assert.equal(callgrind_ir('events: Dr Ir Dw\nsummary: 9 123456 8\n'), 123456);
  assert.throws(() => callgrind_ir('events: Dr Dw\nsummary: 9 8\n'), /Ir/);
});
test('baseline rejects different measured work', () => {
  const current = { protocol: 1, config: { iterations: 3 }, workloads: { map: { sha256: 'a' } }, results: {} };
  assert.throws(() => baseline_ratios(current, { ...current, workloads: { map: { sha256: 'b' } } }), /workloads/);
});
test('baseline ratio is current/previous and retains legacy timer compatibility', () => {
  const common = { protocol: 1, config: { iterations: 3 }, workloads: { map: { sha256: 'a' } } };
  const current = { ...common, results: { silk: { 'map/render': { median_ns: 150 } } } };
  const baseline = { ...common, results: { silk: { 'map/render': { median_ns: 100 } } } };
  assert.deepEqual(baseline_ratios(current, baseline), { silk: { 'map/render': 1.5 } });
  current.config = { ...current.config, timer: 'native monotonic wall clock; Node process.hrtime.bigint separately records process wall time' };
  baseline.config = { ...baseline.config, timer: 'native monotonic wall clock; Python perf_counter_ns separately records process wall time' };
  assert.deepEqual(baseline_ratios(current, baseline), { silk: { 'map/render': 1.5 } });
  assert.throws(() => baseline_ratios(current, { ...baseline, results: { silk: {} } }), /stages/);
});
test('native protocol validates full-width counters without floating-point truncation', () => {
  const args = { iterations: 5, warmup: 1 };
  const checksum = 2n ** 64n - 1n;
  const result = { protocol: 1, ...args, elapsed_ns: 1, width: 1, height: 1, checksum: String(checksum), consumed: String(BigInt.asUintN(64, checksum * 6n)) };
  assert.equal(validate_result(result, args), result);
  assert.throws(() => validate_result({ ...result, consumed: '0' }, args), /outputs changed/);
  assert.throws(() => validate_result({ ...result, elapsed_ns: 0 }, args), /measurement/);
  assert.throws(() => validate_result({ ...result, checksum: Number(checksum) }, args), /checksum/);
});
test('native invocation passes protocol arguments and reports process wall time', t => {
  const directory = temporary(t), script = join(directory, 'protocol.mjs');
  writeFileSync(script, `const [mode, path, iterations, warmup] = process.argv.slice(2);\nif (mode !== 'render' || path !== 'input.svg') process.exit(2);\nconsole.log(JSON.stringify({protocol:1, iterations:Number(iterations), warmup:Number(warmup), elapsed_ns:123, width:2, height:3, checksum:'1', consumed:String(Number(iterations)+Number(warmup))}));\n`);
  const [result, wall] = invoke(script, 'render', 'input.svg', { iterations: 3, warmup: 1, timeout: 10 }, [process.execPath]);
  assert.equal(result.elapsed_ns, 123); assert.ok(wall > 0);
});
test('CLI repeated flags and median aggregation retain their meaning', () => {
  const { args } = parse_options({ iterations: { type: 'string' }, mode: { type: 'string', multiple: true }, 'fetch-workloads': { type: 'boolean' } }, { argv: ['--iterations', '3', '--mode', 'parse', '--mode', 'render', '--fetch-workloads'] });
  assert.deepEqual(args, { iterations: 3, mode: ['parse', 'render'], fetch_workloads: true });
  assert.equal(median([9, 1, 2]), 2); assert.equal(median([9, 1, 2, 4]), 3);
});
test('nested and orientation generators retain all independently authored controls', t => {
  const directory = temporary(t), nested = join(directory, 'nested'), orientation = join(directory, 'orientation');
  generateNested(nested); generateOrientation(orientation);
  assert.deepEqual(readdirSync(nested).sort(), ['embedded-shared.svg', 'embedded-single.svg', 'embedded-viewports.svg', 'inline-shared.svg', 'inline-single.svg', 'inline-viewports.svg']);
  const varied = parse(readFileSync(join(nested, 'embedded-viewports.svg'), 'utf8')).getElementsByTagName('image');
  assert.equal(varied.length, 16); assert.equal(varied[15].getAttribute('width'), '23');
  assert.deepEqual(readdirSync(orientation).sort(), ['control-1.svg', 'control-16.svg', 'none-1.svg', 'none-16.svg', 'rotate-1.svg', 'rotate-16.svg']);
  const image = parse(readFileSync(join(orientation, 'control-1.svg'), 'utf8')).getElementsByTagName('image')[0];
  const embedded = parse(Buffer.from(image.getAttribute('href').split(',')[1], 'base64').toString());
  assert.deepEqual(Array.from(embedded.getElementsByTagName('rect')).map(node => node.getAttribute('fill')), ['magenta', 'blue', 'red', 'yellow', 'cyan', 'lime']);
});
test('sampling generator keeps six cases and independently expanded RGB pixels', t => {
  const directory = temporary(t); generateSampling(directory);
  assert.equal(readdirSync(directory).length, 6);
  const data = Buffer.from(samplingSource(3, 2).split(',')[1], 'base64');
  assert.equal(data.readUInt32BE(16), 48); assert.equal(data.readUInt32BE(20), 32);
  const chunks = [];
  for (let offset = 8; offset < data.length;) {
    const length = data.readUInt32BE(offset);
    if (data.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(data.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const pixels = inflateSync(Buffer.concat(chunks)), stride = 48 * 3 + 1;
  assert.deepEqual([...pixels.subarray(1, 10)], [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...pixels.subarray(10, 13)], [17, 0, 31]);
  assert.deepEqual(pixels.subarray(0, stride), pixels.subarray(stride, stride * 2));
});
test('image generation produces grayscale PNG/JPEG workloads with one and 64 placements', async t => {
  const directory = temporary(t); await generateImages(directory);
  assert.deepEqual(readdirSync(directory).sort(), ['jpeg-1.svg', 'jpeg-64.svg', 'png-1.svg', 'png-64.svg']);
  for (const kind of ['jpeg', 'png']) for (const count of [1, 64]) {
    const document = parse(readFileSync(join(directory, `${kind}-${count}.svg`), 'utf8'));
    const images = Array.from(document.getElementsByTagName('image'));
    assert.equal(images.length, count);
    assert.equal(new Set(images.map(image => image.getAttribute('href'))).size, 1);
    const bytes = Buffer.from(images[0].getAttribute('href').split(',')[1], 'base64');
    if (kind === 'png') { assert.equal(bytes.readUInt32BE(16), 512); assert.equal(bytes.readUInt32BE(20), 384); assert.equal(bytes[25], 0); }
    else assert.deepEqual([...bytes.subarray(0, 2)], [255, 216]);
  }
});
