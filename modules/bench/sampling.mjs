#!/usr/bin/env node
// Original image-sampling workloads and independently expanded smooth controls.
// Measure the generated directory with images.mjs --inputs DIR.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { png } from './png.mjs';
export function source(mx, my) {
  const width = 16 * mx, height = 16 * my, samples = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = Math.floor(x / mx), py = Math.floor(y / my), offset = (y * width + x) * 3;
    samples[offset] = (px * 17) % 256; samples[offset + 1] = (py * 17) % 256; samples[offset + 2] = ((px + py) * 31) % 256;
  }
  return 'data:image/png;base64,' + png(width, height, 3, samples).toString('base64');
}
export function generate(directory) {
  mkdirSync(directory, { recursive: true });
  for (const [count, width, height, mx, my] of [[1, 435.2, 307.2, 27, 19], [64, 51.2, 44.8, 3, 3]]) {
    for (const [name, hint, url] of [['auto', 'auto', source(1, 1)], ['pixelated', 'pixelated', source(1, 1)], ['expanded-smooth', 'smooth', source(mx, my)]]) {
      let children = '';
      for (let i = 0; i < count; i++) children += `<image x="${(i % 8) * 64}" y="${Math.floor(i / 8) * 48}" width="${width}" height="${height}" preserveAspectRatio="none" href="${url}" style="image-rendering:${hint}"/>`;
      writeFileSync(join(directory, `${name}-${count}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="384">${children}</svg>\n`);
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) console.log('Usage: node modules/bench/sampling.mjs OUTPUT_DIRECTORY');
  else if (process.argv.length !== 3) { console.error('Usage: node modules/bench/sampling.mjs OUTPUT_DIRECTORY'); process.exitCode = 1; }
  else { try { generate(process.argv[2]); } catch (error) { console.error(`sampling: ${error.message}`); process.exitCode = 1; } }
}
