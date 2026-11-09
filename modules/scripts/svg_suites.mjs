import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import tar from 'tar-stream';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DEFAULT_LOCK = path.join(ROOT, 'modules/tests/suites.lock.json');
export const DEFAULT_CACHE = path.join(ROOT, 'modules/tests/.cache/suites');
export const MAX_DOWNLOAD = 512 * 1024 * 1024;
export const MAX_MEMBER = 128 * 1024 * 1024;
export const MAX_EXTRACTED = 2 * 1024 * 1024 * 1024;
export const sha256 = data => createHash('sha256').update(data).digest('hex');
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isFile = name => fs.existsSync(name) && fs.statSync(name).isFile();

export function relativePath(value) {
  if (typeof value !== 'string' || !value || /[\\\0]/.test(value) || path.posix.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`unsafe relative path: ${JSON.stringify(value)}`);
  return value;
}

// Resolve existing ancestors too, so nonexistent children cannot escape via symlinks.
export function resolvedPath(name) {
  name = path.resolve(name);
  try { return fs.realpathSync(name); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      const stat = fs.lstatSync(name);
      if (stat.isSymbolicLink()) return resolvedPath(path.resolve(path.dirname(name), fs.readlinkSync(name)));
    } catch (missing) { if (missing.code !== 'ENOENT') throw missing; }
    const parent = path.dirname(name);
    if (parent === name) throw error;
    return path.join(resolvedPath(parent), path.basename(name));
  }
}
export function inside(root, name) {
  const relative = path.relative(resolvedPath(root), resolvedPath(name));
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export function contained(root, name) {
  const target = path.join(root, relativePath(name));
  if (!inside(root, target)) throw new Error(`path outside suite: ${name}`);
  return target;
}
export function fileHash(name) {
  const hash = createHash('sha256');
  const fd = fs.openSync(name, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try { for (;;) { const count = fs.readSync(fd, buffer); if (!count) break; hash.update(buffer.subarray(0, count)); } }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
export function atomicWrite(name, data) {
  fs.mkdirSync(path.dirname(name), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(name), '.download-'));
  try { const file = path.join(temporary, 'data'); fs.writeFileSync(file, data); fs.renameSync(file, name); }
  finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
export async function fetchBytes(url) {
  if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('suite URLs must use HTTPS');
  const response = await fetch(url, { headers: { 'User-Agent': 'read-fonts-svg-suites/1' }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  if (!response.url.startsWith('https://')) throw new Error('suite redirect downgraded HTTPS');
  const chunks = []; let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > MAX_DOWNLOAD) throw new Error('suite download exceeds size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}
export async function download(record, cache, offline = false, fetcher = fetchBytes) {
  const digest = record.sha256;
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('invalid SHA-256 pin');
  fs.mkdirSync(cache, { recursive: true });
  const target = contained(cache, digest);
  if (fs.existsSync(target)) {
    if (fileHash(target) !== digest) throw new Error(`hash mismatch in cached download ${target}; remove corrupted cache explicitly`);
    return target;
  }
  if (offline) throw new Error(`offline cache miss: ${record.url}`);
  const data = await fetcher(record.url);
  if (sha256(data) !== digest) throw new Error(`hash mismatch for ${record.url}; use --update only after reviewing upstream`);
  atomicWrite(target, data);
  return target;
}
export async function extractArchive(archive, destination, stripPrefix, include) {
  if (destination !== null) fs.mkdirSync(destination, { recursive: true });
  const hashes = Object.create(null); let total = 0;
  const extractor = tar.extract();
  extractor.on('entry', (member, source, next) => {
    source.on('error', error => extractor.destroy(error));
    (async () => {
      let name = member.name.replace(/\/+$/, '');
      relativePath(name);
      if (stripPrefix) {
        if (name === stripPrefix.replace(/\/+$/, '')) { for await (const unused of source) {} return; }
        if (!name.startsWith(stripPrefix)) throw new Error(`archive member outside pinned prefix: ${name}`);
        name = name.slice(stripPrefix.length);
      }
      const selected = include.some(prefix => !prefix || name === prefix.replace(/\/+$/, '') || name.startsWith(`${prefix.replace(/\/+$/, '')}/`));
      if (!selected || member.type === 'directory') { for await (const unused of source) {} return; }
      if (member.type !== 'file') throw new Error(`archive links/special files are forbidden: ${name}`);
      relativePath(name);
      if (Object.hasOwn(hashes, name)) throw new Error(`duplicate archive member: ${name}`);
      total += member.size;
      if (member.size > MAX_MEMBER || total > MAX_EXTRACTED) throw new Error('archive exceeds extraction size limit');
      const hash = createHash('sha256'); let fd;
      if (destination !== null) { const target = contained(destination, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fd = fs.openSync(target, 'w'); }
      try {
        for await (const chunk of source) {
          hash.update(chunk);
          if (fd !== undefined) { let offset = 0; while (offset < chunk.length) offset += fs.writeSync(fd, chunk, offset); }
        }
      } finally { if (fd !== undefined) fs.closeSync(fd); }
      hashes[name] = hash.digest('hex');
    })().then(() => next(), error => { source.destroy(error); extractor.destroy(error); });
  });
  const magic = Buffer.alloc(2); const fd = fs.openSync(archive, 'r');
  try { fs.readSync(fd, magic); } finally { fs.closeSync(fd); }
  const source = fs.createReadStream(archive);
  if (magic[0] === 0x1f && magic[1] === 0x8b) await pipeline(source, createGunzip(), extractor);
  else await pipeline(source, extractor);
  return hashes;
}
export function loadLock(name) {
  const lock = JSON.parse(fs.readFileSync(name, 'utf8'));
  if (lock.version !== 1 || !isObject(lock.suites) || Object.keys(lock.suites).sort().join(',') !== 'resvg,w3c-svg11,wpt') throw new Error('unsupported or incomplete suite lock');
  for (const [name, suite] of Object.entries(lock.suites)) {
    if (name !== 'w3c-svg11' && !/^[0-9a-f]{40}$/.test(suite.revision)) throw new Error(`${name}: revision must be a full commit SHA`);
    for (const record of [suite.archive, ...(suite.curated ?? []).flatMap(c => c.files)]) {
      if (!/^[0-9a-f]{64}$/.test(record.sha256) || typeof record.url !== 'string' || !record.url.startsWith('https://')) throw new Error(`${name}: invalid download pin`);
      if ('path' in record) relativePath(record.path);
    }
    if (name === 'resvg' && !(suite.curated.length > 0 && suite.curated.length <= 200)) throw new Error('resvg curated subset must contain 1–200 cases');
  }
  return lock;
}
// Keep existing Python-generated receipts valid (sorted keys, ASCII escaping and spaces).
export function receiptPin(value) {
  const string = value => JSON.stringify(value).replace(/[\u007f-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const encode = value => Array.isArray(value) ? `[${value.map(encode).join(', ')}]` : isObject(value) ? `{${Object.keys(value).sort().map(key => `${string(key)}: ${encode(value[key])}`).join(', ')}}` : string(value);
  return sha256(encode(value));
}
export const suiteDirectory = (cache, suite, full) => contained(cache, `${suite.archive.sha256}/${full ? 'full' : 'curated'}`);
export function verifyReceipt(root, receipt) {
  for (const [name, digest] of Object.entries(receipt.files)) {
    const target = contained(root, name);
    if (!isFile(target) || fileHash(target) !== digest) throw new Error(`hash mismatch for extracted resource ${name}`);
  }
}
export async function fetchSuite(lock, name, cache, full = false, offline = false, downloader = download) {
  const suite = lock.suites[name];
  if (name !== 'resvg' && !full) throw new Error(`${name} has no curated subset; use --full explicitly`);
  const target = suiteDirectory(cache, suite, full);
  const receiptPath = contained(target, '.receipt.json');
  const pin = receiptPin(suite);
  const records = full ? [suite.archive] : suite.curated.flatMap(c => c.files);
  if (fs.existsSync(receiptPath)) {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (receipt.pin !== pin) throw new Error('suite receipt does not match lock; remove stale extracted cache explicitly');
    for (const record of records) await downloader(record, path.join(cache, 'downloads'), offline);
    const expected = full ? await extractArchive(contained(path.join(cache, 'downloads'), suite.archive.sha256), null, suite.strip_prefix, suite.include) : Object.fromEntries(records.map(record => [record.path, record.sha256]));
    if (receiptPin(receipt.files) !== receiptPin(expected)) throw new Error('suite receipt inventory differs from pinned source inventory');
    verifyReceipt(target, receipt);
    return target;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = fs.mkdtempSync(path.join(path.dirname(target), '.suite-'));
  try {
    const staging = path.join(temporary, 'suite'); fs.mkdirSync(staging);
    let hashes = Object.create(null);
    if (full) hashes = await extractArchive(await downloader(suite.archive, path.join(cache, 'downloads'), offline), staging, suite.strip_prefix, suite.include);
    else for (const record of records) {
      const source = await downloader(record, path.join(cache, 'downloads'), offline);
      const destination = contained(staging, record.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(source, destination);
      hashes[record.path] = record.sha256;
    }
    fs.writeFileSync(path.join(staging, '.receipt.json'), JSON.stringify({ pin, suite: name, files: hashes }, null, 2) + '\n');
    if (fs.existsSync(target)) throw new Error(`incomplete cache exists at ${target}; remove it explicitly`);
    fs.renameSync(staging, target);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  return target;
}
export async function updateSuite(lock, name, revision, fetcher = fetchBytes) {
  const suite = lock.suites[name];
  const records = [suite.archive, ...(suite.curated ?? []).flatMap(c => c.files)];
  if (name !== 'w3c-svg11') {
    if (!revision || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('--update requires --revision with a reviewed full commit SHA');
    const old = suite.revision; suite.revision = revision;
    suite.strip_prefix = suite.strip_prefix.replaceAll(old, revision);
    for (const record of records) record.url = record.url.replaceAll(old, revision);
  } else if (revision) throw new Error('W3C suite is the dated 20110816 release, not a git revision');
  for (const record of records) { const data = await fetcher(record.url); record.sha256 = sha256(data); record.bytes = data.length; }
}
export async function main(argv = process.argv.slice(2)) {
  try {
    const { values: args } = parseArgs({ args: argv, options: { lock: { type: 'string', default: DEFAULT_LOCK }, 'cache-dir': { type: 'string', default: DEFAULT_CACHE }, suite: { type: 'string', default: 'resvg' }, full: { type: 'boolean' }, offline: { type: 'boolean' }, update: { type: 'boolean' }, revision: { type: 'string' }, help: { type: 'boolean' } } });
    if (args.help) { console.log('fetch-suites [--suite resvg|w3c-svg11|wpt] [--full] [--offline] [--lock PATH] [--cache-dir PATH] [--update --revision SHA]'); return 0; }
    if (!['resvg', 'w3c-svg11', 'wpt'].includes(args.suite)) throw new Error('unknown suite');
    const lock = loadLock(args.lock);
    if (args.revision && !args.update) throw new Error('--revision requires --update');
    if (args.update && args.offline) throw new Error('--update cannot be used offline');
    if (args.update) { await updateSuite(lock, args.suite, args.revision); atomicWrite(args.lock, JSON.stringify(lock, null, 2) + '\n'); console.log(`Updated ${args.suite} pins; review lock and expectations before committing.`); }
    else console.log(await fetchSuite(lock, args.suite, args['cache-dir'], args.full, args.offline));
    return 0;
  } catch (error) { console.error(`fetch-suites: ${error.message}`); return 1; }
}
