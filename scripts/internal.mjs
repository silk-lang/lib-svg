// Repository-internal orchestration. Library consumers invoke Silk directly.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repositoryRoot } from './repository-root.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const silk = process.env.SILK || 'silk';
export function run(command, args = [], options = {}) {
  console.error('+', command, ...args);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', timeout: 600000, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} failed (${result.signal || result.status})`);
  }
  return result;
}
export function nativeTarget() {
  const arch = { arm64: 'aarch64', x64: 'x86_64' }[process.arch];
  const system = { darwin: 'apple-darwin', linux: 'unknown-linux-gnu', win32: 'pc-windows-msvc' }[process.platform];
  if (!arch || !system) throw new Error(`Unsupported native host: ${process.platform}/${process.arch}`);
  return `${arch}-${system}`;
}
export function build(packagePath, { release = false, wasm = false } = {}) {
  const manifest = resolve(root, packagePath, 'silk.toml');
  const target = wasm ? 'wasm32-unknown-unknown' : nativeTarget();
  const windowsGPU = process.platform === 'win32' && packagePath === 'modules/gpu/tests' && !wasm;
  if (windowsGPU) {
    run(silk, ['check', '--manifest-path', manifest]);
    run('pwsh', ['-NoProfile', '-File', resolve(repositoryRoot('lib-native'), 'scripts/prepare-windows.ps1')]);
  }
  run(silk, ['build', '--manifest-path', manifest, '--target', target, ...(release ? ['--release'] : [])]);
  const name = readFileSync(manifest, 'utf8').match(/^name\s*=\s*"([^"]+)"/m)?.[1];
  if (!name) throw new Error(`Missing package name: ${manifest}`);
  const filename = name + (!wasm && process.platform === 'win32' ? '.exe' : '');
  const binary = resolve(root, 'build/llvm', target, release ? 'release' : 'debug', filename);
  if (!existsSync(binary)) throw new Error(`Silk did not produce ${binary}`);
  if (windowsGPU) run('pwsh', ['-NoProfile', '-File', resolve(repositoryRoot('lib-native'), 'scripts/prepare-windows.ps1'), '-RuntimeDirectory', dirname(binary)]);
  return binary;
}
