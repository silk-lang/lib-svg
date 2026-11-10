// Runtime adapter for the JavaScript-facing WebAssembly API, not a corpus runner.
// The Silk task owns case discovery, native execution, skips and pixel assertions.
// Output is two little-endian u32 dimensions followed by straight-alpha RGBA8.
import { readFileSync, writeFileSync } from 'node:fs'
import { SvgRenderer, unpremultiply } from './svg.mjs'

const [modulePath, inputPath, outputPath, ...fontPaths] = process.argv.slice(2)
const renderer = await SvgRenderer.instantiate(readFileSync(modulePath))
const image = renderer.render(readFileSync(inputPath), fontPaths.map(path => readFileSync(path)))
const dimensions = Buffer.alloc(8)
dimensions.writeUInt32LE(image.width, 0)
dimensions.writeUInt32LE(image.height, 4)
// unpremultiply returns a Uint8ClampedArray, which Buffer.concat does not accept.
const pixels = unpremultiply(image.pixels)
writeFileSync(
  outputPath,
  Buffer.concat([dimensions, Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength)]),
)
