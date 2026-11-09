#!/usr/bin/env node
// Original deterministic benchmark geometry. Keep serialized bytes stable: existing
// measured baselines identify workloads by their exact bytes, not visual similarity.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DOMParser } from '@xmldom/xmldom';

export const HERE = dirname(fileURLToPath(import.meta.url));
const floor = Math.floor;
const hex = (n, width) => n.toString(16).padStart(width, '0');
const float = n => Number.isInteger(n) ? `${n}.0` : String(n);
export const svg = (size, shapes) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">\n${shapes.join('\n')}\n</svg>\n`);
export function generate_icons({ size, seed, count }) {
  let state = seed;
  const files = {};
  for (let index = 0; index < count; index++) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    const inset = 2 + index % 5;
    files[`icon-${String(index).padStart(3, '0')}.svg`] = svg(size, [
      `<rect x="1" y="1" width="${size - 2}" height="${size - 2}" rx="4" fill="#${hex(state & 0xffffff, 6)}"/>`,
      `<circle cx="${floor(size / 2)}" cy="${floor(size / 2)}" r="${5 + index % 6}" fill="#ffffff"/>`,
      `<path d="M ${inset} ${size - inset} L ${floor(size / 2)} ${inset} L ${size - inset} ${size - inset} Z" fill="none" stroke="#183048" stroke-width="1" stroke-linejoin="round"/>`,
      `<path d="M 4 ${8 + index % 8} Q 16 2 28 24" fill="none" stroke="#905020" stroke-width="2"/>`,
      '<circle cx="10" cy="12" r="2" fill="#204060"/>', '<circle cx="22" cy="12" r="2" fill="#204060"/>',
    ]);
  }
  return files;
}
export function generate_map({ size, grid }) {
  const step = floor(size / grid), shapes = [];
  for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
    const left = x * step + 2, top = y * step + 2, right = (x + 1) * step - 2, bottom = (y + 1) * step - 2;
    const color = ['#ccd9b5', '#d9d0ba', '#b9d3cc'][(x * 7 + y * 11) % 3];
    shapes.push(`<path d="M ${left} ${top} L ${right} ${top + (x + y) % 4} L ${right - x % 3} ${bottom} L ${left} ${bottom} Z" fill="${color}" stroke="#596559" stroke-width="1"/>`);
    shapes.push(`<path d="M ${left + 3} ${top + 4} h ${floor(step / 3)} v ${floor(step / 3)} h ${floor(-step / 3)} Z" fill="#a39186"/>`);
  }
  for (let i = 1; i < grid; i++) shapes.push(`<path d="M 0 ${i * step} H ${size} M ${i * step} 0 V ${size}" fill="none" stroke="#f5f1df" stroke-width="3"/>`);
  shapes.push(`<path d="M 0 ${floor(size / 3)} C ${floor(size / 3)} 0 ${floor(size / 2)} ${size} ${size} ${floor(size / 2)}" fill="none" stroke="#5096bb" stroke-width="9"/>`);
  return { 'largemap.svg': svg(size, shapes) };
}
export function generate_curves({ size, grid }) {
  const step = floor(size / grid), shapes = [];
  for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
    const color = ['#356a97', '#b65939', '#6b8350'][(x + y) % 3];
    shapes.push(`<g transform="translate(${x * step} ${y * step})"><path d="M 2 24 C 3 0 24 0 28 18 Q 18 30 2 24 Z" fill="${color}" stroke="#27313b" stroke-width="1"/><path d="M 3 10 Q 14 30 28 5" fill="none" stroke="#efe6bc" stroke-width="2" stroke-linecap="round"/></g>`);
  }
  return { 'mixedcurves.svg': svg(size, shapes) };
}
export function generate_stylesheets({ size, rows, columns }) {
  const width = floor(size / columns), height = floor(size / rows), rules = [], groups = [];
  for (let row = 0; row < rows; row++) {
    const cells = [];
    for (let column = 0; column < columns; column++) {
      const red = 32 + (row * 37 + column * 17) % 192, green = 32 + (row * 13 + column * 43) % 192, blue = 32 + (row * 29 + column * 7) % 192;
      rules.push(`.r${row} > rect.c${column} { fill: #${hex(red, 2)}${hex(green, 2)}${hex(blue, 2)}; }`);
      cells.push(`<rect class="c${column}" x="${column * width}" y="${row * height}" width="${width - 1}" height="${height - 1}"/>`);
    }
    groups.push(`<g class="r${row}">${cells.join('')}</g>`);
  }
  return { 'stylesheets.svg': svg(size, [`<style>${rules.join('\n')}</style>`, ...groups]) };
}
export function generate_instances({ size, grid }) {
  const step = floor(size / grid), instances = [];
  const definitions = '<defs><symbol id="tile" viewBox="0 0 16 16"><path d="M1 1H15V15H1Z"/><path fill="white" d="M4 4H12V6H4Z M4 8H10V10H4Z"/></symbol><g id="badge"><use href="#tile" width="16" height="16"/></g></defs>';
  for (let row = 0; row < grid; row++) for (let column = 0; column < grid; column++) instances.push(`<use href="#badge" x="${column * step}" y="${row * step}" fill="${(row + column) % 2 ? '#e67e22' : '#2388dd'}"/>`);
  return { 'instances.svg': svg(size, [definitions, ...instances]) };
}
export function generate_paintservers({ size, grid }) {
  const step = floor((size - 64) / grid), edge = step - 8;
  const definitions = '<defs>'
    + '<linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b5dbd8"/><stop offset="0.5" stop-color="#548b97"/><stop offset="1" stop-color="#24475d"/></linearGradient>'
    + '<linearGradient id="thread" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="16" y2="16"><stop offset="0" stop-color="#163347"/><stop offset="0.5" stop-color="#418a92"/><stop offset="1" stop-color="#91c4b0"/></linearGradient>'
    + '<radialGradient id="bead" gradientUnits="userSpaceOnUse" cx="8" cy="8" r="6" fx="8" fy="8" fr="0"><stop offset="0" stop-color="#fff1b0"/><stop offset="0.5" stop-color="#d4a45c"/><stop offset="1" stop-color="#80512e"/></radialGradient>'
    + '<radialGradient id="jewel" cx="0.5" cy="0.5" r="0.5" fx="0.5" fy="0.5" fr="0"><stop offset="0" stop-color="#e5f5df"/><stop offset="0.4" stop-color="#7bb9a0"/><stop offset="1" stop-color="#205263"/></radialGradient>'
    + '<pattern id="weave" patternUnits="userSpaceOnUse" patternContentUnits="userSpaceOnUse" x="0" y="0" width="16" height="16"><rect width="16" height="16" fill="url(#thread)"/><path d="M0 4H16 M0 12H16" fill="none" stroke="#163347" stroke-width="2"/><path d="M4 0V16 M12 0V16" fill="none" stroke="#91c4b0" stroke-width="1"/></pattern>'
    + '<pattern id="beads" patternUnits="userSpaceOnUse" patternContentUnits="userSpaceOnUse" x="0" y="0" width="16" height="16"><rect width="16" height="16" fill="url(#thread)"/><circle cx="8" cy="8" r="6" fill="url(#bead)"/></pattern></defs>';
  const shapes = [definitions, `<rect width="${size}" height="${size}" fill="#102738"/>`, `<rect x="16" y="16" width="${size - 32}" height="${size - 32}" rx="12" fill="url(#panel)"/>`, `<rect x="24" y="24" width="${size - 48}" height="${size - 48}" rx="8" fill="#163347"/>`];
  for (let row = 0; row < grid; row++) for (let column = 0; column < grid; column++) {
    const left = 32 + column * step, top = 32 + row * step, cx = left + floor(edge / 2), cy = top + floor(edge / 2);
    shapes.push(`<rect x="${left}" y="${top}" width="${edge}" height="${edge}" rx="6" fill="url(#panel)"/>`, `<rect x="${left + 3}" y="${top + 3}" width="${edge - 6}" height="${edge - 6}" rx="4" fill="url(#weave)"/>`, `<circle cx="${cx}" cy="${cy}" r="${floor(edge / 3)}" fill="url(#beads)" stroke="#e2c27a" stroke-width="2"/>`, `<circle cx="${cx}" cy="${cy}" r="${floor(edge / 6)}" fill="url(#jewel)" stroke="#163347" stroke-width="1"/>`);
  }
  return { 'paintservers.svg': svg(size, shapes) };
}
export function generate_compositing({ size, grid }) {
  const step = floor(size / grid), modes = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
  const shapes = [`<rect width="${size}" height="${size}" fill="#315579"/>`];
  for (let row = 0; row < grid; row++) for (let column = 0; column < grid; column++) {
    const left = column * step, top = row * step, mode = modes[(row * grid + column) % modes.length];
    shapes.push(`<g style="isolation:isolate" opacity="0.8"><rect x="${left}" y="${top}" width="${step}" height="${step}" fill="#cc6633"/><g style="mix-blend-mode:${mode}"><rect x="${left + 2}" y="${top + 2}" width="${step}" height="${step}" fill="#3399cc"/><circle cx="${left + floor(step / 2)}" cy="${top + floor(step / 2)}" r="${floor(step / 3)}" fill="#99cc55"/></g></g>`);
  }
  return { 'compositing.svg': svg(size, shapes) };
}
export function generate_clipping({ size, grid }) {
  const step = floor(size / grid), shapes = ['<defs><clipPath id="outer" clipPathUnits="objectBoundingBox"><rect x=".1" y=".1" width=".8" height=".8"/></clipPath><clipPath id="union" clipPathUnits="objectBoundingBox" clip-path="url(#outer)"><circle cx=".35" cy=".5" r=".35"/><circle cx=".65" cy=".5" r=".35"/></clipPath></defs>', `<rect width="${size}" height="${size}" fill="#315579"/>`];
  for (let row = 0; row < grid; row++) for (let column = 0; column < grid; column++) shapes.push(`<g transform="translate(${column * step} ${row * step})" clip-path="url(#union)"><rect width="${step}" height="${step}" fill="#cc6633"/><rect width="${step}" height="${step}" fill="#3399cc" style="clip-path:polygon(0 0,100% 25%,75% 100%,25% 75%)"/></g>`);
  return { 'clipping.svg': svg(size, shapes) };
}
export function generate_masking({ size, grid }) {
  const step = floor(size / grid), shapes = ['<defs><mask id="alpha" maskContentUnits="objectBoundingBox" mask-type="alpha"><rect width="1" height="1" opacity=".75"/></mask><mask id="luma" maskContentUnits="objectBoundingBox"><g mask="url(#alpha)"><circle cx=".5" cy=".5" r=".48" fill="#80c040"/><rect x=".25" y=".25" width=".5" height=".5" fill="white"/></g></mask></defs>', `<rect width="${size}" height="${size}" fill="#315579"/>`];
  for (let row = 0; row < grid; row++) for (let column = 0; column < grid; column++) shapes.push(`<g transform="translate(${column * step} ${row * step})" mask="url(#luma)"><rect width="${step}" height="${step}" fill="#cc6633"/><circle cx="${float(step / 2)}" cy="${float(step / 2)}" r="${float(step / 3)}" fill="#3399cc"/></g>`);
  return { 'masking.svg': svg(size, shapes) };
}
export function generate_filters({ size, grid }) {
  const step = floor(size / grid), filters = [
    '<feGaussianBlur stdDeviation="3"/>', '<feDropShadow dx="2" dy="3" stdDeviation="2" flood-color="#102030"/>', '<feColorMatrix type="hueRotate" values="90"/>', '<feMorphology operator="dilate" radius="2"/>',
    '<feTurbulence baseFrequency="0.08" numOctaves="3" result="t"/><feComposite in="t" in2="SourceAlpha" operator="in"/>',
    '<feGaussianBlur in="SourceAlpha" stdDeviation="2" result="b"/><feDiffuseLighting in="b" surfaceScale="3" lighting-color="#ffe0b0"><feDistantLight azimuth="225" elevation="45"/></feDiffuseLighting><feComposite in2="SourceGraphic" operator="arithmetic" k1="1"/>',
    '<feOffset dx="3" dy="3" result="o"/><feBlend in="SourceGraphic" in2="o" mode="multiply"/>', '<feComponentTransfer><feFuncR type="gamma" exponent="0.5"/><feFuncG type="table" tableValues="0 1 0.5"/></feComponentTransfer>',
  ];
  const shapes = [`<defs>${filters.map((body, i) => `<filter id="f${i}">${body}</filter>`).join('')}</defs>`, `<rect width="${size}" height="${size}" fill="#315579"/>`];
  for (let row = 0; row < grid; row++) for (let column = 0; column < grid; column++) {
    const left = column * step, top = row * step, index = (row * grid + column) % filters.length;
    shapes.push(`<g filter="url(#f${index})"><rect x="${left + floor(step / 6)}" y="${top + floor(step / 6)}" width="${floor(step * 2 / 3)}" height="${floor(step / 2)}" fill="#cc6633"/><circle cx="${left + floor(step * 2 / 3)}" cy="${top + floor(step * 2 / 3)}" r="${floor(step / 4)}" fill="#99cc55"/></g>`);
  }
  return { 'filters.svg': svg(size, shapes) };
}
const hash = data => createHash('sha256').update(data).digest('hex');
export function verify_asset(data, spec) {
  if (hash(data) !== spec.sha256) throw new Error('Tiger SHA-256 mismatch; refusing unpinned content');
  if (data.length !== spec.bytes) throw new Error('Tiger byte count mismatch');
}
export function normalize_tiger(data, config) {
  const document = new DOMParser({ onError: (level, message) => { throw new Error(message); } }).parseFromString(data.toString('utf8'), 'application/xml');
  const root = document.documentElement;
  if (root.namespaceURI !== 'http://www.w3.org/2000/svg' || root.localName !== 'svg' || root.getAttribute('viewBox') !== config.viewBox) throw new Error('Tiger viewport normalization requires the pinned SVG viewBox');
  root.setAttribute('width', String(config.width));
  root.setAttribute('height', String(config.height));
  // Reproduce the historical ElementTree serialization, including namespace
  // numbering and empty-tag spaces, without requiring a Python runtime.
  const namespaces = new Map();
  const qualified = node => {
    const uri = node.namespaceURI;
    if (!uri) return node.nodeName;
    if (uri === 'http://www.w3.org/XML/1998/namespace') return `xml:${node.localName}`;
    if (!namespaces.has(uri)) namespaces.set(uri, uri === 'http://www.w3.org/2000/svg' ? '' : `ns${namespaces.size}`);
    const prefix = namespaces.get(uri);
    return prefix ? `${prefix}:${node.localName}` : node.localName;
  };
  const attributes = node => Array.from(node.attributes).filter(a => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/');
  const visit = node => {
    qualified(node);
    for (const attribute of attributes(node)) qualified(attribute);
    for (const child of Array.from(node.childNodes)) if (child.nodeType === 1) visit(child);
  };
  visit(root);
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const attribute = value => escape(value).replaceAll('"', '&quot;').replaceAll('\t', '&#09;').replaceAll('\n', '&#10;').replaceAll('\r', '&#13;');
  const serialize = (node, isRoot = false) => {
    const name = qualified(node);
    let text = `<${name}`;
    if (isRoot) for (const [uri, prefix] of [...namespaces].sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)) text += ` xmlns${prefix ? ':' + prefix : ''}="${attribute(uri)}"`;
    for (const a of attributes(node)) text += ` ${qualified(a)}="${attribute(a.value)}"`;
    const children = Array.from(node.childNodes).filter(n => [1, 3, 4].includes(n.nodeType));
    if (!children.length) return text + ' />';
    return text + '>' + children.map(n => n.nodeType === 1 ? serialize(n) : escape(n.data)).join('') + `</${name}>`;
  };
  return Buffer.from("<?xml version='1.0' encoding='utf-8'?>\n" + serialize(root, true));
}
export const generators = { iconset: generate_icons, largemap: generate_map, mixedcurves: generate_curves, stylesheets: generate_stylesheets, instances: generate_instances, paintservers: generate_paintservers, compositing: generate_compositing, clipping: generate_clipping, masking: generate_masking, filters: generate_filters };
function replaceChanged(path, data) {
  if (!existsSync(path) || !readFileSync(path).equals(data)) writeFileSync(path, data);
}
export async function prepare(manifest, cache, fetchTiger = false, selected = null) {
  const result = {};
  for (const [name, spec] of Object.entries(manifest.workloads)) {
    if (selected !== null && !selected.includes(name)) continue;
    const directory = join(cache, name);
    mkdirSync(directory, { recursive: true });
    if (name === 'tiger') {
      const path = join(directory, 'tiger.svg');
      if (!existsSync(path)) {
        if (!fetchTiger) throw new Error('pinned Tiger is missing; run node modules/bench/workloads.mjs --fetch-tiger (AGPL-3.0-or-later benchmark-only asset)');
        const response = await fetch(spec.url, { headers: { 'User-Agent': 'silk-svg-bench/0.1' }, signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error(`Tiger download failed: HTTP ${response.status}`);
        const chunks = [];
        let length = 0;
        for await (const chunk of response.body) {
          length += chunk.length;
          if (length > spec.bytes) throw new Error('Tiger byte count mismatch');
          chunks.push(chunk);
        }
        const data = Buffer.concat(chunks);
        verify_asset(data, spec);
        writeFileSync(path, data);
      }
      const source = readFileSync(path);
      verify_asset(source, spec);
      const normalized = normalize_tiger(source, spec.viewport_normalization), derivedHash = hash(normalized);
      if (derivedHash !== spec.viewport_normalization.sha256) throw new Error('normalized Tiger SHA-256 mismatch');
      const derived = join(directory, 'tiger-sized.svg');
      replaceChanged(derived, normalized);
      writeFileSync(join(directory, 'provenance.json'), JSON.stringify({ ...spec, source_file: 'tiger.svg', benchmark_file: 'tiger-sized.svg', derived_sha256: derivedHash, derived_bytes: normalized.length }, null, 2) + '\n');
      result[name] = [derived];
    } else {
      result[name] = Object.entries(generators[name](spec.config)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([filename, data]) => {
        const path = join(directory, filename);
        replaceChanged(path, data);
        return path;
      });
    }
  }
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { 'fetch-tiger': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
    if (values.help) console.log('Usage: node modules/bench/workloads.mjs [--fetch-tiger]');
    else {
      const manifest = JSON.parse(readFileSync(join(HERE, 'workloads.json'), 'utf8'));
      const prepared = await prepare(manifest, join(HERE, '.cache/workloads'), values['fetch-tiger']);
      for (const [name, files] of Object.entries(prepared)) console.log(`${name}: ${files.length} SVG files, ${files.reduce((n, p) => n + statSync(p).size, 0)} bytes`);
    }
  } catch (error) { console.error(`workloads: ${error.message}`); process.exitCode = 1; }
}
