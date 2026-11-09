#!/usr/bin/env python3
"""Hatch reference fixtures (2016 CR pservers.html #Hatches).

Strip edges and hatch path strokes land on whole pixels, so each reference draws the
expected geometry directly: rectangles for straight lines, and the repeated sections as
explicit paths for shaped hatch paths. Cases are merged into
tests/fixtures/painting/manifest.json.
"""
import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent / 'tests/fixtures/painting'
SPEC = 'https://www.w3.org/TR/2016/CR-SVG2-20160915/pservers.html'

spec = importlib.util.spec_from_file_location('mesh_fixtures', HERE / 'mesh-fixtures.py')
mesh_fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mesh_fixtures)

CASES = []


def svg(width, height, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}">\n'
            + body + '\n</svg>\n')


def case(ident, input_body, reference_body, size, reason, anchor):
    width, height = size
    (ROOT / 'inputs' / f'{ident}.svg').write_text(svg(width, height, input_body))
    (ROOT / 'references' / f'{ident}.svg').write_text(svg(width, height, reference_body))
    CASES.append({
        'id': ident,
        'input': f'inputs/{ident}.svg',
        'references': [{'path': f'references/{ident}.svg', 'relation': '=='}],
        'status': 'pass',
        'reason': reason,
        'spec': f'{SPEC}#{anchor}',
        'tolerance': {},
    })


def bands(count, start, step, size, vertical, length, color):
    out = []
    for m in range(count):
        a = start + m * step
        if vertical:
            out.append(f'<rect x="{a}" y="0" width="{size}" height="{length}" fill="{color}"/>')
        else:
            out.append(f'<rect x="0" y="{a}" width="{length}" height="{size}" fill="{color}"/>')
    return '\n'.join(out)


