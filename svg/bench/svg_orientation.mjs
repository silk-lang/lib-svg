#!/usr/bin/env node
// SVG image rotation workloads and independently pre-oriented source controls.
// Measure the generated directory with images.mjs --inputs DIR.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const NS = 'http://www.w3.org/2000/svg';
export function source(rows) {
  let body = '';
  rows.forEach((row, y) => row.forEach((color, x) => { body += `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`; }));
  const width = rows[0].length, height = rows.length;
  const svg = `<svg xmlns="${NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}
export function generate(directory) {
  mkdirSync(directory, { recursive: true });
  const original = source([['red', 'lime'], ['blue', 'cyan'], ['magenta', 'yellow']]);
  const oriented = source([['magenta', 'blue', 'red'], ['yellow', 'cyan', 'lime']]);
  for (const count of [1, 16]) for (const [name, url, hint, width, height] of [['none', original, 'none', 48, 72], ['rotate', original, '90deg', 72, 48], ['control', oriented, 'none', 72, 48]]) {
    let body = '';
    for (let i = 0; i < count; i++) body += `<image x="${(i % 4) * 128}" y="${Math.floor(i / 4) * 96}" width="${width}" height="${height}" href="${url}" style="image-orientation:${hint}"/>`;
    writeFileSync(join(directory, `${name}-${count}.svg`), `<svg xmlns="${NS}" width="512" height="384">${body}</svg>\n`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) console.log('Usage: node svg/bench/svg_orientation.mjs OUTPUT_DIRECTORY');
  else if (process.argv.length !== 3) { console.error('Usage: node svg/bench/svg_orientation.mjs OUTPUT_DIRECTORY'); process.exitCode = 1; }
  else { try { generate(process.argv[2]); } catch (error) { console.error(`svg_orientation: ${error.message}`); process.exitCode = 1; } }
}
