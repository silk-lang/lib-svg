// Provenance/security policy: SVG2 conform.html#secure-static-mode; no renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import tar from 'tar-stream';
import * as suites from '../svg_suites.mjs';

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'svg-suites-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root;
}
async function archive(root, entries, gzip = false) {
  const pack = tar.pack();
  for (const [header, body] of entries) pack.entry(header, body ?? Buffer.alloc(0));
  pack.finalize();
  const chunks = []; for await (const chunk of pack) chunks.push(chunk);
  const bytes = Buffer.concat(chunks); const name = path.join(root, gzip ? 'suite.tar.gz' : 'suite.tar');
  fs.writeFileSync(name, gzip ? gzipSync(bytes) : bytes); return name;
}

test('cached bytes are rehashed, not trusted', async t => {
  const root = temporary(t); const digest = suites.sha256('original');
  fs.writeFileSync(path.join(root, digest), 'tampered');
  await assert.rejects(suites.download({ url: 'https://example.org/file', sha256: digest }, root), /hash mismatch/);
});
test('relative and symlink paths cannot escape cache', t => {
  for (const name of ['../escape', '/absolute', 'a/../../escape', 'a\\escape', 'a/./b', '', 'a//b', 'a\0b']) assert.throws(() => suites.relativePath(name));
  const root = temporary(t); const inside = path.join(root, 'inside'); fs.mkdirSync(inside);
  fs.symlinkSync(root, path.join(inside, 'escape'));
  assert.throws(() => suites.contained(inside, 'escape/new/file'), /outside/);
});
test('archive rejects traversal, links, duplicate files and unpinned prefixes', async t => {
  const root = temporary(t);
  for (const entries of [
    [[{ name: '../outside' }]],
    [[{ name: 'safe/link', type: 'symlink', linkname: '/tmp/escape' }]],
    [[{ name: 'safe/link', type: 'link', linkname: 'safe/a' }]],
    [[{ name: 'safe/a' }], [{ name: 'safe/a' }]],
  ]) await assert.rejects(suites.extractArchive(await archive(root, entries), path.join(root, 'out'), '', ['']));
  await assert.rejects(suites.extractArchive(await archive(root, [[{ name: 'wrong/a' }]]), null, 'pinned/', ['']), /outside pinned prefix/);
});
test('plain and gzip archives preserve scoped resource hashes', async t => {
  const root = temporary(t);
  for (const gzip of [false, true]) {
    const name = await archive(root, [[{ name: 'pinned/', type: 'directory' }], [{ name: 'pinned/svg/a.svg' }, Buffer.from('svg')], [{ name: 'pinned/other/b' }, Buffer.from('ignored')]], gzip);
    const destination = path.join(root, gzip ? 'gzip' : 'plain');
    const expected = { 'svg/a.svg': suites.sha256('svg') };
    assert.deepEqual({ ...await suites.extractArchive(name, destination, 'pinned/', ['svg']) }, expected);
    assert.deepEqual({ ...await suites.extractArchive(name, null, 'pinned/', ['svg']) }, expected);
    assert.equal(fs.readFileSync(path.join(destination, 'svg/a.svg'), 'utf8'), 'svg');
    assert.equal(fs.existsSync(path.join(destination, 'other')), false);
  }
});
test('hash change never updates implicitly', async t => {
  const root = temporary(t); const record = { url: 'https://example.org/a', sha256: '0'.repeat(64) };
  await assert.rejects(suites.download(record, root, false, async () => Buffer.from('changed')), /hash mismatch/);
  assert.equal(record.sha256, '0'.repeat(64)); assert.equal(fs.existsSync(path.join(root, record.sha256)), false);
});
test('receipt detects modified extracted resource', t => {
  const root = temporary(t); fs.writeFileSync(path.join(root, 'a.svg'), 'modified');
  assert.throws(() => suites.verifyReceipt(root, { files: { 'a.svg': suites.sha256('original') } }), /hash mismatch/);
});
test('receipt cannot omit locked files', async t => {
  const root = temporary(t); const lock = suites.loadLock(suites.DEFAULT_LOCK); const suite = lock.suites.resvg;
  const target = suites.suiteDirectory(root, suite, false); fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, '.receipt.json'), JSON.stringify({ pin: suites.receiptPin(suite), files: {} }));
  await assert.rejects(suites.fetchSuite(lock, 'resvg', root, false, true, async () => {}), /inventory/);
});
test('receipt pin retains Python sorted ASCII JSON representation', () => {
  const expected = '{"a": [1, true, null, "\\u00e9"], "z": {"b": 2}}';
  assert.equal(suites.receiptPin({ z: { b: 2 }, a: [1, true, null, 'é'] }), suites.sha256(expected));
});
test('offline cache miss never uses network', async t => {
  await assert.rejects(suites.download({ url: 'https://example.org/a', sha256: '0'.repeat(64) }, temporary(t), true, () => assert.fail('network forbidden')), /offline cache miss/);
});
test('curated lock is bounded, pinned and covers every input/reference/resource', () => {
  const lock = suites.loadLock(suites.DEFAULT_LOCK); const subset = lock.suites.resvg.curated;
  assert.ok(subset.length > 0 && subset.length <= 200);
  for (const entry of subset) {
    assert.ok(['shapes/', 'painting/mix-blend-mode/', 'masking/clipPath/', 'masking/mask/', 'structure/image/', 'filters/'].some(prefix => entry.id.startsWith(prefix)));
    const expected = new Set(['svg', 'png'].map(extension => `crates/resvg/tests/tests/${entry.id}.${extension}`));
    if (['structure/image/no-width-and-height', 'structure/image/width-and-height-set-to-auto'].includes(entry.id)) expected.add('crates/resvg/tests/resources/image.jpg');
    assert.equal(entry.files.length, expected.size); assert.deepEqual(new Set(entry.files.map(record => record.path)), expected);
  }
  for (const suite of Object.values(lock.suites)) assert.match(suite.archive.sha256, /^[0-9a-f]{64}$/);
});
test('curated extraction, reuse, source rehashing and incomplete-cache rejection', async t => {
  const cache = temporary(t); const record = { path: 'a.svg', url: 'https://example.org/a', sha256: suites.sha256('original') };
  const lock = { suites: { resvg: { archive: { sha256: '0'.repeat(64) }, curated: [{ files: [record] }] } } };
  const downloader = (record, cache, offline) => suites.download(record, cache, offline, async () => Buffer.from('original'));
  const root = await suites.fetchSuite(lock, 'resvg', cache, false, false, downloader);
  assert.equal(fs.readFileSync(path.join(root, 'a.svg'), 'utf8'), 'original');
  assert.equal(await suites.fetchSuite(lock, 'resvg', cache, false, true), root);
  fs.writeFileSync(path.join(cache, 'downloads', record.sha256), 'tampered');
  await assert.rejects(suites.fetchSuite(lock, 'resvg', cache, false, true), /hash mismatch/);
  fs.writeFileSync(path.join(cache, 'downloads', record.sha256), 'original'); fs.unlinkSync(path.join(root, '.receipt.json'));
  await assert.rejects(suites.fetchSuite(lock, 'resvg', cache, false, true), /incomplete cache/);
});
test('updates require reviewed revisions and replace every download pin', async () => {
  const old = 'a'.repeat(40); const revision = 'b'.repeat(40);
  const lock = { suites: { resvg: { revision: old, strip_prefix: `resvg-${old}/`, archive: { url: `https://example.org/${old}` }, curated: [{ files: [{ path: 'a.svg', url: `https://example.org/${old}/a` }] }] }, 'w3c-svg11': { archive: { url: 'https://example.org/dated' } } } };
  await assert.rejects(suites.updateSuite(lock, 'resvg', 'short'), /reviewed full commit/);
  await assert.rejects(suites.updateSuite(lock, 'w3c-svg11', revision), /dated/);
  await suites.updateSuite(lock, 'resvg', revision, async url => Buffer.from(url));
  assert.equal(lock.suites.resvg.revision, revision); assert.equal(lock.suites.resvg.strip_prefix, `resvg-${revision}/`);
  for (const record of [lock.suites.resvg.archive, ...lock.suites.resvg.curated[0].files]) { assert.ok(record.url.includes(revision)); assert.equal(record.sha256, suites.sha256(record.url)); assert.equal(record.bytes, record.url.length); }
});
