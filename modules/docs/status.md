# SVG implementation status

What each phase delivered and how it was checked. The [README](../README.md) has the summary.

The renderer computes CSS over source documents and rendering occurrences before
resolving outermost/nested `svg`, groups, `use`, `symbol`, paths and basic shapes.
Selectors, cascade/custom properties, presentation attributes, inline/external
stylesheets, media/supports conditions, typed geometry and transforms are integrated.
Solid and paint-server fills/strokes, viewports, inherited paint, visibility and
isolated opacity produce premultiplied RGBA8 through the shared CPU `vector`
backend. The internal `svg-render-test-harness` writes PNG; source XML, occurrence/computed-style trees and
display lists are public.

Integration checks exercise CSS precedence, reference geometry, projective
transforms, nested positive-w clipping, backface visibility and resource limits.
The actual CLI's CSS fixture matches its literal reference. A 256×64 projective
CLI smoke also matches an independent affine/polygon control with zero differing
pixels, including parent perspective and nested flattening boundaries. The CLI's
512×512 stylesheet workload (2,048 rules and rectangles) matches an independent
pixel control exactly; its benchmark checksum also agrees with resvg.
The integrated phase-4 SVG gate passes on macOS arm64 and Ubuntu 24.04 arm64.
These checks do not establish conformance for the full viewer.

The phase-4 structural fixtures match 12 literal pixel references exactly,
including shadow inheritance, symbol sizing, switch selection, foreign-content
boundaries and reference boxes, asymmetric overflow and projective viewport clips.
Fragment tests exercise `:target`, selected views, view-transform ordering, spatial
media fragments and malformed-fragment recovery. Actual CLI checks cover all four
processing modes, nested external uses and explicit fragment selection. The
512×512 repeated-instance workload, containing 1,024 nested symbol instances,
matches an independent integer-pixel control exactly. These are focused checks,
not a full conformance claim.

