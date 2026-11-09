#!/usr/bin/env node
// Original deterministic 512x384 PNG/JPEG sources. Generation and measurement
// are separate commands so measurement hosts need not encode image fixtures.
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invoke, environment, sha256, median, process_ir, require_callgrind, parse_options, validate, emit, MODES } from './harness.mjs';
import { png } from './png.mjs';

export async function generate(directory) {
  const { default: sharp } = await import('sharp');
  mkdirSync(directory, { recursive: true });
  const width = 512, height = 384, samples = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) samples[y * width + x] = ((Math.floor(x / 16) + Math.floor(y / 16)) % 16) * 16;
  const jpeg = await sharp(samples, { raw: { width, height, channels: 1 } }).toColourspace('b-w').jpeg({ quality: 90, progressive: false, optimiseCoding: false }).toBuffer();
  for (const [kind, data] of [['png', png(width, height, 1, samples)], ['jpeg', jpeg]]) {
    const url = `data:image/${kind};base64,${data.toString('base64')}`;
    for (const count of [1, 64]) {
      let children = `<image href="${url}"/>`;
      if (count === 64) {
        children = '';
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) children += `<image x="${x * 64}" y="${y * 48}" width="64" height="48" href="${url}"/>`;
      }
      writeFileSync(join(directory, `${kind}-${count}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="384">${children}</svg>\n`);
    }
  }
}
export async function main(argv = process.argv.slice(2)) {
  try {
    const { args } = parse_options({ generate: { type: 'string' }, inputs: { type: 'string' }, silk: { type: 'string' }, rust: { type: 'string' }, output: { type: 'string' }, callgrind: { type: 'boolean', default: false }, iterations: { type: 'string', default: '5' }, warmup: { type: 'string', default: '1' }, samples: { type: 'string', default: '3' }, timeout: { type: 'string', default: '300' }, help: { type: 'boolean', short: 'h' } }, { argv });
    if (args.help) { console.log('Usage: node modules/bench/images.mjs --generate DIR\n  node modules/bench/images.mjs --inputs DIR --silk BINARY --rust BINARY --output FILE\n  [--callgrind] [--iterations N] [--warmup N] [--samples N] [--timeout SECONDS]'); return; }
    if (args.generate) { await generate(args.generate); return; }
    if (![args.inputs, args.silk, args.rust, args.output].every(Boolean)) throw new Error('measurement requires --inputs, --silk, --rust and --output');
    const sources = readdirSync(args.inputs, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith('.svg')).map(entry => resolve(args.inputs, entry.name)).sort();
    if (!sources.length) throw new Error('input directory contains no SVG workloads');
    const binaries = { silk: resolve(args.silk), resvg: resolve(args.rust) };
    validate(args, binaries);
    if (args.callgrind) require_callgrind();
    const report = { environment: environment(binaries), rows: [], iterations: args.iterations, warmup: args.warmup, samples: args.samples, callgrind_scope: 'full process, including startup, I/O and output checksum' };
    for (const source of sources) for (const mode of MODES) {
      const rows = Object.fromEntries(Object.keys(binaries).map(name => [name, { engine: name, input: basename(source), mode, input_sha256: sha256(source), samples_ns: [] }]));
      for (let sample = 0; sample < args.samples; sample++) {
        const names = Object.keys(binaries);
        if (sample % 2) names.reverse();
        for (const name of names) {
          const [result] = invoke(binaries[name], mode, source, args), row = rows[name];
          if ('checksum' in row && row.checksum !== result.checksum) throw new Error('output changed between samples');
          row.checksum = result.checksum; row.samples_ns.push(result.elapsed_ns / args.iterations);
        }
      }
      for (const [name, row] of Object.entries(rows)) {
        row.median_ns = median(row.samples_ns);
        if (args.callgrind) row.process_Ir = process_ir(binaries[name], mode, source, args);
        report.rows.push(row);
        console.log(`${name} ${basename(source)}/${mode}: ${(row.median_ns / 1e6).toFixed(4)} ms`);
      }
    }
    emit(report, args.output);
  } catch (error) { console.error(`images: ${error.message}`); process.exitCode = 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
