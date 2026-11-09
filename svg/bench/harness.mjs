// Native stage-wall-time orchestration. Each sample is one complete workload
// pass, not an average document; native checksums consume outputs outside timing.
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { arch, cpus, platform, release, tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { HERE, prepare } from './workloads.mjs';

const ROOT = resolve(HERE, '../..');
export const MODES = ['parse', 'render', 'end-to-end'];
export const STAGES = {
  parse: 'XML + computed style + geometry resolve + Silk record / usvg render-ready retained tree; not raw resolve. Retained result rasterized and consumed outside timing.',
  render: 'Reuse retained display list/tree; allocate and zero a fresh destination inside every timed render; checksum and destination destruction outside timing.',
  'end-to-end': 'Parse + record (Silk) / usvg retained tree + allocate/zero + render + intermediate-tree destruction. File I/O, PNG encoding, checksum and destination destruction excluded.',
};
const TIMER = 'native monotonic wall clock; Node process.hrtime.bigint separately records process wall time';
const LEGACY_TIMER = 'native monotonic wall clock; Python perf_counter_ns separately records process wall time';
export const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
export const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
export function workload_hash(paths) {
  const digest = createHash('sha256');
  for (const path of [...paths].sort((a, b) => basename(a) < basename(b) ? -1 : basename(a) > basename(b) ? 1 : 0)) {
    const name = Buffer.from(basename(path)), data = readFileSync(path), length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(name.length)); digest.update(length); digest.update(name);
    length.writeBigUInt64BE(BigInt(data.length)); digest.update(length); digest.update(data);
  }
  return digest.digest('hex');
}
export function callgrind_ir(text) {
  let events, summary;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('events:')) events = line.trim().split(/\s+/).slice(1);
    else if (line.startsWith('summary:')) summary = line.trim().split(/\s+/).slice(1);
  }
  if (!events?.includes('Ir') || !summary || events.length !== summary.length) throw new Error('Callgrind output has no complete Ir summary');
  const count = Number(summary[events.indexOf('Ir')]);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Callgrind Ir summary is not a safe nonnegative integer');
  return count;
}
export function baseline_ratios(current, baseline) {
  const normalized = config => config?.timer === LEGACY_TIMER ? { ...config, timer: TIMER } : config;
  for (const field of ['protocol', 'config', 'workloads']) {
    const a = field === 'config' ? normalized(current[field]) : current[field];
    const b = field === 'config' ? normalized(baseline[field]) : baseline[field];
    if (!isDeepStrictEqual(a, b)) throw new Error(`baseline ${field} differs; compare the same configuration and workload hashes or explicitly record a new baseline`);
  }
  for (const field of ['workload_manifest_sha256', 'reference_pin']) if (current[field] !== baseline[field]) throw new Error(`baseline ${field} differs`);
  const ratios = {};
  for (const [engine, values] of Object.entries(current.results)) {
    if (!baseline.results[engine] || !isDeepStrictEqual(Object.keys(values).sort(), Object.keys(baseline.results[engine]).sort())) throw new Error(`baseline stages differ for ${engine}`);
    ratios[engine] = {};
    for (const [key, value] of Object.entries(values)) {
      const previous = baseline.results[engine][key].median_ns;
      if (!(previous > 0)) throw new Error(`baseline has nonpositive measured time for ${engine}/${key}`);
      ratios[engine][key] = value.median_ns / previous;
    }
  }
  return ratios;
}
export function execute(command, args, { timeout = 300, allowFailure = false } = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: timeout * 1000, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.signal || (!allowFailure && result.status !== 0)) throw new Error(`${command}: ${result.signal || `exit ${result.status}`}\n${result.stderr}`);
  return result;
}
function tool_version(command, args = []) {
  try { const result = execute(command, args, { timeout: 20 }); return (result.stdout || result.stderr).trim(); }
  catch (error) { return `unavailable: ${error.message}`; }
}
export function environment(binaries) {
  return {
    platform: `${platform()}-${release()}`, machine: arch(), cpu: cpus()[0]?.model || '', logical_cpus: cpus().length,
    tool_versions: { node: process.version, silk: tool_version(process.env.SILK || 'silk', ['--version']), rustc: tool_version(process.env.RUSTC || 'rustc', ['--version', '--verbose']), cargo: tool_version(process.env.CARGO || 'cargo', ['--version']), clang: tool_version(process.env.SILK_CLANG || 'clang', ['--version']) },
    build_environment: Object.fromEntries(['SILK_CLANG', 'RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'CARGO_TARGET_DIR'].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]])),
    binaries: Object.fromEntries(Object.entries(binaries).map(([label, path]) => [label, { path, sha256: sha256(path), version: tool_version(path, ['--version']) }])),
  };
}
export function validate_result(result, args, binary = 'benchmark') {
  for (const [field, expected] of [['protocol', 1], ['iterations', args.iterations], ['warmup', args.warmup]]) if (result[field] !== expected) throw new Error(`${binary}: unexpected ${field} in benchmark output`);
  if (!Number.isSafeInteger(result.elapsed_ns) || result.elapsed_ns <= 0) throw new Error(`${binary}: no positive native stage measurement`);
  if (!(result.width > 0 && result.height > 0)) throw new Error(`${binary}: no rendered image dimensions`);
  // Protocol counters are decimal strings: Number would silently truncate u64.
  const integer = value => {
    if ((typeof value !== 'string' || !/^\d+$/.test(value)) && !(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) throw new Error(`${binary}: invalid unsigned checksum counter`);
    return BigInt(value);
  };
  const checksum = integer(result.checksum), consumed = integer(result.consumed);
  if (checksum < 0n || checksum >= 2n ** 64n || consumed !== BigInt.asUintN(64, checksum * BigInt(args.iterations + args.warmup))) throw new Error(`${binary}: outputs changed within an invocation`);
  return result;
}
export function invoke(binary, mode, path, args, prefix = []) {
  const command = [...prefix, binary, mode, path, String(args.iterations), String(args.warmup)];
  const start = process.hrtime.bigint();
  const completed = execute(command[0], command.slice(1), { timeout: args.timeout });
  const wall = Number(process.hrtime.bigint() - start);
  return [validate_result(JSON.parse(completed.stdout), args, binary), wall];
}
export function process_ir(binary, mode, path, args) {
  const directory = mkdtempSync(join(tmpdir(), 'svg-callgrind-'));
  try {
    const output = join(directory, 'callgrind.out');
    invoke(binary, mode, path, args, ['valgrind', '--tool=callgrind', '--error-exitcode=99', `--callgrind-out-file=${output}`]);
    return callgrind_ir(readFileSync(output, 'utf8'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
export function require_callgrind() {
  if (platform() !== 'linux') throw new Error('--callgrind requires Linux and a working Valgrind/Callgrind installation for this architecture');
  return execute('valgrind', ['--version'], { timeout: 20 }).stdout.trim();
}
export async function measure(args, binaries) {
  const manifestPath = join(HERE, 'workloads.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (sha256(join(HERE, manifest.generator)) !== manifest.generator_sha256) throw new Error('workload generator differs from its tracked manifest hash');
  const paths = await prepare(manifest, join(HERE, '.cache/workloads'), args.fetch_workloads, args.workload ?? null);
  const report = {
    protocol: 1, measured_at_utc: new Date().toISOString(), environment: environment(binaries),
    config: { iterations: args.iterations, warmup: args.warmup, samples: args.samples, modes: args.mode || MODES, callgrind: args.callgrind, pixmap_policy: 'fresh zeroed allocation per render, included in stage time', sample_unit: 'one complete workload pass; sum per-file native times / iterations', timer: TIMER },
    stages: STAGES, workload_manifest_sha256: sha256(manifestPath), reference_pin: JSON.parse(readFileSync(join(ROOT, 'svg/tests/suites.lock.json'), 'utf8')).suites.resvg.revision,
    workloads: Object.fromEntries(Object.entries(paths).map(([name, files]) => [name, { sha256: workload_hash(files), documents: files.length, bytes: files.reduce((n, path) => n + statSync(path).size, 0), spec: manifest.workloads[name] }])), results: Object.fromEntries(Object.keys(binaries).map(label => [label, {}])),
  };
  if (binaries.rust && !report.environment.binaries.rust.version.includes(report.reference_pin)) throw new Error('Rust benchmark --version does not identify the exact suites.lock.json resvg pin');
  if (args.callgrind) {
    report.environment.tool_versions.valgrind = require_callgrind();
    report.callgrind_scope = 'Full separate process invocation, including startup, file I/O, setup, warmup, checksum and untimed parse-result rasterization; Ir is NOT a stage-only counter. Wall-time samples above run without Valgrind.';
  }
  const labels = Object.keys(binaries);
  for (const [name, files] of Object.entries(paths)) for (const mode of report.config.modes) {
    const key = `${name}/${mode}`, measurements = Object.fromEntries(labels.map(label => [label, { samples_ns: [], process_wall_samples_ns: [], outputs: {} }]));
    for (let sample = 0; sample < args.samples; sample++) for (const label of sample % 2 ? [...labels].reverse() : labels) {
      let elapsed = 0, wall = 0;
      const outputs = {};
      for (const path of files) {
        const [result, processWall] = invoke(binaries[label], mode, path, args);
        elapsed += result.elapsed_ns; wall += processWall;
        outputs[basename(path)] = { checksum: result.checksum, width: result.width, height: result.height };
      }
      const measured = measurements[label];
      if (sample && !isDeepStrictEqual(measured.outputs, outputs)) throw new Error(`${label} ${key}: output checksum or dimensions changed between samples`);
      measured.outputs = outputs;
      measured.samples_ns.push(elapsed / args.iterations); measured.process_wall_samples_ns.push(wall);
    }
    for (const [label, measured] of Object.entries(measurements)) {
      measured.median_ns = median(measured.samples_ns); measured.process_wall_median_ns = median(measured.process_wall_samples_ns);
      if (args.callgrind) measured.callgrind_process_Ir = files.reduce((n, path) => n + process_ir(binaries[label], mode, path, args), 0);
      report.results[label][key] = measured;
      console.error(`${label.padStart(5)} ${key.padEnd(26)} ${(measured.median_ns / 1e6).toFixed(4)} ms/workload (median of ${args.samples}, ${args.iterations} iterations, ${args.warmup} warmup)`);
    }
  }
  const [left, right] = labels;
  for (const [key, value] of Object.entries(report.results[left])) for (const [filename, output] of Object.entries(value.outputs)) {
    const other = report.results[right][key].outputs[filename];
    if (output.width !== other.width || output.height !== other.height) throw new Error(`${key}/${filename}: output dimensions differ; refusing a ratio for unequal raster workloads`);
  }
  report.comparison = {
    ratio_definition: `${left}/${right} native median stage time; >1 means ${left} slower`,
    ratios: Object.fromEntries(Object.entries(report.results[left]).map(([key, value]) => [key, value.median_ns / report.results[right][key].median_ns])),
    checksum_equal: Object.fromEntries(Object.entries(report.results[left]).map(([key, value]) => [key, isDeepStrictEqual(value.outputs, report.results[right][key].outputs)])),
    checksum_note: 'FNV-1a over every premultiplied RGBA byte. Numerical rasterization differences are allowed; equality is not a pixel-conformance verdict.',
  };
  for (const [key, ratio] of Object.entries(report.comparison.ratios)) console.error(`${key.padEnd(26)} ${left}/${right}=${ratio.toFixed(4)} checksum_equal=${report.comparison.checksum_equal[key]}`);
  return report;
}
export function validate(args, binaries) {
  if (!Number.isInteger(args.iterations) || args.iterations < 1 || args.iterations > 100000 || !Number.isInteger(args.warmup) || args.warmup < 0 || args.warmup > 10000 || !Number.isInteger(args.samples) || args.samples < 1 || args.samples > 100) throw new Error('iterations must be 1..100000, warmup 0..10000, samples 1..100');
  if (!(args.timeout > 0 && args.timeout <= 3600)) throw new Error('timeout must be >0 and <=3600 seconds');
  for (const [label, binary] of Object.entries(binaries)) {
    try { if (!statSync(binary).isFile()) throw new Error(); accessSync(binary, constants.X_OK); }
    catch { throw new Error(`${label} executable missing or not executable: ${binary}; build it explicitly first`); }
  }
}
export function emit(report, output) {
  const text = JSON.stringify(report, null, 2) + '\n';
  if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, text); }
  else process.stdout.write(text);
}
const common = {
  iterations: { type: 'string', default: '3' }, warmup: { type: 'string', default: '1' }, samples: { type: 'string', default: '5' }, timeout: { type: 'string', default: '300' },
  mode: { type: 'string', multiple: true }, workload: { type: 'string', multiple: true }, 'fetch-workloads': { type: 'boolean', default: false }, callgrind: { type: 'boolean', default: false }, output: { type: 'string' }, help: { type: 'boolean', short: 'h' },
};
export function parse_options(options, { allowPositionals = false, argv = process.argv.slice(2) } = {}) {
  const { values, positionals } = parseArgs({ args: argv, options, allowPositionals });
  const args = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.replaceAll('-', '_'), value]));
  for (const key of ['iterations', 'warmup', 'samples', 'timeout']) if (key in args) args[key] = Number(args[key]);
  return { args, positionals };
}
export async function main(kind, argv = process.argv.slice(2)) {
  try {
    const options = kind === 'bench' ? { ...common, silk: { type: 'string' }, rust: { type: 'string', default: join(ROOT, 'svg/scripts/rust-bench/target/release/svg-reference-bench') }, baseline: { type: 'string', default: join(HERE, 'baseline.json') }, 'record-baseline': { type: 'boolean', default: false } } : common;
    const { args, positionals } = parse_options(options, { allowPositionals: kind === 'ab', argv });
    if (args.help) {
      console.log(kind === 'bench' ? 'Usage: node svg/scripts/bench --silk BINARY [--rust BINARY] [--baseline FILE] [--record-baseline]' : 'Usage: node svg/scripts/ab OLDBINARY NEWBINARY');
      console.log('Options: --iterations N --warmup N --samples N --mode parse|render|end-to-end (repeatable)\n  --workload NAME (repeatable) --fetch-workloads --callgrind --timeout SECONDS --output FILE');
      return;
    }
    const manifest = JSON.parse(readFileSync(join(HERE, 'workloads.json'), 'utf8'));
    for (const mode of args.mode || []) if (!MODES.includes(mode)) throw new Error(`unknown mode: ${mode}`);
    for (const name of args.workload || []) if (!(name in manifest.workloads)) throw new Error(`unknown workload: ${name}`);
    let binaries, baseline;
    if (kind === 'bench') {
      if (!args.silk) throw new Error('--silk is required');
      if (args.output && resolve(args.output) === resolve(args.baseline)) throw new Error('--output cannot overwrite the baseline; use --record-baseline');
      if (!args.record_baseline && !existsSync(args.baseline)) throw new Error('baseline missing; first run with --record-baseline to record real measurements');
      baseline = args.record_baseline ? null : JSON.parse(readFileSync(args.baseline, 'utf8'));
      binaries = { silk: resolve(args.silk), rust: resolve(args.rust) };
    } else {
      if (positionals.length !== 2) throw new Error('oldbinary and newbinary are required');
      if (args.output && resolve(args.output) === join(HERE, 'baseline.json')) throw new Error('ab cannot overwrite baseline.json; use bench --record-baseline');
      binaries = { new: resolve(positionals[1]), old: resolve(positionals[0]) };
    }
    validate(args, binaries);
    const report = await measure(args, binaries);
    if (kind === 'bench') {
      if (baseline) {
        report.baseline_comparison = { ratio_definition: 'current/baseline; >1 is slower', ratios: baseline_ratios(report, baseline), environment_changed: !isDeepStrictEqual(report.environment, baseline.environment) };
        for (const [engine, values] of Object.entries(report.baseline_comparison.ratios)) for (const [key, ratio] of Object.entries(values)) console.error(`baseline ${engine} ${key}: current/previous=${ratio.toFixed(4)}`);
      } else { emit(report, args.baseline); console.error(`Recorded measured baseline: ${args.baseline}`); }
    }
    emit(report, args.output);
  } catch (error) { console.error(`${kind}: ${error.message}`); process.exitCode = 1; }
}
