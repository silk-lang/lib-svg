// Internal compatibility gate: exercise the installed silk.xml, never a vendored parser.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { SaxesParser } from 'saxes';
import tar from 'tar-stream';
import { build, root } from './internal.mjs';

const cache = resolve(root, 'build/xmlconf');
const suite = resolve(cache, 'xmlconf');
const digest = '9b61db9f5dbffa545f4b8d78422167083a8568c59bd1129f94138f936cf6fc1f';
const url = 'https://www.w3.org/XML/Test/xmlts20130923.tar.gz';
const options = process.argv.slice(2);
let report, offline = false;
for (let i = 0; i < options.length; i++) {
  if (options[i] === '--offline') offline = true;
  else if (options[i] === '--report' && options[i + 1]) report = resolve(root, options[++i]);
  else throw new Error(`Unknown/missing option: ${options[i]}`);
}
function contained(base, name) {
  if (isAbsolute(name) || name.includes('\\') || name.includes('\0')) throw new Error(`Unsafe suite path: ${name}`);
  const path = resolve(base, name);
  if (path !== cache && !path.startsWith(cache + sep)) throw new Error(`Suite path escapes cache: ${name}`);
  return path;
}
async function fetchSuite() {
  const archive = resolve(cache, 'xmlts20130923.tar.gz');
  let bytes = existsSync(archive) ? readFileSync(archive) : undefined;
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== digest) {
    if (offline) throw new Error('Missing or corrupt pinned XML conformance archive');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`XML suite download: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('XML conformance archive SHA-256 mismatch');
    mkdirSync(cache, { recursive: true });
    writeFileSync(archive, bytes);
  }
  // Extract the authenticated archive every run, so edits in an existing cache cannot alter the gate.
  const extract = tar.extract();
  const done = new Promise((accept, reject) => { extract.on('finish', accept); extract.on('error', reject); });
  extract.on('entry', (header, stream, next) => {
    try {
      const path = contained(cache, header.name);
      if (!['file', 'directory'].includes(header.type)) throw new Error(`Unsupported XML suite archive member: ${header.type}`);
      if (header.size > 128 * 1024 * 1024) throw new Error('Oversized XML suite member');
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('error', error => extract.destroy(error));
      stream.on('end', () => {
        try {
          if (header.type === 'directory') mkdirSync(path, { recursive: true });
          else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, Buffer.concat(chunks)); }
          next();
        } catch (error) { extract.destroy(error); }
      });
    } catch (error) { extract.destroy(error); }
  });
  extract.end(gunzipSync(bytes, { maxOutputLength: 512 * 1024 * 1024 }));
  await done;
}
function cases() {
  const result = [];
  const top = readFileSync(resolve(suite, 'xmlconf.xml'), 'utf8');
  for (const [, catalog, name] of top.matchAll(/<!ENTITY\s+(\S+)\s+SYSTEM\s+"([^"]+)"/g)) {
    const path = contained(suite, name);
    const source = readFileSync(path, 'utf8').replace(/<\?xml[^>]*\?>/, '').replace(/<!DOCTYPE[^\[>]*(\[[\s\S]*?\])?\s*>/, '');
    const parser = new SaxesParser({ xmlns: true });
    const bases = [dirname(path)];
    parser.on('opentag', tag => {
      const baseAttribute = Object.values(tag.attributes).find(a => a.uri === 'http://www.w3.org/XML/1998/namespace' && a.local === 'base');
      const base = baseAttribute ? contained(bases.at(-1), baseAttribute.value) : bases.at(-1);
      bases.push(base);
      if (tag.local === 'TEST') {
        const entry = Object.fromEntries(Object.values(tag.attributes).map(a => [a.name, a.value]));
        result.push({ ...entry, catalog, file: contained(base, entry.URI) });
      }
    });
    parser.on('closetag', () => bases.pop());
    parser.write(`<CATALOG>${source}</CATALOG>`).close();
  }
  return result;
}
function skipReason(test) {
  if (['XML1.1', 'NS1.1'].includes(test.RECOMMENDATION) || test.VERSION === '1.1') return 'xml-1.1';
  if (test.EDITION && !test.EDITION.split(/\s+/).includes('5')) return 'earlier-edition';
  if (test.NAMESPACE === 'no') return 'namespace-unaware';
  if (test.TYPE === 'error') return 'optional-error';
  if (test.TYPE === 'not-wf' && (test.ENTITIES || 'none') !== 'none') return 'not-wf-in-external-entity';
  return undefined;
}
const runner = build('xml-conformance', { release: true });
await fetchSuite();
const selected = [], skipped = {};
for (const test of cases()) {
  const reason = skipReason(test);
  if (reason) skipped[reason] = (skipped[reason] || 0) + 1;
  else selected.push({ ...test, expected: test.TYPE === 'not-wf' ? 'ERR' : 'OK' });
}
const batchSize = process.platform === 'win32' ? 50 : 200;
for (let start = 0; start < selected.length; start += batchSize) {
  const batch = selected.slice(start, start + batchSize);
  const processResult = spawnSync(runner, batch.map(test => test.file), { encoding: 'utf8', timeout: 600000 });
  let lines = (processResult.stdout || '').trim().split(/\s+/);
  if (processResult.status !== 0 || lines.length !== batch.length) {
    lines = batch.map(test => {
      const single = spawnSync(runner, [test.file], { encoding: 'utf8', timeout: 60000 });
      return single.status === 0 && single.stdout.trim() ? single.stdout.trim().split(/\s+/)[0] : `crash(${single.signal || single.status})`;
    });
  }
  batch.forEach((test, i) => { test.outcome = lines[i]; });
}
const failures = selected.filter(test => test.outcome !== test.expected);
for (const test of failures) console.error(`FAIL ${test.ID} (${test.TYPE}): expected ${test.expected}, got ${test.outcome}: ${relative(suite, test.file)}`);
console.log(`${selected.length - failures.length}/${selected.length} selected cases pass; skipped ${Object.entries(skipped).sort().map(([key, count]) => `${count} ${key}`).join(', ')}`);
if (report) { mkdirSync(dirname(report), { recursive: true }); writeFileSync(report, JSON.stringify({ skipped, cases: selected }, null, 1) + '\n'); }
process.exitCode = failures.length ? 1 : 0;
