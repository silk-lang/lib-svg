// Baseline integrity, not renderer conformance: svg/SPECIFICATIONS.md#baseline-integrity.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as specs from '../fetch-specs.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'svg-specs-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const lock = path.join(root, 'specs.lock.json'); const cache = path.join(root, 'cache');
  const url = 'https://example.org/spec/'; const urls = { spec: url }; const body = Buffer.from("<html id='conformance'>Normative fixture</html>");
  const record = { url, resolved: url + 'index.html', sha256: specs.digest(body) };
  const downloader = async () => [record.resolved, body];
  const sync = options => specs.synchronize(lock, cache, urls, { downloader, ...options });
  return { root, lock, cache, url, urls, body, record, sync, establish: () => sync({ update: true }), cached: specs.cachePath(cache, record) };
}
const forbidden = () => assert.fail('network forbidden');

test('initial baseline requires explicit update', async t => {
  const f = fixture(t); await assert.rejects(f.sync(), /--update/); assert.equal(fs.existsSync(f.lock), false);
});
test('update records original and resolved URLs and real digest', async t => {
  const f = fixture(t); await f.establish();
  assert.deepEqual(JSON.parse(fs.readFileSync(f.lock)), { format: 1, specs: { spec: f.record } });
  assert.deepEqual(fs.readFileSync(f.cached), f.body);
});
test('offline verifies without network or rewriting lock', async t => {
  const f = fixture(t); await f.establish(); const before = fs.readFileSync(f.lock);
  await f.sync({ offline: true, downloader: forbidden }); assert.deepEqual(fs.readFileSync(f.lock), before);
});
test('missing offline document fails closed', async t => {
  const f = fixture(t); await f.establish(); fs.unlinkSync(f.cached);
  await assert.rejects(f.sync({ offline: true, downloader: forbidden }), /missing.*offline/);
});
test('corrupt cache is not silently replaced', async t => {
  const f = fixture(t); await f.establish(); fs.writeFileSync(f.cached, 'corruption');
  await assert.rejects(f.sync({ downloader: forbidden }), /SHA-256/);
  assert.equal(fs.readFileSync(f.cached, 'utf8'), 'corruption');
});
test('changed upstream cannot change lock or populate cache', async t => {
  const f = fixture(t); await f.establish(); const before = fs.readFileSync(f.lock); fs.unlinkSync(f.cached);
  await assert.rejects(f.sync({ downloader: async () => [f.record.resolved, Buffer.from('new draft')] }), /SHA-256/);
  assert.deepEqual(fs.readFileSync(f.lock), before); assert.equal(fs.existsSync(f.cached), false);
});
test('missing cache fetches pinned bytes without changing baseline', async t => {
  const f = fixture(t); await f.establish(); const before = fs.readFileSync(f.lock); fs.unlinkSync(f.cached);
  await f.sync({ downloader: async () => [f.url + 'new-location', f.body] });
  assert.deepEqual(fs.readFileSync(f.lock), before); assert.deepEqual(fs.readFileSync(f.cached), f.body);
});
test('failed update preserves previous lock and baseline cache', async t => {
  const f = fixture(t); await f.establish(); const before = fs.readFileSync(f.lock);
  await assert.rejects(f.sync({ update: true, downloader: async () => { throw new Error('unreachable'); } }), /unreachable/);
  assert.deepEqual(fs.readFileSync(f.lock), before); assert.deepEqual(fs.readFileSync(f.cached), f.body);
});
test('update and offline are mutually exclusive', async t => {
  await assert.rejects(fixture(t).sync({ update: true, offline: true }), /--update.*--offline/);
});
test('catalog changes require explicit update', async t => {
  const f = fixture(t); await f.establish(); f.urls.another = f.url;
  await assert.rejects(f.sync(), /catalog.*--update/);
});
test('malformed hash is rejected before cache access', async t => {
  const f = fixture(t); await f.establish(); const baseline = JSON.parse(fs.readFileSync(f.lock)); baseline.specs.spec.sha256 = '../escape';
  fs.writeFileSync(f.lock, JSON.stringify(baseline)); await assert.rejects(f.sync(), /invalid.*SHA-256/);
});
test('only verifies selected documents', async t => {
  const f = fixture(t); await f.establish(); f.urls.uncached = 'https://example.org/uncached/';
  const baseline = JSON.parse(fs.readFileSync(f.lock)); baseline.specs.uncached = { url: f.urls.uncached, resolved: f.urls.uncached, sha256: specs.digest('uncached') };
  fs.writeFileSync(f.lock, JSON.stringify(baseline));
  assert.equal(await f.sync({ offline: true, only: ['spec'], downloader: forbidden }), 1);
});
test('unknown selection is an error', async t => {
  await assert.rejects(fixture(t).sync({ only: ['typo'] }), /unknown specification/);
});
test('update requires complete catalog', async t => {
  await assert.rejects(fixture(t).sync({ update: true, only: ['spec'] }), /--update.*--only/);
});
test('complete Node catalog matches tracked specification lock', () => {
  const records = specs.loadLock(specs.LOCK, specs.URLS);
  assert.deepEqual(Object.keys(records).sort(), Object.keys(specs.URLS).sort());
});
test('concurrent failures preserve lock and report all failed documents', async t => {
  const f = fixture(t); await f.establish(); const before = fs.readFileSync(f.lock);
  f.urls.second = 'https://example.org/second';
  await assert.rejects(f.sync({ update: true, downloader: async url => { throw new Error(url); } }), error => error.message.includes(f.url) && error.message.includes(f.urls.second));
  assert.deepEqual(fs.readFileSync(f.lock), before);
});
