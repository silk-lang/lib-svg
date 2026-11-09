import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function repositoryRoot(name) {
  if (!/^lib-[a-z]+$/.test(name)) throw new Error(`Invalid repository name: ${name}`);
  const workspace = readFileSync(resolve(root, 'silk.toml'), 'utf8');
  const members = workspace.match(/members\s*=\s*\[([\s\S]*?)\]/)?.[1];
  if (!members) throw new Error('Missing workspace members');
  const revisions = new Set();
  for (const [, member] of members.matchAll(/"([^"]+)"/g)) {
    const manifest = readFileSync(resolve(root, member, 'silk.toml'), 'utf8');
    for (const [, entry] of manifest.matchAll(/=\s*\{([^}\n]+)\}/g)) {
      if (!entry.includes(`git = "https://github.com/silk-lang/${name}.git"`)) continue;
      const revision = entry.match(/\brev\s*=\s*"([0-9a-f]{40})"/)?.[1];
      if (!revision) throw new Error(`Unpinned ${name} dependency in ${member}`);
      revisions.add(revision);
    }
  }
  if (revisions.size !== 1) throw new Error(`Expected one ${name} revision, got ${[...revisions]}`);
  const directory = resolve(process.env.SILK_HOME || resolve(homedir(), '.silk'), 'git', [...revisions][0]);
  if (!existsSync(resolve(directory, 'silk.toml'))) throw new Error(`Missing fetched ${name} payload: run silk check --manifest-path modules/gpu/tests/silk.toml first`);
  return directory;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(repositoryRoot(process.argv[2] || 'lib-native'));
