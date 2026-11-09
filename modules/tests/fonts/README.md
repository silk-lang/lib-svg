# Test fonts

Subsets of fonts from resvg's test corpus (`crates/resvg/tests/fonts` at the pinned
revision in `tests/suites.lock.json`), used by the font database and text tests, and one
generated font. The resvg fonts are under the SIL Open Font License except
TwitterColorEmoji (MIT); the license files sit next to them.

- `NotoSans-{Bold,Italic,Black,Light,Thin}`, `NotoSerif-Regular`, `NotoMono-Regular`:
  `pyftsubset <font>.ttf --unicodes="U+0020-007E" --layout-features='*' --name-IDs='*' --name-languages='*'`
- `NotoSans-Regular`: the same, with `--unicodes="U+0020-007E,U+00A0-00FF,U+0300-036F,U+0370-03FF,U+FB01-FB02"`
  for marks, composition and fallback.
- `Amiri-Regular`: `pyftsubset Amiri-Regular.ttf --unicodes="U+0020-007E,U+0621-064A,U+0660-0669" --layout-features='*' --name-IDs='*' --name-languages='*'`
  for Arabic shaping and bidi.
- `RobotoFlex`: resvg's subset with every axis but `opsz`, `wght`, `wdth` and `slnt` pinned to its
  default (`fontTools.varLib.instancer`).
- `MPLUS1p-Regular` (with `vhea`/`vmtx` and `vert`): `pyftsubset MPLUS1p-Regular.ttf --unicodes="U+0020-007E,U+3001-3002,U+300C-300D,U+30FC,U+3042-3093,U+30A2-30F3,U+5B57,U+6F22,U+7E26,U+66F8" --layout-features='*' --name-IDs='*' --name-languages='*'`
  for vertical text.
- `TwitterColorEmoji.subset` (MIT, license file next to it): resvg's subset, unchanged, for
  SVG glyph documents.
- `SvgGlyphs`: written by `scripts/svg-glyph-font.py` (needs fontTools), a tiny font whose
  `SVG ` table exercises shared and gzip-compressed glyph documents and context paint.
