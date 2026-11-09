# svg

An SVG renderer for Silk, written from the specifications (SVG 1.1 Second Edition and SVG 2)
rather than ported from another engine. It parses a document and computes CSS over it. It then
resolves geometry, records a backend-neutral display list, and rasterizes that list to
premultiplied RGBA through [graphics-vector](https://github.com/silk-lang/lib-graphics/tree/main/modules/vector). Browsers and resvg are used as
diagnostic references; [SPECIFICATIONS.md](SPECIFICATIONS.md) records the authority, scope and
coverage.

## What renders today

- **Structure:** outermost and nested `svg`, `g`, `use`, `symbol`, `switch`, views and
  fragment selection, with shadow trees and reference boxes.
- **Styling:** CSS selectors, the cascade, custom properties, presentation attributes,
  inline and external stylesheets, `@media` and `@supports`.
- **Shapes:** paths and basic shapes, with 2D and projective transforms and clipping at
  viewport boundaries.
- **Paint:** solid colours, linear, radial and mesh gradients, patterns, hatches, markers, context paint,
  `paint-order`, `vector-effect`, opacity groups, linear-RGB compositing and `pathLength`
  dashes. All separable and non-separable `mix-blend-mode` values and explicit
  `isolation` are consumed by the CPU layer executor.

Clipping now includes referenced `clipPath` geometry, nested intersections, child unions,
`use`, basic CSS shapes and geometry boxes. Geometric unions are evaluated before
antialias rasterization. Legacy viewport `clip` uses the existing viewport resolver.
Text clipping and projective clip edge cases remain in progress.

SVG mask resources support alpha/luminance coverage, mask units, nested masks,
CSS mask-layer composition, and `linear-gradient()`/`radial-gradient()` (and repeating)
and `url()` raster or SVG image mask layers, with `mask-size`, `mask-position`,
`mask-repeat`, `mask-origin` and `mask-clip`.
PNG and JPEG `<image>` elements now render with intrinsic sizing, aspect-ratio fitting,
CSS image orientation (including EXIF, quarter-turn rotation and flipping), opacity,
affine/projective placement, and CSS nearest, smooth, or two-stage `pixelated`
sampling. Nested SVG images render as independent secure documents with their own
viewport and styles, apply CSS image orientation before sizing, and retain vector
geometry through final placement.
`filter` elements and the CSS filter functions render with their regions, subregions and
every primitive and input, including `feImage` and the background and paint inputs.
Text lays out with font matching, bidi, vertical writing, `textPath` and `inline-size` wrapping.
SMIL animation is sampled at a chosen time, and embedded ICC profiles are applied when images
decode. [Status](docs/status.md) describes what each phase delivered.

## Example

```silk
import svg_render.lib { Pixmap, RenderError, RenderOptions, render }
import svg_render.native_environment { NativeHost, NativeHostError }
import svg_core.resources { DataOnly, Limits, Resolver }
import svg_core.url { Url, UrlError }
import svg_image.png
import svg_image.image { ImageError }
import silk.collections.bytes { Bytes }
import silk.core.effect { Effect }
import silk.mem.allocator { Allocator, OutOfMemoryError }

/// Renders an SVG document to PNG bytes. Only `data:` URLs are resolved.
pub effect fn svgToPng(svg: &[u8]) -> Bytes
  ! RenderError | NativeHostError | UrlError | ImageError | OutOfMemoryError
  ? &mut Allocator {
  let base = run Url.parseAbsolute(b"file:///drawing.svg")
  let host = run NativeHost.make(300.0, 150.0) // the embedding viewport, in CSS px
  let environment = host.environment(&base)
  let mut resolver = DataOnly.make(Limits.defaults())
  let image = run render(svg, &RenderOptions.make(), &environment)
    |> Effect.provideMut<Resolver>(&mut resolver)
  return run png.encodePixels(image.width(), image.height(), image.data())
}
```

External resources go through the `Resolver` service, so the host decides what may be
fetched. `render` is the one-step entry point. `parse`, `record` and `renderDisplayList` expose
the render tree with its computed styles, and a reusable display list. For animation,
`parseAnimated` parses once and `Animated.frame` records the display list at each frame's
`RenderOptions.time` without parsing again. The [API notes](docs/api.md)
cover the environment, processing modes, resource policy and the geometry API.

## Internal command-line test harness

```sh
silk build --release --manifest-path svg-render-test-harness/silk.toml
build/llvm/x86_64-unknown-linux-gnu/release/svg-render-test-harness input.svg -o output.png --width 300
build/llvm/x86_64-unknown-linux-gnu/release/svg-render-test-harness input.svg -o detail.png --fragment '#detail' --mode secure-static
```

The internal harness resolves `data:` URLs and files in the input's directory, and never the network. It
writes nothing unless parsing, rendering and encoding all succeed. It is not a public product CLI.

## Packages

| Path | Package | What it is |
| --- | --- | --- |
| `modules` | `svg` | Document styling, structure and geometry resolution (imported as `svg_core`) |
| `modules/render` | `svg-render` | Render tree, display list and the rendering entry points (`svg_render`) |
| `modules/raster` | `svg-raster` | Executes display lists on the CPU through `vector`, or lowers them onto a canvas |
| `modules/gpu` | `svg-gpu` | Draws display lists through `gpu_scene` ([README](gpu/README.md)) |
| `modules/filters` | `svg-filters` | Filter programs and their execution over `vector.filter` |
| `svg-render-test-harness` (repository root) | `svg-render-test-harness` | Internal command-line test renderer |
| `modules/tests` | `svg-tests` | Test inputs, suite pins and reviewed expectations |
| `modules/bench` | `svg-bench` | Renderer workloads and the resvg comparison |

XML parsing uses installed `silk.xml`; CSS comes from [lib-css](https://github.com/silk-lang/lib-css).
Text measurement and font matching come from [lib-fonts](https://github.com/silk-lang/lib-fonts).
Geometry, codecs and CPU/GPU backends are pinned [lib-graphics](https://github.com/silk-lang/lib-graphics) dependencies.

## Tests

From the repository root:

```sh
node modules/scripts/check
```

The gate type-checks and tests every SVG package. It then builds the release CLI and renders the
project's own reference tests (including 53 exact-RGBA painting tests), malformed inputs, and a
curated subset of the resvg suite. Every result is compared with a reviewed expectation, so a
known failure is recorded as one and never counted as a pass. It runs in the `svg` CI
workflow. `node modules/scripts/test-gpu` compares SVG CPU/GPU rendering; unrelated
graphics package gates stay in lib-graphics. [Testing](docs/testing.md) covers
specification/suite caches, expectations and the reftest runner.

## Conformance

The scheduled `svg-conformance` workflow renders three full external suites. Each case is
compared exactly with its reference, and its outcome is recorded in a reviewed expectation file
under [tests/expectations](tests/expectations). Each fail or spec difference there gives a reason.

| Suite | Cases | Pass | Fail | Spec difference | Skip |
| --- | ---: | ---: | ---: | ---: | ---: |
| resvg | 1,751 | 295 | 1,220 | 234 | 2 |
| W3C SVG 1.1 Second Edition | 525 | 1 | 427 | 8 | 89 |
| WPT SVG reftests | 2,290 | 312 | 24 | 43 | 1,911 |

Most resvg failures are antialiasing differences along edges, with the shapes themselves
matching. The cases that differ in content are colour fonts, `plus-lighter`, letter-spacing in
cursive scripts, and some complex-script text placement. The W3C references are screenshots
taken from other renderers, so an exact match is rare there. Each W3C failure records how it
differs from Chrome, and the skipped cases need scripting. Most WPT cases are skipped because
they are HTML documents or need script; of the SVG reftests that remain, the failures are mostly
tentative features and text that needs fonts the suite does not ship. A spec difference means
the specification and resvg or the browsers disagree, and this renderer follows the specification.
[SPECIFICATIONS.md](SPECIFICATIONS.md) lists each of those decisions.

The coverage checklist in [SPECIFICATIONS.md](SPECIFICATIONS.md) is complete except for some
text features: `shape-padding`, vertical text in `shape-inside`, `vkern` and external SVG
fonts.
`hitTest` finds the element under a point by `pointer-events` (see [docs/api.md](docs/api.md)).
The renderer also builds for wasm32; see [wasm/README.md](tools/wasm/README.md).

## Performance

The renderer is correct first and not yet fast. Against resvg, end-to-end time ranges from
0.66× on a 2,048-rule stylesheet workload to about 5× on icon and curve-heavy workloads. Parsing
and recording dominate. [Performance](docs/performance.md) has the per-stage tables, the A/B
method and how to reproduce them.

## Limitations

[LIMITATIONS.md](LIMITATIONS.md) records workarounds for gaps in the compiler and standard
library.

## License

MIT or Apache-2.0.