def main():
    # Default hatch paths are infinite lines at `offset` across each strip.
    case('hatch-lines',
         '<defs><hatch id="h" hatchUnits="userSpaceOnUse" pitch="8">\n'
         '  <hatchpath offset="3" stroke="#2050d0" stroke-width="2"/>\n'
         '  <hatchpath offset="7" stroke="#d03020" stroke-width="2"/>\n'
         '</hatch></defs>\n<rect width="40" height="24" fill="url(#h)"/>',
         bands(5, 2, 8, 2, True, 24, '#2050d0') + '\n'
         + bands(5, 6, 8, 2, True, 24, '#d03020'),
         (40, 24),
         'Each hatchpath without d is a line along the strip at its offset, stroked with its own '
         'solid stroke; strips repeat every pitch from x.',
         'HatchpathNotes')

    # Rotation through a template, with the strip origin moved by y.
    case('hatch-rotate-template',
         '<defs><hatch id="base" hatchUnits="userSpaceOnUse" pitch="8">\n'
         '  <hatchpath offset="3" stroke="#108040" stroke-width="2"/>\n'
         '</hatch>\n<hatch id="h" href="#base" rotate="90" x="5" y="1"/></defs>\n'
         '<rect width="32" height="40" fill="url(#h)"/>',
         # rotate(90) maps strip x onto user y: lines at y = 1 + 3 + 8m.
         bands(5, 3, 8, 2, False, 32, '#108040'),
         (32, 40),
         'href copies pitch and the hatchpath children; rotate turns the strips so they stack '
         'down the page from the origin (x, y).',
         'HatchElementAttributes')

    # Object-bounding-box strip units with user-space content.
    case('hatch-bbox-units',
         '<defs><hatch id="h" pitch="0.25" x="0.05">\n'
         '  <hatchpath offset="3" stroke="#a020a0" stroke-width="2"/>\n'
         '</hatch></defs>\n<rect x="0" y="4" width="40" height="20" fill="url(#h)"/>',
         '\n'.join(f'<rect x="{4 + 10 * m}" y="4" width="2" height="20" fill="#a020a0"/>' for m in range(4)),
         (40, 28),
         'x and pitch are bounding-box fractions (2 and 10 user units here) while hatchpath '
         'offsets and stroke widths stay in user units.',
         'HatchElementAttributes')

    # Overflow: hidden clips each line to its strip, visible lets it cross.
    body = ''.join(
        f'<defs><hatch id="{name}" hatchUnits="userSpaceOnUse" pitch="6" overflow="{name}">\n'
        f'  <hatchpath offset="5" stroke="#202020" stroke-width="4"/>\n'
        f'</hatch></defs>\n<rect y="{y}" width="36" height="10" fill="url(#{name})"/>\n'
        for name, y in [('hidden', 0), ('visible', 14)])
    hidden = [(6 * m + 3, 3) for m in range(6)]
    visible = [(0, 1)] + [(6 * m + 3, 4) for m in range(5)] + [(33, 3)]
    reference = '\n'.join(
        [f'<rect x="{x}" y="0" width="{w}" height="10" fill="#202020"/>' for x, w in hidden]
        + [f'<rect x="{x}" y="14" width="{w}" height="10" fill="#202020"/>' for x, w in visible])
    case('hatch-overflow',
         body, reference,
         (36, 24),
         'The UA style sheet makes hatch overflow hidden, clipping strokes to their strip; '
         'overflow visible draws the parts beyond it.',
         'HatchNotes')

    # Shaped hatch paths: a section with a moveto repeats as separate subpaths; without
    # one it starts at (x, 0) for the last point's x and joins the next section.
    def strips(pitch, count, section, period, joined, top, bottom):
        paths = []
        for m in range(count):
            dx = m * pitch
            parts = []
            k = (top // period) - 1
            while k * period <= bottom + period:
                pts = [(x + dx, y + k * period) for x, y in section]
                if joined and parts:
                    parts.append(' '.join(f'L {x} {y}' for x, y in pts[1:]))
                else:
                    parts.append(f'M {pts[0][0]} {pts[0][1]} ' + ' '.join(f'L {x} {y}' for x, y in pts[1:]))
                k += 1
            paths.append(' '.join(parts))
        return paths

    separate = strips(10, 4, [(2, 0), (8, 5), (2, 10)], 10, False, 0, 30)
    joined = strips(14, 4, [(10, 0), (4, 0), (10, 6)], 6, True, 0, 30)
    case('hatch-paths',
         '<defs><hatch id="a" hatchUnits="userSpaceOnUse" pitch="10">\n'
         '  <hatchpath d="M 2,0 L 8,5 L 2,10" fill="none" stroke="#c03000"/>\n'
         '</hatch>\n<hatch id="b" hatchUnits="userSpaceOnUse" pitch="14">\n'
         '  <hatchpath d="L 4,0 10,6" stroke="#0040c0" stroke-width="2"/>\n</hatch></defs>\n'
         '<rect width="40" height="30" fill="url(#a)"/>\n'
         '<rect width="48" height="30" fill="url(#b)" transform="translate(0 32)"/>',
         '<clipPath id="ca"><rect width="40" height="30"/></clipPath>\n'
         '<clipPath id="cb"><rect width="48" height="30"/></clipPath>\n'
         + '\n'.join(f'<path clip-path="url(#ca)" d="{d}" fill="none" stroke="#c03000"/>' for d in separate) + '\n'
         + '<g transform="translate(0 32)">\n'
         + '\n'.join(f'<path clip-path="url(#cb)" d="{d}" fill="none" stroke="#0040c0" stroke-width="2"/>' for d in joined)
         + '\n</g>',
         (92, 62),
         'A hatchpath d repeats down the strip by the y of its last point; without an initial '
         'moveto it starts at that point\'s x on the strip origin line and continues one subpath, '
         'joined with stroke-linejoin. Hatch path fills are ignored.',
         'HatchpathNotes')

    mesh_fixtures.merge(ROOT / 'manifest.json', CASES)


if __name__ == '__main__':
    main()
