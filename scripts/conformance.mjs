import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build, root, run } from './internal.mjs';
const options = process.argv.slice(2);
if (options.some(option => option !== '--offline')) throw new Error('Usage: node scripts/conformance.mjs [--offline]');
const renderer = build('svg-render-test-harness', { release: true });
mkdirSync(resolve(root, 'build/svg-conformance'), { recursive: true });
const lock = JSON.parse(readFileSync(resolve(root, 'svg/tests/suites.lock.json'), 'utf8'));
let failed = false;
for (const suite of ['w3c-svg11', 'resvg', 'wpt']) {
  try {
    run(process.execPath, ['svg/scripts/fetch-suites', '--suite', suite, '--full', ...options]);
    const command = [renderer, '{input}', '-o', '{output}', '--resources-dir', '{root}'];
    if (suite === 'w3c-svg11') command.push('--viewport-width', '480', '--viewport-height', '360');
    else if (suite === 'resvg') command.push('--width', '300', '--font-dir', '{root}/crates/resvg/tests/fonts', '--language', 'en');
    else {
      const fonts = resolve(root, 'build/wpt-fonts');
      mkdirSync(fonts, { recursive: true });
      cpSync(resolve(root, 'svg/tests/.cache/suites', lock.suites.wpt.archive.sha256, 'full/fonts'), fonts, { recursive: true });
      cpSync('/usr/share/fonts/truetype/freefont/FreeSans.ttf', resolve(fonts, 'FreeSans.ttf'));
      command.push('--viewport-width', '800', '--viewport-height', '600', '--font-dir', fonts);
    }
    run(process.execPath, ['svg/scripts/reftests', '--suite', suite, '--full', '--renderer', JSON.stringify(command), '--report', `build/svg-conformance/${suite}.json`, '--diff-dir', `build/svg-conformance/${suite}-diffs`], { timeout: 7200000 });
  } catch (error) { failed = true; console.error(error); }
}
try { run(process.execPath, ['scripts/check-xmlconf.mjs', '--report', 'build/svg-conformance/xmlconf.json', ...options]); }
catch (error) { failed = true; console.error(error); }
process.exitCode = failed ? 1 : 0;
