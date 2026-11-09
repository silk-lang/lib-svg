// Renders fixture inputs with the wasm module and the native CLI and requires identical
// pixels. Usage (from the repository root):
//   node svg/tools/wasm/js/compare.mjs <svg-wasm> <svg-render-test-harness> <manifest.json>...
// Both sides use DejaVu Serif as the initial font and the faces in svg/tests/fonts.
// Cases that load files (not `data:` URLs) are skipped: the module has no file system.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { SvgRenderer, unpremultiply } from './svg.mjs'

const [wasmPath, cliPath, ...manifests] = process.argv.slice(2)
const INITIAL = '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'
const FONT_DIR = 'svg/tests/fonts'

// The CLI writes 8-bit RGBA PNGs with filter None on every row (svg_image.png).
function decodePng(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 8
  let width = 0
  let height = 0
  const data = []
  while (at < bytes.length) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
    } else if (type === 'IDAT') {
      data.push(body)
    }
    at += 12 + length
  }
  const raw = inflateSync(Buffer.concat(data))
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    if (raw[y * (width * 4 + 1)] !== 0) throw new Error('unexpected PNG filter')
    pixels.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4)
  }
  return { width, height, pixels }
}

function loadsFiles(source) {
  const references = [...source.matchAll(/(?:href\s*=\s*["']|url\(\s*["']?|@import\s+["'])([^"')]*)/g)]
  return references.some(([, target]) => target !== '' && !target.startsWith('#') && !target.startsWith('data:'))
}

const fontFiles = readdirSync(FONT_DIR).filter((name) => /\.(ttf|otf)$/.test(name)).sort()
const fonts = [readFileSync(INITIAL), ...fontFiles.map((name) => readFileSync(join(FONT_DIR, name)))]
const renderer = await SvgRenderer.instantiate(readFileSync(wasmPath))
const scratch = mkdtempSync(join(tmpdir(), 'svg-wasm-'))
let compared = 0
let skipped = 0
const failures = []
for (const manifest of manifests) {
  const root = dirname(manifest)
  for (const entry of JSON.parse(readFileSync(manifest, 'utf8')).cases) {
    const input = join(root, entry.input)
    const source = readFileSync(input)
    if (loadsFiles(source.toString('utf8'))) {
      skipped++
      continue
    }
    const png = join(scratch, 'native.png')
    let native = null
    try {
      execFileSync(cliPath, [input, '-o', png, '--font-dir', FONT_DIR], { stdio: 'pipe' })
      native = decodePng(readFileSync(png))
    } catch {
      native = null
    }
    let wasm = null
    try {
      wasm = renderer.render(source, fonts)
    } catch {
      wasm = null
    }
    compared++
    if (native === null || wasm === null) {
      if (native !== wasm) failures.push(`${entry.id}: native ${native ? 'renders' : 'fails'}, wasm ${wasm ? 'renders' : 'fails'}`)
      continue
    }
    const straight = unpremultiply(wasm.pixels)
    let differing = 0
    for (let i = 0; i < straight.length; i++) if (straight[i] !== native.pixels[i]) differing++
    if (wasm.width !== native.width || wasm.height !== native.height || differing > 0) {
      failures.push(`${entry.id}: ${wasm.width}x${wasm.height} vs ${native.width}x${native.height}, ${differing} channel values differ`)
    }
  }
}
console.log(`${compared} cases compared, ${skipped} skipped (they load files), ${failures.length} differ`)
for (const failure of failures) console.log(`  ${failure}`)
process.exit(failures.length === 0 ? 0 : 1)
