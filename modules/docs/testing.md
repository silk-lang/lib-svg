# Testing the SVG implementation

## The gate

See the [repository prerequisites](../../README.md#prerequisites): pinned Silk,
LLVM 22.1.8 (`SILK_CLANG` absolute), Node 22+ and `npm ci`. From the repository root:

```sh
node modules/scripts/check
node modules/scripts/test-gpu
node scripts/check-wasm.mjs
node scripts/check-xmlconf.mjs --report build/svg/xmlconf.json
```

The first command serially checks every workspace package, formatting and all
Silk test roots, then Node tooling tests and the release internal render harness.
It renders all own fixture manifests and malformed cases, followed by the curated
resvg subset. Known pixel failures remain failures in the ledger, never successes;
unexpected changes fail the gate. Reports go under ignored `build/svg/`.
The separate GPU and wasm commands compare real rendering backends. Wasm parity
requires the Linux DejaVu initial face and intentionally reports file-loading
inputs as unsupported because the wasm host has no filesystem.

The XML compatibility test root preserves the original local parser's tests but
imports only the installed stdlib `silk.xml.document`. The W3C XML driver keeps the
namespace-aware, nonvalidating XML 1.0 Fifth Edition selection: XML/NS 1.1,
earlier-edition-only, namespace-unaware and optional-error cases are explicitly
counted separately; not-well-formed cases whose error is in an unread external
entity are also excluded. These are the established processor policy, not new
extraction-specific skips.

`node modules/scripts/check --offline` verifies populated caches. `--skip-fetch`
omits IDNA/spec reference fetching and external corpus rendering, but still runs
all local Silk/Node tests and all own/malformed rendering cases. It is a local
source-only command, not a substitute for the full CI gate. CSS/font generation
and graphics-only gates belong to their standalone repositories.

## Specifications and suites

```sh
node modules/scripts/fetch-specs.mjs             # verify/fetch all 155 locked documents
node modules/scripts/fetch-specs.mjs --offline   # verify cached original bytes
node modules/scripts/fetch-suites               # reviewed curated resvg inputs/resources
node modules/scripts/reftests --validate        # schema, cache integrity and coverage only
node modules/scripts/fetch-suites --suite resvg --full
node modules/scripts/fetch-suites --suite w3c-svg11 --full
node modules/scripts/fetch-suites --suite wpt --full
node scripts/conformance.mjs                # render every reviewed external suite and XML
```

Caches live inside `modules/.cache/` and `modules/tests/.cache/`, never in source control.
Explicit `--update` refreshes pins; review changed hashes and upstream revisions.
Git suite updates also require a full reviewed commit in `--revision`. Reftest
rendering never implicitly downloads. Full suites and benchmarks run on schedule
or explicit dispatch, not as reduced substitutes for PR unit/own-corpus tests.

`modules/tests/expectations/*.txt` contains JSON with `version`, `suite`, and `cases`.
Every case names `id`, `status`, `reason`, and an HTTPS normative `spec` anchor.
Status is `pass`, `fail`, `spec-difference` or `skip`; differences also record
`spec_result` and `reference_result`. Optional `tolerance` records channel and
pixel limits with a reason. `antialias_channel` applies only when both samples
have partial alpha, never to opaque/transparent changes. It is opt-in per case.
Missing/stale expectations, unexpected passes/failures, renderer crashes and
missing output fail the runner. `failed_cases` includes known non-passes;
`gate_failures` counts unexpected/untriaged outcomes. Untriaged is not passing.

The adapter executes an explicitly supplied renderer without a shell:

```sh
node modules/scripts/reftests \
  --renderer '["/path/to/svg-render-test-harness", "{input}", "--width", "300", "-o", "{output}"]' \
  --expectations /path/to/reviewed-expectations.json \
  --report build/svg/report.json
```

Resvg uses width 300 with its suite fonts and English language. W3C SVG 1.1 uses
a 480×360 viewport. WPT uses 800×600 over white, its bundled fonts and system
FreeSans. `scripts/conformance.mjs` supplies these original protocols and keeps
resource reads confined to each suite root. The comparison decodes RGBA including
alpha and dimensions; it never silently resizes results. Multiple WPT matching
references are alternatives, while every mismatch reference must differ.
`--diff-dir build/svg/diffs` writes unexpected-failure images. HTML/script/manual
WPT cases remain explicitly reported.

`npm test` runs repository tooling tests without Silk builds or renderer runs.
Node PNG/XML/HTML/archive packages are internal tooling dependencies, not Silk
runtime dependencies. Optional historical Python fixture authoring is outside
all supported build, verification, benchmark and CI paths.
