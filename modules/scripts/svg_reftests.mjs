import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import { SaxesParser } from 'saxes';
import { parse as parseHtml } from 'parse5';
import { DEFAULT_CACHE, DEFAULT_LOCK, ROOT, contained, fetchSuite, loadLock, isObject, isFile, inside, resolvedPath } from './svg_suites.mjs';

export const WPT_AREAS = ['svg', 'css/filter-effects', 'css/css-masking', 'css/compositing', 'css/css-transforms'];
export const OWN_FIXTURES = path.join(ROOT, 'modules/tests/fixtures');
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const STATUSES = new Set(['pass', 'fail', 'spec-difference', 'skip']);
export function validateExpectation(entry) {
  if (!isObject(entry) || typeof entry.id !== 'string' || !entry.id) throw new Error('expectation requires a nonempty id');
  if (!STATUSES.has(entry.status)) throw new Error(`${entry.id}: unknown expectation status`);
  for (const field of ['reason', 'spec']) if (typeof entry[field] !== 'string' || !entry[field].trim()) throw new Error(`${entry.id}: missing ${field}`);
  if (!entry.spec.startsWith('https://') || !entry.spec.split('#').slice(1).join('#')) throw new Error(`${entry.id}: spec must be an HTTPS normative #anchor citation`);
  if (entry.status === 'spec-difference') for (const field of ['spec_result', 'reference_result']) if (typeof entry[field] !== 'string' || !entry[field].trim()) throw new Error(`${entry.id}: spec difference requires ${field}`);
  const tolerance = Object.hasOwn(entry, 'tolerance') ? entry.tolerance : {};
  if (!isObject(tolerance) || Object.keys(tolerance).some(key => !['channel', 'pixels', 'antialias_channel', 'reason'].includes(key))) throw new Error(`${entry.id}: invalid tolerance`);
  for (const [field, maximum] of [['channel', 255], ['antialias_channel', 255], ['pixels', 100000000]]) {
    const value = Object.hasOwn(tolerance, field) ? tolerance[field] : 0;
    if (!Number.isInteger(value) || value < 0 || value > maximum) throw new Error(`${entry.id}: invalid ${field} tolerance`);
  }
  if (Object.keys(tolerance).length && !String(tolerance.reason ?? '').trim()) throw new Error(`${entry.id}: tolerance needs a reason`);
}
export function loadExpectations(name, suite) {
  const data = JSON.parse(fs.readFileSync(name, 'utf8'));
  if (data.version !== 1 || data.suite !== suite) throw new Error('expectation version/suite mismatch');
  const result = Object.create(null);
  for (const entry of data.cases) {
    validateExpectation(entry);
    if (Object.hasOwn(result, entry.id)) throw new Error(`duplicate expectation: ${entry.id}`);
    result[entry.id] = entry;
  }
  return result;
}
export function walk(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const name = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(name));
    else if (isFile(name)) files.push(name);
  }
  return files.sort();
}
export function loadOwnManifest(name, malformed = false) {
  const data = JSON.parse(fs.readFileSync(name, 'utf8'));
  if (!isObject(data) || data.version !== 1 || data.suite !== 'own' || data.mode !== (malformed ? 'malformed' : 'reference')) throw new Error('own manifest version/suite/mode mismatch');
  const cases = data.cases;
  if (!Array.isArray(cases) || !cases.length) throw new Error('own manifest requires nonempty cases');
  const root = fs.realpathSync(path.dirname(name)); const expectations = Object.create(null); const files = new Set(); const inputs = new Set();
  for (const entry of cases) {
    if (!isObject(entry)) throw new Error('own case must be an object');
    validateExpectation(entry); contained(root, entry.id);
    if (entry.status !== 'pass') throw new Error(`${entry.id}: own cases must have status pass`);
    if (Object.hasOwn(expectations, entry.id)) throw new Error(`duplicate own case: ${entry.id}`);
    expectations[entry.id] = entry;
    const source = entry.input; const inputPath = contained(root, source);
    if (!['.svg', '.svgz'].includes(path.extname(inputPath))) throw new Error(`${entry.id}: input must be SVG or compressed SVG`);
    if (inputs.has(source)) throw new Error(`duplicate own input: ${source}`);
    inputs.add(source);
    const args = Object.hasOwn(entry, 'arguments') ? entry.arguments : [];
    if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw new Error(`${entry.id}: arguments must be an array of renderer options`);
    const references = Object.hasOwn(entry, 'references') ? entry.references : [];
    if (!Array.isArray(references)) throw new Error(`${entry.id}: references must be an array`);
    let needsReference = true;
    if (malformed) {
      const code = entry.exit_code; const presence = entry.output_present;
      if (!Number.isInteger(code) || ![0, 1].includes(code) || typeof presence !== 'boolean' || presence !== (code === 0)) throw new Error(`${entry.id}: malformed contract requires exit 1 without output or exit 0 with output`);
      if (code === 1 && references.length) throw new Error(`${entry.id}: rejected input cannot have references`);
      needsReference = code === 0;
    }
    if (needsReference && !references.length) throw new Error(`${entry.id}: missing references`);
    const names = [source];
    for (const reference of references) {
      if (!isObject(reference) || !['==', '!='].includes(reference.relation)) throw new Error(`${entry.id}: invalid reference`);
      const refPath = contained(root, reference.path);
      if (!['.svg', '.png'].includes(path.extname(refPath))) throw new Error(`${entry.id}: reference must be SVG or PNG`);
      if (resolvedPath(refPath) === resolvedPath(inputPath)) throw new Error(`${entry.id}: input cannot reference itself`);
      names.push(reference.path);
    }
    for (const name of names) { if (!isFile(contained(root, name))) throw new Error(`${entry.id}: missing fixture ${name}`); files.add(name); }
  }
  const unlisted = walk(root).filter(name => ['.svg', '.svgz', '.png'].includes(path.extname(name))).map(name => path.relative(root, name).split(path.sep).join('/')).filter(name => !files.has(name));
  if (unlisted.length) throw new Error(`unlisted own fixtures: ${unlisted.slice(0, 10).join(', ')}`);
  return [root, cases, expectations];
}
export function readPng(name) {
  // Bound dimensions before pngjs allocates the decompressed image.
  const bytes = fs.readFileSync(name);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error(`renderer output is not PNG: ${name}`);
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  if (width * height > 16000000) throw new Error('PNG exceeds 16 million pixel comparison limit');
  if (!width || !height) throw new Error('invalid PNG dimensions');
  const image = PNG.sync.read(bytes, { skipRescale: bytes[24] === 16 });
  let data = image.data;
  if (image.depth === 16) {
    data = Buffer.allocUnsafe(width * height * 4);
    // Pillow uses integer grayscale and the high byte of multichannel 16-bit PNGs.
    for (let index = 0; index < data.length; index++) data[index] = image.colorType === 0 && index % 4 !== 3 ? Math.min(255, image.data[index]) : image.data[index] >>> 8;
  }
  // pngjs clears RGB for tRNS samples; Pillow preserves those invisible channels.
  if (image.transColor) {
    const samples = image.transColor.length === 1 ? Array(3).fill(image.transColor[0]) : image.transColor;
    const converted = samples.map(sample => image.depth === 16 ? (image.colorType === 0 ? Math.min(255, sample) : sample >>> 8) : Math.round(sample * 255 / (2 ** image.depth - 1)));
    for (let index = 0; index < data.length; index += 4) if (data[index + 3] === 0) for (let channel = 0; channel < 3; channel++) data[index + channel] = converted[channel];
  }
  return [width, height, data];
}
export function onWhite([width, height, data], size = [800, 600]) {
  const [outWidth, outHeight] = size; const canvas = Buffer.alloc(outWidth * outHeight * 4, 255);
  for (let y = 0; y < Math.min(height, outHeight); y++) for (let x = 0; x < Math.min(width, outWidth); x++) {
    const source = (y * width + x) * 4; const target = (y * outWidth + x) * 4; const alpha = data[source + 3];
    for (let c = 0; c < 3; c++) canvas[target + c] = Math.round((data[source + c] * alpha + 255 * (255 - alpha)) / 255);
  }
  return [outWidth, outHeight, canvas];
}
export function compareRgba([aw, ah, a], [bw, bh, b], channel = 0, pixels = 0, antialiasChannel = 0) {
  if (a.length !== aw * ah * 4 || b.length !== bw * bh * 4) throw new Error('invalid RGBA buffer length');
  if (aw !== bw || ah !== bh) return { match: false, reason: 'image dimensions differ', actual_size: [aw, ah], reference_size: [bw, bh] };
  let different = 0; let maximum = 0;
  for (let offset = 0; offset < a.length; offset += 4) {
    let delta = 0; for (let c = 0; c < 4; c++) delta = Math.max(delta, Math.abs(a[offset + c] - b[offset + c]));
    maximum = Math.max(maximum, delta);
    const partial = a[offset + 3] > 0 && a[offset + 3] < 255 && b[offset + 3] > 0 && b[offset + 3] < 255;
    if (delta > (partial ? Math.max(channel, antialiasChannel) : channel)) different++;
  }
  return { match: different <= pixels, different_pixels: different, max_channel_difference: maximum, channel_tolerance: channel, antialias_channel_tolerance: antialiasChannel, pixel_tolerance: pixels };
}
export function outcome(expected, matched) {
  if (expected === 'pass') return matched ? 'pass' : 'unexpected-fail';
  if (['fail', 'spec-difference'].includes(expected)) return matched ? 'unexpected-pass' : expected;
  throw new Error('skip cases must not be compared');
}
export function rendererArgv(command, inputPath, outputPath, root = '.') {
  if (!Array.isArray(command) || !command.length || command.some(arg => typeof arg !== 'string')) throw new Error('--renderer must be a JSON array of argv strings');
  if (!command.some(arg => arg.includes('{input}')) || !command.some(arg => arg.includes('{output}'))) throw new Error('renderer argv requires {input} and {output} placeholders');
  return command.map(arg => arg.replaceAll('{input}', inputPath).replaceAll('{output}', outputPath).replaceAll('{root}', root));
}
function links(text) {
  const references = [];
  function visit(node) {
    if (node.tagName?.split(':').at(-1) === 'link') {
      const attrs = Object.fromEntries((node.attrs ?? []).map(attr => [attr.name, attr.value]));
      if (['match', 'mismatch'].includes(attrs.rel)) references.push([attrs.href ?? '', attrs.rel]);
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  }
  visit(parseHtml(text)); return references;
}
export function svgDocument(name) {
  const bytes = fs.readFileSync(name);
  let encoding = 'utf-8';
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0)) encoding = 'utf-16le';
  else if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c)) encoding = 'utf-16be';
  else encoding = /^<\?xml\s[^?]*encoding\s*=\s*['"]([^'"]+)['"]/i.exec(bytes.subarray(0, 512).toString('ascii'))?.[1] ?? encoding;
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('DTD/entity-dependent WPT needs manual adaptation');
  const parser = new SaxesParser({ xmlns: true }); let root = null;
  parser.on('error', error => { throw error; });
  parser.on('opentag', node => {
    if (!root) {
      root = node;
      if (node.local !== 'svg' || node.uri !== SVG_NAMESPACE) throw new Error('HTML layout or non-SVG document required');
    }
    if (node.local === 'script' || Object.values(node.attributes).some(attribute => attribute.local.startsWith('on'))) throw new Error('script or event handler required');
    if (node.local === 'foreignObject') throw new Error('foreignObject HTML layout requires manual adaptation');
    if ((node.attributes.class?.value ?? '').split(/\s+/).includes('reftest-wait')) throw new Error('script-driven reftest-wait required');
  });
  parser.write(text).close(); return root;
}
export function wptCases(root) {
  root = path.resolve(root); const cases = [];
  for (const name of walk(root)) {
    if (!['.svg', '.html', '.xhtml', '.htm'].includes(path.extname(name))) continue;
    const relative = path.relative(root, name).split(path.sep).join('/');
    if (fs.existsSync(path.join(root, 'svg')) && !WPT_AREAS.some(area => relative.startsWith(`${area}/`))) continue;
    const references = links(fs.readFileSync(name, 'utf8')); if (!references.length) continue;
    const entry = { id: relative, input: relative, references: [], canvas: 'white' };
    try {
      if (path.extname(name) !== '.svg') throw new Error('HTML layout required; not a standalone SVG reftest');
      svgDocument(name);
      for (const [href, relation] of references) {
        if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//') || /[?#]/.test(href)) throw new Error('external/query/fragment reference needs manual adaptation');
        // URL percent decoding retains invalid UTF-8 as replacement characters, like unquote.
        const decoded = href.replace(/(?:%[0-9a-f]{2})+/gi, encoded => Buffer.from(encoded.replaceAll('%', ''), 'hex').toString('utf8'));
        if (decoded.includes('\\') || !decoded) throw new Error('invalid reference path');
        const reference = resolvedPath(decoded.startsWith('/') ? path.join(root, decoded.replace(/^\/+/, '')) : path.resolve(path.dirname(name), decoded));
        if (!inside(root, reference)) throw new Error('reference outside suite root');
        if (path.extname(reference) !== '.svg') throw new Error('reference requires HTML layout rather than standalone SVG');
        if (!isFile(reference)) throw new Error('reference resource absent from fetched scope');
        svgDocument(reference);
        entry.references.push({ path: path.relative(resolvedPath(root), reference).split(path.sep).join('/'), relation: relation === 'match' ? '==' : '!=' });
      }
    } catch (error) { entry.skip_reason = error.message; }
    cases.push(entry);
  }
  return cases;
}
export function discoverCases(root, suite, lock, full) {
  if (suite === 'wpt') return wptCases(root);
  if (suite === 'resvg' && !full) return lock.suites[suite].curated.map(entry => ({ id: entry.id, input: entry.files[0].path, references: [{ path: entry.files[1].path, relation: '==' }] }));
  const source = path.join(root, suite === 'resvg' ? 'crates/resvg/tests/tests' : 'svg');
  return walk(source).filter(name => path.extname(name) === '.svg').map(name => {
    const relative = path.relative(source, name);
    const reference = suite === 'resvg' ? name.slice(0, -4) + '.png' : path.join(root, 'png', relative.slice(0, -4) + '.png');
    const entry = { id: relative.slice(0, -4).split(path.sep).join('/'), input: path.relative(root, name).split(path.sep).join('/'), references: [{ path: path.relative(root, reference).split(path.sep).join('/'), relation: '==' }] };
    if (!isFile(reference)) entry.skip_reason = 'upstream provides no PNG reference; manual pass-criteria adaptation required';
    return entry;
  });
}
export function execute(command, timeout) {
  return new Promise((resolve, reject) => {
    let child; let stderr = ''; let timedOut = false;
    try { child = spawn(command[0], command.slice(1), { stdio: ['ignore', 'ignore', 'pipe'], shell: false }); }
    catch (error) { reject(error); return; }
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-2000); });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout * 1000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`renderer timed out after ${timeout} seconds`));
      else resolve({ returncode: code ?? -(os.constants.signals[signal] ?? 1), stderr });
    });
  });
}
export async function render(command, source, output, timeout, root = '.') {
  const process = await execute(rendererArgv(command, resolvedPath(source), path.resolve(output), resolvedPath(root)), timeout);
  if (process.returncode) throw new Error(`renderer exited ${process.returncode}: ${process.stderr}`);
  if (!isFile(output)) throw new Error('renderer did not produce its requested PNG');
  return readPng(output);
}
export function writeDiff(actual, reference, name) {
  if (actual[0] !== reference[0] || actual[1] !== reference[1]) return;
  const data = Buffer.allocUnsafe(actual[2].length);
  for (let offset = 0; offset < data.length; offset += 4) {
    for (let c = 0; c < 3; c++) data[offset + c] = Math.abs(actual[2][offset + c] - reference[2][offset + c]);
    data[offset + 3] = 255;
    if (actual[2][offset + 3] !== reference[2][offset + 3]) { data[offset] = 255; data[offset + 1] = 0; data[offset + 2] = 255; }
  }
  fs.mkdirSync(path.dirname(name), { recursive: true });
  fs.writeFileSync(name, PNG.sync.write({ width: actual[0], height: actual[1], data }));
}
export async function runCase(entry, expectation, root, command, timeout, diffDir = null, renderer = render) {
  const result = { id: entry.id, expected: expectation.status, reason: expectation.reason, spec: expectation.spec, rendered: false };
  if (expectation.status === 'skip') return { ...result, outcome: 'skip' };
  if (entry.skip_reason) return { ...result, outcome: 'error', detail: entry.skip_reason };
  const tolerance = expectation.tolerance ?? {}; const comparisons = [];
  let temporary;
  try {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'svg-reftest-'));
    let actual = await renderer([...command, ...(entry.arguments ?? [])], contained(root, entry.input), path.join(temporary, 'actual.png'), timeout, root);
    result.rendered = true;
    const white = entry.canvas === 'white'; if (white) actual = onWhite(actual);
    const pairs = [];
    for (const [index, ref] of entry.references.entries()) {
      const name = contained(root, ref.path);
      let reference = path.extname(name) === '.png' ? readPng(name) : await renderer(command, name, path.join(temporary, `reference-${index}.png`), timeout, root);
      if (white) reference = onWhite(reference);
      comparisons.push({ ...compareRgba(actual, reference, tolerance.channel ?? 0, tolerance.pixels ?? 0, tolerance.antialias_channel ?? 0), reference: ref.path, relation: ref.relation });
      pairs.push(reference);
    }
    const equal = comparisons.filter(r => r.relation === '==').map(r => r.match);
    const unequal = comparisons.filter(r => r.relation === '!=').map(r => !r.match);
    const matched = (!equal.length || equal.some(Boolean)) && unequal.every(Boolean);
    if (!comparisons.length) throw new Error('case has no references');
    result.outcome = outcome(expectation.status, matched); result.comparisons = comparisons;
    if (diffDir && result.outcome === 'unexpected-fail') for (const [index, reference] of pairs.entries()) if (!comparisons[index].match) writeDiff(actual, reference, contained(diffDir, `${entry.id}-${index}.png`));
  } catch (error) { Object.assign(result, { outcome: 'error', detail: error.message }); }
  finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
  return result;
}
export async function runMalformedCase(entry, root, command, timeout, diffDir = null) {
  if (entry.exit_code === 0) return { ...await runCase(entry, entry, root, command, timeout, diffDir), expected_exit_code: 0, expected_output_present: true };
  const result = { id: entry.id, expected: 'pass', reason: entry.reason, spec: entry.spec, rendered: false, expected_exit_code: 1, expected_output_present: false }; let temporary;
  try {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'svg-malformed-')); const output = path.join(temporary, 'actual.png');
    const process = await execute(rendererArgv(command, resolvedPath(contained(root, entry.input)), output, resolvedPath(root)), timeout);
    Object.assign(result, { exit_code: process.returncode, output_present: fs.existsSync(output), stderr: process.stderr });
    result.outcome = process.returncode === 1 && !fs.existsSync(output) ? 'pass' : 'error';
    if (result.outcome === 'error') result.detail = 'expected CLI rejection (exit 1, no output); crashes and other exits are not rejection';
  } catch (error) { Object.assign(result, { outcome: 'error', detail: error.message }); }
  finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
  return result;
}
export async function main(argv = process.argv.slice(2)) {
  try {
    const { values: args } = parseArgs({ args: argv, options: {
      suite: { type: 'string', default: 'resvg' }, lock: { type: 'string', default: DEFAULT_LOCK }, 'cache-dir': { type: 'string', default: DEFAULT_CACHE },
      full: { type: 'boolean' }, expectations: { type: 'string' }, manifest: { type: 'string' }, malformed: { type: 'boolean' }, validate: { type: 'boolean' },
      renderer: { type: 'string' }, timeout: { type: 'string', default: '30' }, report: { type: 'string' }, 'diff-dir': { type: 'string' }, help: { type: 'boolean' },
    } });
    if (args.help) { console.log('reftests [--suite own|resvg|w3c-svg11|wpt] [--validate | --renderer JSON_ARGV] [--full] [--manifest PATH] [--malformed] [--expectations PATH] [--lock PATH] [--cache-dir PATH] [--timeout SECONDS] [--report PATH] [--diff-dir PATH]'); return 0; }
    if (!['own', 'resvg', 'w3c-svg11', 'wpt'].includes(args.suite)) throw new Error('unknown suite');
    const timeout = Number(args.timeout);
    if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('timeout must be positive');
    if (args.suite !== 'own' && (args.manifest || args.malformed)) throw new Error('--manifest and --malformed require --suite own');
    if (args.suite === 'own' && (args.expectations || args.full)) throw new Error('own suite uses its manifest, not --expectations or --full');
    const command = args.renderer ? JSON.parse(args.renderer) : null;
    if (!args.validate) rendererArgv(command, 'input.svg', 'output.png');
    let root, cases, expectations;
    if (args.suite === 'own') [root, cases, expectations] = loadOwnManifest(args.manifest ?? path.join(OWN_FIXTURES, args.malformed ? 'malformed' : 'own', 'manifest.json'), args.malformed);
    else {
      const lock = loadLock(args.lock);
      root = await fetchSuite(lock, args.suite, args['cache-dir'], args.full, true);
      expectations = loadExpectations(args.expectations ?? path.join(ROOT, 'modules/tests/expectations', `${args.suite}.txt`), args.suite);
      cases = discoverCases(root, args.suite, lock, args.full);
    }
    if (!cases.length) throw new Error('no reftest cases discovered');
    const ids = new Set(cases.map(entry => entry.id));
    if (args.suite === 'resvg' && !args.full) expectations = Object.fromEntries(Object.entries(expectations).filter(([id]) => ids.has(id)));
    const stale = Object.keys(expectations).filter(id => !ids.has(id)).sort();
    if (stale.length) throw new Error(`expectations name absent cases: ${stale.slice(0, 10).join(', ')}`);
    const results = [];
    for (const entry of cases) {
      const expectation = Object.hasOwn(expectations, entry.id) ? expectations[entry.id] : null;
      if (!expectation) results.push({ id: entry.id, outcome: 'untriaged', rendered: false, reason: entry.skip_reason ?? 'no reviewed expectation; rendering/conformance not evaluated' });
      else if (args.validate) results.push({ id: entry.id, outcome: 'validated', expected: expectation.status, rendered: false, reason: expectation.reason });
      else if (args.malformed) results.push(await runMalformedCase(entry, root, command, timeout, args['diff-dir']));
      else results.push(await runCase(entry, expectation, root, command, timeout, args['diff-dir']));
    }
    const failures = new Set(['unexpected-pass', 'unexpected-fail', 'error', 'untriaged']);
    const report = { suite: args.suite, mode: args.validate ? 'validate-only' : args.malformed ? 'malformed' : 'render', rendered_cases: results.filter(r => r.rendered).length, passed_cases: results.filter(r => r.outcome === 'pass').length, failed_cases: results.filter(r => ['fail', 'unexpected-fail', 'error'].includes(r.outcome)).length, gate_failures: results.filter(r => failures.has(r.outcome)).length, results };
    const text = JSON.stringify(report, null, 2) + '\n';
    if (args.report) { fs.mkdirSync(path.dirname(args.report), { recursive: true }); fs.writeFileSync(args.report, text); }
    process.stdout.write(text); return report.gate_failures ? 1 : 0;
  } catch (error) { console.error(`reftests: ${error.message}`); return 1; }
}
