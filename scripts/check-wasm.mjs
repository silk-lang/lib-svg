import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build, root, run } from './internal.mjs';
// This parity protocol fixes the initial native face to Linux DejaVu Serif.
if (!existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf')) throw new Error('Wasm/native corpus parity requires Linux fonts-dejavu-core (DejaVuSerif.ttf)');
const wasm = build('modules/tools/wasm', { release: true, wasm: true });
const native = build('svg-render-test-harness', { release: true });
const fixtures = resolve(root, 'modules/tests/fixtures');
const manifests = readdirSync(fixtures).sort().map(name => resolve(fixtures, name, 'manifest.json')).filter(existsSync);
run(process.execPath, ['modules/tools/wasm/js/compare.mjs', wasm, native, ...manifests]);
