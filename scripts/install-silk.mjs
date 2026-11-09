// Bootstrap only: builds and tests invoke Silk directly. Requires Node 22+ and tar.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, run } from './internal.mjs';

const lock = JSON.parse(readFileSync(resolve(root, 'toolchains.lock.json'), 'utf8')).silk;
const arch = { arm64: 'aarch64', x64: 'x86_64' }[process.arch];
const system = { darwin: 'apple-darwin', linux: 'unknown-linux-gnu', win32: 'pc-windows-msvc' }[process.platform];
const target = `${arch}-${system}`;
const asset = lock.platforms[target];
if (!asset) throw new Error(`No pinned Silk compiler for ${target}`);
const destination = resolve(root, '.cache/silk', lock.version, target);
const compiler = resolve(destination, 'bin', process.platform === 'win32' ? 'silkc.exe' : 'silkc');
const marker = resolve(destination, '.archive-sha256');
if (existsSync(destination)) {
  if (!existsSync(marker) || readFileSync(marker, 'utf8').trim() !== asset.sha256 || !existsSync(compiler)) {
    throw new Error(`Incomplete or unverified compiler installation: ${destination}; remove it before reinstalling`);
  }
} else {
  const downloads = resolve(root, '.cache/downloads');
  mkdirSync(downloads, { recursive: true });
  const archive = resolve(downloads, asset.sha256 + (asset.url.endsWith('.zip') ? '.zip' : '.tar.gz'));
  if (!existsSync(archive)) {
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error(`Compiler download failed: ${response.status} ${asset.url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
      throw new Error('Compiler download size/checksum mismatch');
    }
    writeFileSync(archive, bytes);
  }
  const bytes = readFileSync(archive);
  if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
    throw new Error(`Cached compiler archive checksum mismatch: ${archive}`);
  }
  const parent = resolve(destination, '..');
  mkdirSync(parent, { recursive: true });
  const temporary = mkdtempSync(resolve(parent, '.extract-'));
  try {
    run('tar', ['-xf', archive, '-C', temporary]);
    const entries = readdirSync(temporary, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0].isDirectory()) throw new Error('Expected a single compiler release directory');
    renameSync(resolve(temporary, entries[0].name), destination);
    if (!existsSync(compiler)) throw new Error(`Release lacks ${compiler}`);
    writeFileSync(marker, asset.sha256 + '\n');
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
const bin = resolve(destination, 'bin');
if (process.env.GITHUB_PATH) appendFileSync(process.env.GITHUB_PATH, bin + '\n');
console.log(bin);
