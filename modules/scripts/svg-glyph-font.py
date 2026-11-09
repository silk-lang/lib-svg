#!/usr/bin/env python3
"""Writes tests/fonts/SvgGlyphs.ttf, a small font with an OpenType `SVG ` table.

Needs fontTools (not part of the gate; the font is committed). Units per em are 1000.
Glyph outlines are plain squares, which a renderer that draws SVG glyphs never shows:

- `A` (glyph 1) and `B` (glyph 2) share one gzip-compressed document. `glyph1` is a
  rectangle in context-fill; `glyph2` is a circle with a context-stroke outline inside a
  translated group, so the group's transform applies and the sibling glyph does not
  render.
- `C` (glyph 3) is its own uncompressed document whose root element is the glyph, with
  content above the baseline at negative y and below it at positive y.
- `D` (glyph 4) has no SVG document and draws its outline.
"""
import gzip
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import newTable

OUT = Path(__file__).resolve().parents[1] / 'tests/fonts/SvgGlyphs.ttf'


def square():
    pen = TTGlyphPen(None)
    pen.moveTo((100, 0))
    pen.lineTo((100, 700))
    pen.lineTo((700, 700))
    pen.lineTo((700, 0))
    pen.closePath()
    return pen.glyph()


def main():
    names = ['.notdef', 'A', 'B', 'C', 'D']
    builder = FontBuilder(1000, isTTF=True)
    builder.setupGlyphOrder(names)
    builder.setupCharacterMap({0x41: 'A', 0x42: 'B', 0x43: 'C', 0x44: 'D'})
    builder.setupGlyf({name: square() for name in names})
    builder.setupHorizontalMetrics({name: (800, 100) for name in names})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({'familyName': 'SVG Glyphs', 'styleName': 'Regular'})
    builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    builder.setupPost()
    builder.setupHead(unitsPerEm=1000, created=0, modified=0)
    shared = (
        '<svg xmlns="http://www.w3.org/2000/svg">'
        '<g id="glyph1"><rect x="100" y="-700" width="600" height="700" fill="context-fill"/></g>'
        '<g transform="translate(0 -350)"><g id="glyph2">'
        '<circle cx="400" cy="0" r="300" fill="green" stroke="context-stroke" stroke-width="60"/>'
        '</g></g></svg>'
    )
    alone = (
        '<svg xmlns="http://www.w3.org/2000/svg" id="glyph3">'
        '<rect x="0" y="-800" width="800" height="400" fill="#1e90ff"/>'
        '<rect x="0" y="0" width="800" height="200" fill="#ff8c00"/></svg>'
    )
    table = newTable('SVG ')
    table.docList = []
    from fontTools.ttLib.tables.S_V_G_ import SVGDocument
    table.docList.append(SVGDocument(gzip.compress(shared.encode(), mtime=0), 1, 2, True))
    table.docList.append(SVGDocument(alone, 3, 3, False))
    builder.font['SVG '] = table
    builder.save(OUT)


if __name__ == '__main__':
    main()
