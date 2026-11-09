#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { ROOT, sha256, atomicWrite, contained, isObject } from './svg_suites.mjs';

export const LOCK = path.join(ROOT, 'modules/specs.lock.json');
export const CACHE = path.join(ROOT, 'modules/.cache/specs');
const SVG11 = 'https://www.w3.org/TR/2011/REC-SVG11-20110816/';
const SVG2 = 'https://www.w3.org/TR/2018/CR-SVG2-20181004/';
const SVG2_ED = 'https://svgwg.org/svg2-draft/';
const CSS21 = 'https://www.w3.org/TR/2011/REC-CSS2-20110607/';
const SVG11_CHAPTERS = 'intro concepts render types struct styling coords paths shapes text painting color pservers masking filters interact linking script animate fonts metadata backward extend svgdom implnote conform access feature changes refs'.split(' ');
const SVG2_CHAPTERS = 'intro conform render types struct styling geometry coords paths shapes text embedded painting pservers interact linking animate implnote access changes refs'.split(' ');
const CSS21_CHAPTERS = 'intro conform syndata selector cascade media box visuren visudet visufx generate page colors fonts text tables ui grammar sample changes'.split(' ');
const chapters = (prefix, base, names) => Object.fromEntries(names.map(name => [`${prefix}-${name}`, `${base}${name}.html`]));
export const URLS = {
  fetch: 'https://fetch.spec.whatwg.org/', infra: 'https://infra.spec.whatwg.org/',
  svg11: SVG11, 'svg11-errata': 'https://www.w3.org/2011/08/REC-SVG11-20110816-errata',
  svg2: SVG2, 'svg2-ed': SVG2_ED, css21: CSS21,
  ...chapters('svg11', SVG11, SVG11_CHAPTERS), ...chapters('svg2', SVG2, SVG2_CHAPTERS),
  ...chapters('svg2-ed', SVG2_ED, SVG2_CHAPTERS), ...chapters('css21', CSS21, CSS21_CHAPTERS),
  ...Object.fromEntries('filter-effects-1 css-masking-1 compositing-1 css-transforms-1 css-syntax-3 css-cascade-4 selectors-4 css-namespaces-3 mediaqueries-4 mediaqueries-5 css-conditional-3 css-variables-1 css-values-3 css-values-4 css-color-4 css-images-3 css-fonts-4 css-text-3 css-text-4 cssom css-text-decor-3 css-writing-modes-3 css-inline-3 css-shapes-1 css-animations-1 svg-integration xml xml-names xmlbase xml-stylesheet xlink11 png-3'.split(' ').map(name => [name, `https://www.w3.org/TR/${name}/`])),
  'css-transforms-2': 'https://drafts.csswg.org/css-transforms-2/',
  'css-shadow-1': 'https://drafts.csswg.org/css-shadow-1/',
  'css-values-4-ed': 'https://drafts.csswg.org/css-values-4/',
  encoding: 'https://encoding.spec.whatwg.org/', 'unicode-uts46': 'https://www.unicode.org/reports/tr46/',
  'css-conditional-3-2022': 'https://www.w3.org/TR/2022/CR-css-conditional-3-20220113/',
  'smil-animation': 'https://www.w3.org/TR/2001/REC-smil-animation-20010904/',
  'smil-content': 'https://www.w3.org/TR/REC-smil/smil-content.html',
  'media-frags': 'https://www.w3.org/TR/2012/REC-media-frags-20120925/',
  'svg-animations-2': 'https://svgwg.org/specs/animations/',
  ...Object.fromEntries([9, 14, 24, 29, 50].map(number => [`unicode-uax${number}`, `https://www.unicode.org/reports/tr${number}/`])),
  ...Object.fromEntries([2397, 1950, 1951, 1952, 3492, 5892, 5893].map(number => [`rfc${number}`, `https://www.rfc-editor.org/rfc/rfc${number}.html`])),
  url: 'https://url.spec.whatwg.org/', 'jpeg-t81': 'https://www.w3.org/Graphics/JPEG/itu-t81.pdf',
  'jpeg-jfif': 'https://www.w3.org/Graphics/JPEG/jfif3.pdf',
  'icc-embedding': 'https://archive.color.org/files/technotes/ICC-Technote-ProfileEmbedding.pdf',
  'icc-v4': 'https://www.color.org/specification/ICC.1-2022-05.pdf',
};
export class SpecError extends Error {}
export const digest = sha256;
export const cachePath = (cache, record) => contained(cache, record.sha256);
export async function download(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'read-fonts-svg-specs/1.0' }, signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new SpecError(`HTTP ${response.status}: ${url}`);
  if (!response.url.startsWith('https://')) throw new SpecError(`insecure redirect from ${url} to ${response.url}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (!body.length) throw new SpecError(`empty document: ${url}`);
  return [response.url, body];
}
export function loadLock(name, urls) {
  if (!fs.existsSync(name)) throw new SpecError('missing lock; use --update to establish the baseline');
  let document;
  try { document = JSON.parse(fs.readFileSync(name, 'utf8')); } catch (error) { throw new SpecError(`cannot read lock: ${error.message}`); }
  if (!isObject(document) || document.format !== 1) throw new SpecError('unsupported specification lock format');
  const records = document.specs;
  if (!isObject(records) || JSON.stringify(Object.keys(records).sort()) !== JSON.stringify(Object.keys(urls).sort())) throw new SpecError('specification catalog differs from lock; review --update');
  for (const [name, record] of Object.entries(records)) {
    if (!isObject(record)) throw new SpecError(`${name}: invalid lock record`);
    if (typeof record.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(record.sha256)) throw new SpecError(`${name}: invalid SHA-256 in lock`);
    if (record.url !== urls[name]) throw new SpecError(`${name}: catalog URL changed; review --update`);
    if (typeof record.resolved !== 'string' || !record.resolved.startsWith('https://')) throw new SpecError(`${name}: invalid resolved URL in lock`);
  }
  return records;
}
export async function synchronize(lock, cache, urls, { update = false, offline = false, only = null, downloader = download } = {}) {
  if (update && offline) throw new SpecError('--update cannot be combined with --offline');
  if (update && only?.length) throw new SpecError('--update cannot be combined with --only; review the complete baseline');
  const selected = [...new Set(only ?? Object.keys(urls))].sort();
  const unknown = selected.filter(name => !Object.hasOwn(urls, name));
  if (unknown.length) throw new SpecError(`unknown specification IDs: ${unknown.join(', ')}`);
  const records = update ? Object.create(null) : loadLock(lock, urls);
  const failures = new Map(); let next = 0;
  async function processOne(name) {
    const url = urls[name]; let record = records[name];
    if (!update) {
      const cached = cachePath(cache, record);
      if (fs.existsSync(cached)) {
        if (digest(fs.readFileSync(cached)) !== record.sha256) throw new SpecError(`${name}: cached SHA-256 mismatch; remove corrupt cache explicitly`);
        return;
      }
      if (offline) throw new SpecError(`${name}: missing cache in offline mode`);
    }
    const [resolved, body] = await downloader(url);
    const actual = digest(body);
    if (!update && actual !== record.sha256) throw new SpecError(`${name}: upstream SHA-256 changed; inspect before --update`);
    if (update) record = { url, resolved, sha256: actual };
    atomicWrite(cachePath(cache, record), body);
    records[name] = record;
  }
  await Promise.all(Array.from({ length: Math.min(6, selected.length) }, async () => {
    while (next < selected.length) {
      const name = selected[next++];
      try { await processOne(name); } catch (error) { failures.set(name, `${name}: ${error.message}`); }
    }
  }));
  if (failures.size) throw new SpecError(selected.filter(name => failures.has(name)).map(name => failures.get(name)).join('\n'));
  if (update) atomicWrite(lock, JSON.stringify({ format: 1, specs: Object.fromEntries(Object.keys(records).sort().map(name => [name, records[name]])) }, null, 2) + '\n');
  return selected.length;
}
export async function main(argv = process.argv.slice(2)) {
  try {
    // Preserve argparse's --only ID [ID ...], and accept repeated --only too.
    const normalized = []; let inOnly = false;
    for (const arg of argv) {
      if (arg === '--only') { inOnly = true; normalized.push(arg); }
      else if (arg.startsWith('--')) { inOnly = false; normalized.push(arg); }
      else if (inOnly && normalized.at(-1) !== '--only') normalized.push('--only', arg);
      else normalized.push(arg);
    }
    const { values: args } = parseArgs({ args: normalized, options: { update: { type: 'boolean' }, offline: { type: 'boolean' }, only: { type: 'string', multiple: true }, lock: { type: 'string', default: LOCK }, cache: { type: 'string', default: CACHE }, help: { type: 'boolean' } } });
    if (args.help) { console.log('fetch-specs [--offline] [--only ID ...] [--lock PATH] [--cache PATH] [--update]'); return 0; }
    const count = await synchronize(args.lock, args.cache, URLS, args);
    console.log(`${args.update ? 'Pinned' : 'Verified'} ${count} specifications in ${args.cache}`);
    return 0;
  } catch (error) { console.error(`specifications: ${error.message}`); return 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = await main();