Phase 5 adds linear and two-circle radial gradients, reusable pattern pictures,
markers on equivalent shape paths, context paint, `paint-order`, host-space vector
effects and linear-RGB interpolation/compositing. Paint metadata and resource
children use computed CSS and the existing occurrence/reference machinery.
`pathLength` calibrates absolute dash distances using certified native path
metrics; viewport percentages remain unchanged. Numeric/resource refusal policies
and unresolved specification choices are recorded in [SPECIFICATIONS.md](../SPECIFICATIONS.md#paint-and-vector-effect-interpretation-decisions).

The integrated dev.29 gate passes on macOS arm64, including 53 exact-RGBA
painting reftests. These cover gradient degeneracies, reusable/nested pattern
pictures and overflow, marker/context-paint placement, vector effects, painting
order, linear-RGB compositing and calibrated dashes. Nanounit geometry magnified
by a billion retains dash placement; signed-zero and unrepresentable period
arithmetic have dedicated regression coverage. No existing expectation was relaxed.

Phase 6 begins with typed blend modes retained through scene recording and CPU
layer execution. Ordinary groups share their parent's backdrop; explicit
isolation, non-normal blending, opacity and specified 3D transforms establish
isolated surfaces. The compositing manifest checks all 16 blend functions against
literal colors calculated from the normative equations, plus group opacity,
non-inheritance and 2D/3D isolation. No comparison tolerance is used.

Clipping is in progress: retained boolean geometry handles sibling unions and nested
intersections before antialiasing. Own fixtures cover resource units, transforms,
`use`, invalid children, paint-independent geometry, duplicate and shared edges,
CSS basic shapes and geometry boxes. Unresolved clip URLs retain their required
stacking context. Legacy viewport `clip` also has exact reftests for viewBox scaling, auto edges
and inapplicability to ordinary shapes. Text clipping, broader projective cases
and performance improvements are still pending.

SVG mask resources now render in isolated surfaces with user-space/object-bounding-box
regions and content coordinates. Alpha and luminance extraction honor `mask-type`,
`mask-mode`, and the mask element’s `color-interpolation`. Layer lists compose from
back to front using add, subtract, intersect, or exclude; shorter mode/operator lists
repeat. Exact fixtures include partial alpha, three-layer ordering, nested masks,
missing resources, and preservation of earlier siblings. CSS `<gradient>` layers
(linear, radial and repeating, with hints, currentColor stops and premultiplied
interpolation) are sized, positioned and tiled per mask-size, mask-position,
mask-repeat (repeat, space, round, no-repeat), mask-origin and mask-clip. Twenty-three
exact reftests compare them with equivalent SVG gradient masks or literal geometry.
`url()` layers naming PNG, JPEG or SVG images load through the resolver like `<image>`
sources and use their natural size, orientation and sampling; eight more reftests cover
them. Broader conformance and mask performance gates remain open.

Phase 8 has started with the filter graph: `filter` elements with their region,
`filterUnits`, `primitiveUnits`, subregions and named results, filter lists of `url()`
references, and `feFlood`, `feOffset`, `feGaussianBlur`, `feMerge`, `feBlend`,
`feComposite`, `feColorMatrix`, `feComponentTransfer`, `feMorphology`, `feTile`,
`feDropShadow`, `feTurbulence`, `feConvolveMatrix`, `feDisplacementMap`,
`feDiffuseLighting` and `feSpecularLighting` with the three light sources, `feImage`
with image resources, SVG documents and element references, the `BackgroundImage`,
`BackgroundAlpha`, `FillPaint` and `StrokePaint` inputs, in sRGB or
linearRGB, also under rotation and skew; the CSS filter functions; `href` templates and
SVG 1.1 `filterRes`, `feBlend`'s `no-composite` and `kernelUnitLength`. 151 reftests in `tests/fixtures/filters` compare them with equivalent
shapes, spec expansions, markup equivalents or, for turbulence, images of the reference
code's output. `enable-background: new` with its optional region is honoured as
FE1 Appendix A allows.

The curated resvg set gains 85 of resvg's 410 filter cases. Rendered at width 300
over all 410 cases, 77 match resvg's PNG exactly, and those 77 are curated as passes.
Seven are curated as spec differences, where FE1 and resvg disagree (FillPaint,
default subregions, feImage element references, missing filter references, a
pass-through feConvolveMatrix and oversaturation). One more, a Gaussian blur, is a
strict non-pass from the two engines' different blur approximations. Most of the other
filter cases differ from resvg by blur approximation, turbulence initialization (FE1's
reference code), or resvg behaviour that the spec does not share.

Text, animation and ICC remain required later work, not
exclusions from scope. `shape-rendering` controls current
shape rasterization; computed image/text hints gain consumers in their own phases.
Parsing those properties does not implement their rendering.

The curated resvg set also includes eleven mask-resource cases: seven exact PNG
matches and four strict non-passes covering gradient luminance/alpha and the mask
root transform. The latter retain measured differences without tolerance; they
remain open conformance work alongside the exact own fixtures.

Phase 7 has a standalone PNG decoder in `graphics/codec`: all standard color
and sample-depth combinations, palette and sample transparency, five scanline
filters, Adam7, and APNG's first animation frame. The decoder retains gAMA, cHRM,
sRGB intent and bounded decompressed iCCP data for the color-management consumer;
it does not yet transform source samples. Independent fixtures and malformed-input
tests cover framing, CRC/zlib integrity, output limits, truncated streams, palette
indices, metadata order, and APNG frame bounds/sequences. PNG samples now feed SVG image rendering; source color conversion and the remaining
phase-7 integrations are still open.

JPEG work now reconstructs 8-bit grayscale and three-component sequential and
progressive streams, including separate-component scans, spectral selection,
successive approximation, restart intervals and partial MCUs. EXIF orientation
is retained alongside samples; the general orientation helper handles all eight
rotations/reflections without resampling. Progressive regression fixtures cover 4:4:4,
4:2:2 and 4:2:0 with exact comparison against sequential encodings of the same
coefficients; malformed scans and every truncation of a progressive fixture are
rejected. Chroma reconstruction currently uses nearest samples. JPEG ICC chunks
are assembled in sequence order, including between progressive scans, with missing/duplicate/inconsistent chunk rejection. ICC interpretation,
broader format coverage remain open. SVG image rendering now consumes these samples.

Phase-7 compressed-document work recognizes gzip/zlib root SVG sources and
external SVG source references, including compressed data URLs and concatenated
gzip members. XML encoding detection follows decompression. Checksums, truncation,
optional headers, streaming output and aggregate expansion limits have dedicated
tests. Nested SVG images use the same compressed-response parser.

Raster image integration now retains PNG/JPEG assets across image occurrences,
resolves intrinsic/auto sizes, applies EXIF orientation, and maps samples through
preserveAspectRatio and full projective transforms. Broken images paint nothing;
secure-mode external requests never reach the resolver. SVG image hints select
nearest (`optimizeSpeed`/`crisp-edges`), bilinear (`auto`/`optimizeQuality`/
`smooth`/`high-quality`), or two-stage `pixelated` sampling. Exact
fixtures cover sizing, meet/slice/none, opacity, use instances and projective
placement. CSS `image-orientation` supports inherited metadata selection, `none`,
angles rounded to quarter turns, and horizontal flipping after rotation. Natural
dimensions follow each occurrence’s orientation while decoded pixels remain shared.
Nested SVG images now retain independent secure documents with per-viewport layout.
Root intrinsic dimensions, selected fragments and viewBox ratios determine image
fitting; outer CSS does not enter the child. Equal sources and logical viewports
share a retained picture, while different viewports compute separate media and
percentage contexts. Child geometry, paints and clip planes execute under the
full device mapping, including projective placement, without an intrinsic-size
raster intermediate. SVG image orientation swaps intrinsic axes and the child
viewport before composing the final rotation/flip, including ratio-only sizing. CSS image mask layers are integrated as well.

The curated resvg set includes eight image cases with strict non-pass expectations.
Six retain sampling/sample-conversion or transformed-edge differences; two reference
JPEG files outside the CLI's input-directory resource root. All remain visible in
the conformance ledger. The exact own image fixtures independently cover natural
sizing, source alpha, JPEG orientation, image masks/patterns and projective mapping.
Base64 payloads now follow Fetch/Infra forgiving decoding, including whitespace,
missing padding and discarded trailing bits, with bounded preflight validation.
