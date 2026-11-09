import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, run } from './internal.mjs';
const tests = ['svg/scripts/tests', 'svg/bench'].flatMap(path => readdirSync(resolve(root, path)).filter(name => /^(?:test_.*|.*\.test)\.mjs$/.test(name)).map(name => `${path}/${name}`));
if (!tests.length) throw new Error('Missing tooling tests');
run(process.execPath, ['--test', ...tests]);
