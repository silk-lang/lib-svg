#!/usr/bin/env node
// Compare parse+record costs of identical plain/gzip/zlib source bytes.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { platform, release, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gzipSync, deflateSync } from 'node:zlib';
import { execute, invoke, validate_result, parse_options, validate, require_callgrind, process_ir, median, sha256, emit } from './harness.mjs';

export async function main(argv = process.argv.slice(2)) {
  try {
    const { args } = parse_options({ silk: { type: 'string' }, rust: { type: 'string' }, input: { type: 'string' }, output: { type: 'string' }, callgrind: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' } }, { argv });
    if (args.help) { console.log('Usage: node modules/bench/compressed.mjs --silk BINARY --rust BINARY --input FILE --output FILE [--callgrind]'); return; }
    if (![args.silk, args.rust, args.input, args.output].every(Boolean)) throw new Error('--silk, --rust, --input and --output are required');
    const options = { iterations: 5, warmup: 1, samples: 3, timeout: 120 };
    const binaries = { silk: resolve(args.silk), resvg: resolve(args.rust) };
    validate(options, binaries);
    if (args.callgrind) require_callgrind();
    const source = readFileSync(args.input), hash = data => createHash('sha256').update(data).digest('hex');
    const payloads = { plain: source, gzip: gzipSync(source, { level: 9 }), zlib: deflateSync(source) };
    const report = { platform: `${platform()}-${release()}`, input_sha256: hash(source), iterations: 5, warmup: 1, samples: 3, stage: 'parse+record', rows: [], binaries: {} };
    const directory = mkdtempSync(join(tmpdir(), 'svg-compressed-bench-'));
    try {
      for (const [engine, executable] of Object.entries(binaries)) {
        report.binaries[engine] = { path: executable, sha256: sha256(executable) };
        let originalChecksum;
        for (const [encoding, payload] of Object.entries(payloads)) {
          const path = join(directory, `${encoding}.svg`);
          writeFileSync(path, payload);
          const row = { engine, encoding, bytes: payload.length, sha256: hash(payload) };
          // usvg supports gzip, not bare zlib. Only its documented exit=1 is
          // unsupported input; crashes/timeouts/other failures remain fatal.
          const probe = execute(executable, ['parse', path, '5', '1'], { timeout: 120, allowFailure: true });
          if (probe.status !== 0) {
            if (engine !== 'resvg' || encoding !== 'zlib' || probe.status !== 1) throw new Error(probe.stderr || `${executable}: exit ${probe.status}`);
            Object.assign(row, { supported: false, stderr: probe.stderr.trim(), exit_code: probe.status });
            report.rows.push(row); continue;
          }
          const samples = [validate_result(JSON.parse(probe.stdout), options, executable)];
          for (let i = 0; i < 2; i++) samples.push(invoke(executable, 'parse', path, options)[0]);
          const checksum = samples[0].checksum;
          if (encoding === 'plain') originalChecksum = checksum;
          for (const sample of samples) if (sample.checksum !== originalChecksum) throw new Error('invalid timing or compressed/plain output mismatch');
          Object.assign(row, { supported: true, checksum, median_ms: median(samples.map(sample => sample.elapsed_ns / 5 / 1e6)), samples });
          if (args.callgrind && engine === 'silk') row.process_ir = process_ir(executable, 'parse', path, { iterations: 1, warmup: 0, timeout: 300 });
          report.rows.push(row);
          console.log(`${engine}/${encoding}: ${row.median_ms.toFixed(4)} ms/parse+record`);
        }
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
    emit(report, args.output);
  } catch (error) { console.error(`compressed: ${error.message}`); process.exitCode = 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
