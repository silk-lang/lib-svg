# SVG implementation limitations

Current workspace toolchain: Silk `0.1.0-dev.72+9c780a04d6ef`. No compiler or stdlib patches. Versioned observations below retain the toolchain used for their original reports.
This file records implementation workarounds, not the unimplemented SVG coverage
listed in [SPECIFICATIONS.md](SPECIFICATIONS.md).

## LIMITATION-1 — Git dependency sources (resolved)

The historical issue was [silk-lang/silk#2558](https://github.com/silk-lang/silk/issues/2558).
Released Silk supports the canonical exact-revision Git dependencies used here.
First fetches for one revision must run serially; no sibling checkout is required.

## Local geometry types

The dev.29 stdlib inspected for the original handoff had no geometry module. The handoff explicitly permits
local `svg_geometry` types until it ships; they are contained in one exported
module. No duplicate geometry-proposal issue was filed: this is the handoff's
chosen API boundary, not a compiler correctness workaround.

## LIMITATION-2 — missing floating-point math

[silk-lang/silk#2539](https://github.com/silk-lang/silk/issues/2539) already covers
the missing `atan2`, `hypot`, trigonometric and color/filter math APIs. A minimal
dev.27 manifest/source reproduction was added to that issue; `f64.atan2`
produces `SEM0014`. `graphics/geometry/src/math.silk` supplies finite-input,
range-reduced `atan2`, scaled `hypot` and bounded degree reduction in pure Silk,
without libc or per-target imports. Arc/transform tests exercise these paths.
Replace the helpers when released stdlib equivalents are available.

## LIMITATION-3 — no DEFLATE output-capacity API

Filed [silk-lang/silk#2565](https://github.com/silk-lang/silk/issues/2565).
`Deflate.encode` requires a caller-owned slice but exposes no checked capacity
bound. For the pinned single fixed-Huffman block, PNG reserves
`n + ceil(n / 8) + 8` bytes for zlib, where `n` includes scanline filter bytes.
Dimension validation bounds every arithmetic operation. Compression writes
directly into the final IDAT payload, without copying a compressed buffer.
The bound depends on the documented dev.27 algorithm and must be reconsidered
when upgrading; replace it with a checked stdlib API when available.

## LIMITATION-4 — stdlib XML parser (resolved)

The historical request was [silk-lang/silk#2563](https://github.com/silk-lang/silk/issues/2563).
Installed `silk.xml` now owns the bounded, nonvalidating XML/namespace parser.
SVG consumes its canonical string-based API directly. The internal root
`xml-compatibility` and `xml-conformance` harnesses retain local and W3C coverage.
Resource/error policies are in [SPECIFICATIONS.md](SPECIFICATIONS.md#xml-error-and-resource-policy).

## LIMITATION-5 — no stdlib PNG codec

Filed [silk-lang/silk#2564](https://github.com/silk-lang/silk/issues/2564).
`svg_image` owns PNG framing, sample conversion, scanline filters and Adam7/APNG
first-frame decoding; DEFLATE/zlib and checksums remain stdlib-owned. JPEG decoding
and SVG image integration remain pending. The image package boundary allows later
codec replacement without changing display-list consumers.

PNG decoding accepts at most 256 MiB of input and the existing 64 Mi-pixel image
limit. Inflation is capped at the exact scanline byte count computed from the
validated dimensions and pass geometry; ICC extraction is separately capped at
16 MiB. The implementation retains compressed scanlines, inflated scanlines and
the output image during decoding, so these are allocation bounds, not a 256 MiB
aggregate-memory promise. CRC/zlib integrity, chunk structure, frame controls and
selected-frame samples are checked; later APNG frame streams are not inflated.
ICC bytes are retained for later profile interpretation and color conversion.
Malformed input returns an error rather than a partial image.

These missing-API reports contain self-contained manifests/sources and observed
compiler diagnostics. There is no working pre-workaround stdlib path, so no
before/after Ir saving is claimed. The renderer baseline measures the current
implementation; its full-process counts do not isolate these API gaps.

## LIMITATION-6 — reusable CSS infrastructure

Filed [silk-lang/silk#2577](https://github.com/silk-lang/silk/issues/2577).
The dev.27 inventory has no CSS tokenizer/parser, selector matching/specificity
or property-independent cascade API; JSON/TOML scanners are not substitutes.
`svg_css` owns these general-purpose operations, variables and conditional rules.
Replace the corresponding modules when released APIs preserve standards-defined
recovery, source spans, tree adaptation and bounded allocation/work. SVG property
definitions and computed-value projection remain local.
[Minimal import probe](https://github.com/silk-lang/silk/issues/2577).

## LIMITATION-7 — WHATWG URL and IDNA semantics

Filed [silk-lang/silk#2578](https://github.com/silk-lang/silk/issues/2578).
`silk.uri` is deliberately RFC 3986: it rejects raw non-ASCII and does not apply
WHATWG normalization/default-port rules. `DomainHost` validates ASCII/Punycode
but leaves internationalized-name conversion and IDNA mapping/context/bidi checks
to callers. `src/url*.silk` therefore owns parsing, base resolution, serialization,
IDNA mapping and Punycode, reusing `silk.text` normalization/properties.
Replace these parts with a released bounded WHATWG URL/UTS #46 API, not an
RFC3986-only substitution; SVG resource authorization stays local.
[Real-API semantic probe](https://github.com/silk-lang/silk/issues/2578).

## LIMITATION-8 — web legacy stylesheet decoding

Filed [silk-lang/silk#2579](https://github.com/silk-lang/silk/issues/2579).
Strict UTF-8 and Unicode normalization exist, but no WHATWG encoding labels,
legacy single-/multibyte decoders or replacement-decoding API is present.
`css/style/src/encoding*.silk` owns bounded decoders and pinned tables.
Replace generic codecs/label lookup when released APIs match replacement,
reconsumption and output-bound semantics; keep CSS protocol/`@charset`/environment
fallback selection in the stylesheet adapter. This is separate from XML #2563.
[Minimal import probe](https://github.com/silk-lang/silk/issues/2579).

For LIMITATION-6–8, [stdlib gaps](https://github.com/silk-lang/lib-fonts/blob/main/modules/docs/stdlib-gaps.md#011--reusable-css-syntax-selectors-and-cascade)
and the linked reproducers record inventory evidence and observed diagnostics.
Illustrative import failures alone do not establish the missing capabilities.
Local parsing/matching, URL/IDNA normalization and decoding consume work/storage,
but no working stdlib A/B path exists. Full-process renderer counts do not measure
a per-gap instruction delta.

## LIMITATION-9 — empty borrowed Option lifetime diagnostic

Filed [silk-lang/silk#2580](https://github.com/silk-lang/silk/issues/2580);
[reproducer](https://github.com/silk-lang/silk/issues/2580).
An omitted reference lifetime in an empty `Option` argument produces `SEM0099`
at the stdlib's generic declaration rather than the constructor. The report
requests a useful diagnostic, not acceptance of an unconstrained lifetime.
The URL parser writes `Option<&'static Url>.None` for an absent base; `Some`
keeps the actual borrow. This is type qualification only, with no runtime work.

## Vector integration limits

The upstream vector backend owns curve approximation, source-curvature stroking
and projective geometry. Pinning and testing it does not establish SVG conformance.
Required backend changes stay upstream; there is no second local rasterizer.

- The executor validates finite path/transform intermediates before vector's
  f32 coverage boundary. Unrepresentable geometry returns `InvalidGeometry`
  rather than reaching an unchecked conversion.
- `fillPolylines` copies the checked flattened lines into vector's scratch.
  Removing this extra list/copy requires a checked borrowed-line upstream API.
- Isolated surfaces currently cover the full viewport. The aggregate 64M-pixel
  ceiling prevents nested opacity from multiplying allocations without bound;
  tighter, offset layers require the later clipping/compositing integration.
- `crispEdges` and `optimizeSpeed` select vector's binary coverage before paint
  application. Paint alpha and compositing stay unchanged; output alpha is never
  thresholded. `geometricPrecision` uses the tighter curve-flattening budget.
- Perspective uses checked upstream homogeneous clipping and source-space strokes.
  Numeric, subdivision and work limits return `InvalidGeometry`; they never
  trigger an affine approximation or coordinate saturation.
- An unclipped projective reference box can be unbounded at the eye plane.
  Such a box cannot be represented by the finite `Rect` API and fails explicitly;
  replacing it with viewport bounds would change `transform-box` semantics.
- The approved 3D profile flattens planes and retains each boundary's positive-w
  domain. It does not retain `preserve-3d` rendering contexts or perform 3D depth
  sorting; this is a profile choice, not SVG property inapplicability.

## JPEG codec API gap

No JPEG codec was present in the dev.32 stdlib inspected for the original report. The baseline/progressive
codec request is tracked in [silk-lang/silk#2617](https://github.com/silk-lang/silk/issues/2617).
The general-purpose `graphics/codec` package is implementing bounded marker,
metadata and entropy decoding locally; its API contains no SVG types.

## LIMITATION-10 — native NaN constant reference

The dev.32 native compiler rejects `f64.NAN` as an unsupported construct
([silk-lang/silk#2621](https://github.com/silk-lang/silk/issues/2621)).
Image-sizing boundary tests use `f64.fromBits(9221120237041090560)` to construct
the same quiet-NaN test input. This changes no rendering code. The original
constant cannot compile, so there is no runnable before/after Ir comparison.
