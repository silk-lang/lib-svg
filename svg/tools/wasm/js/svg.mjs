// JavaScript wrapper for svg-wasm. No dependencies; works in browsers and Node.

const SVG = 0
const FONTS = 1
const PIXELS = 0
const SIZE = 1
const ERRORS = ['', 'invalid document', 'invalid font', 'too large', 'out of memory']

export class SvgRenderError extends Error {
  constructor(status) {
    super(`svg_render failed: ${ERRORS[status] ?? `status ${status}`}`)
    this.status = status
  }
}

export class SvgRenderer {
  /** `source` is the module's bytes, a Response, or a URL to fetch. */
  static async instantiate(source) {
    let bytes = source
    if (typeof source === 'string' || source instanceof URL) source = await fetch(source)
    if (typeof Response !== 'undefined' && source instanceof Response) {
      bytes = new Uint8Array(await source.arrayBuffer())
    }
    const renderer = new SvgRenderer()
    const { instance } = await WebAssembly.instantiate(bytes, renderer.#imports())
    renderer.#exports = instance.exports
    return renderer
  }

  #exports
  #inputs = []
  #outputs = []

  #imports() {
    return {
      math: {
        sin: Math.sin,
        cos: Math.cos,
        tan: Math.tan,
        hypot: Math.hypot,
        fmod: (x, y) => x % y,
      },
      host: {
        input: (slot, pointer, length) => {
          new Uint8Array(this.#exports.memory.buffer, pointer, length).set(this.#inputs[slot])
        },
        output: (kind, pointer, length) => {
          this.#outputs[kind] = new Uint8Array(this.#exports.memory.buffer, pointer, length).slice()
        },
      },
    }
  }

  /**
   * Renders `svg` (a string or bytes). `fonts` lists font files as bytes; the first face is
   * the initial font. Options: `width` and `height` in output pixels (0 sizes from the
   * document), `viewportWidth` and `viewportHeight` in CSS pixels (default 300 by 150).
   * Returns `{ width, height, pixels }` with premultiplied sRGB RGBA8 pixels.
   */
  render(svg, fonts, options = {}) {
    const document = typeof svg === 'string' ? new TextEncoder().encode(svg) : svg
    let total = 0
    for (const font of fonts) total += 4 + font.length
    const packed = new Uint8Array(total)
    const view = new DataView(packed.buffer)
    let at = 0
    for (const font of fonts) {
      view.setUint32(at, font.length, true)
      packed.set(font, at + 4)
      at += 4 + font.length
    }
    this.#inputs = [document, packed]
    this.#outputs = []
    const status = this.#exports.svg_render(
      document.length,
      packed.length,
      options.width ?? 0,
      options.height ?? 0,
      options.viewportWidth ?? 0,
      options.viewportHeight ?? 0,
    )
    this.#inputs = []
    if (status !== 0) throw new SvgRenderError(status)
    const size = new DataView(this.#outputs[SIZE].buffer)
    return { width: size.getUint32(0, true), height: size.getUint32(4, true), pixels: this.#outputs[PIXELS] }
  }
}

/** Straight-alpha RGBA, as `ImageData` takes, from premultiplied pixels. */
export function unpremultiply(pixels) {
  const out = new Uint8ClampedArray(pixels.length)
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]
    out[i + 3] = a
    if (a === 0) continue
    // As the renderer's PNG encoder: round half up, capped at 255.
    for (let c = i; c < i + 3; c++) out[c] = pixels[c] >= a ? 255 : Math.floor((pixels[c] * 255 + (a >> 1)) / a)
  }
  return out
}
