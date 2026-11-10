# svg-wasm

The SVG renderer built for `wasm32-unknown-unknown`, with a small JavaScript wrapper in `js/`.

Build and check from the repository root (linking needs `wasm-ld` on `PATH`):

```sh
silk task build-wasm   # prints build/llvm/wasm32-unknown-unknown/release/svg-wasm
silk task check-wasm
```

The Silk parity task renders every fixture with the module and with the native CLI
and requires identical straight-alpha RGBA pixels, dimensions and failure outcomes.
CI runs it on each pull request. `js/svg.mjs` remains the browser/Node runtime API;
`js/render.mjs` is a single-render Node host adapter. Neither discovers cases,
starts native processes nor makes parity assertions; that automation is in Silk.

## JavaScript

```js
import { SvgRenderer, unpremultiply } from './svg.mjs'

const renderer = await SvgRenderer.instantiate(new URL('svg-wasm', import.meta.url))
const font = new Uint8Array(await (await fetch('NotoSans-Regular.ttf')).arrayBuffer())
const { width, height, pixels } = renderer.render(svgText, [font], { width: 300 })
context.putImageData(new ImageData(unpremultiply(pixels), width, height), 0, 0)
```

The first font is the initial font: its family is the default `font-family`, and its metrics
size `em` and `ex`. Generic families map to the first supplied family of the CLI's lists.
Only `data:` resources load; the module has no file system or network access. Documents
render in static mode.

## Module interface

The module keeps no state between calls. `svg_render(svgLength, fontsLength, width, height,
viewportWidth, viewportHeight)` allocates its two inputs and calls the import
`host.input(slot, pointer, length)` for the host to copy each in: slot 0 is the SVG document,
slot 1 the fonts as little-endian `(length: u32, bytes)` records. On success it calls
`host.output(1, pointer, 8)` with the width and height (little-endian u32) and
`host.output(0, pointer, length)` with premultiplied sRGB RGBA8 pixels, valid only during that
call, and returns 0. Otherwise it returns 1 invalid document, 2 invalid font, 3 too large or
4 out of memory.

The module also imports `math.sin`, `math.cos`, `math.tan`, `math.hypot` and `math.fmod`
(JavaScript's `%`), for the C math functions its dependencies call.
