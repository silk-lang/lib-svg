#!/usr/bin/env python3
"""Exact SVG source orientation controls, independently arranged colored cells."""
import base64
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/images'
NS = 'http://www.w3.org/2000/svg'
SPEC = 'https://www.w3.org/TR/css-images-3/#the-image-orientation'


def svg(body, attrs='width="16" height="12"'):
    return f'<svg xmlns="{NS}" {attrs}>{body}</svg>\n'


def data(document):
    return 'data:image/svg+xml;base64,' + base64.b64encode(document.encode()).decode()


def cells(rows, x=2, y=2, width=1, height=1):
    return ''.join(f'<rect x="{x + column * width}" y="{y + row * height}" '
                   f'width="{width}" height="{height}" fill="{color}"/>'
                   for row, colors in enumerate(rows) for column, color in enumerate(colors))


# Clockwise source rotations, written explicitly rather than using the renderer's
# orientation transform or an image library as the oracle.
rows = [
    [['red', 'lime'], ['blue', 'cyan'], ['magenta', 'yellow']],
    [['magenta', 'blue', 'red'], ['yellow', 'cyan', 'lime']],
    [['yellow', 'magenta'], ['cyan', 'blue'], ['lime', 'red']],
    [['lime', 'cyan', 'yellow'], ['red', 'blue', 'magenta']],
]
url = data(svg(cells(rows[0], 0, 0), 'width="2" height="3" viewBox="0 0 2 3"'))
manifest_path = ROOT / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest['cases'] = [case for case in manifest['cases']
                     if not case['id'].startswith('image-svg-orientation-')]


def add(name, actual, expected, reason):
    filename = f'svg-orientation-{name}.svg'
    (ROOT / 'inputs' / filename).write_text(svg(actual))
    (ROOT / 'references' / filename).write_text(svg(expected))
    manifest['cases'].append(dict(
        id=f'image-svg-orientation-{name}', input=f'inputs/{filename}',
        references=[dict(path=f'references/{filename}', relation='==')],
        status='pass', tolerance={}, spec=SPEC, reason=reason))


for turn in range(4):
    for flip in (False, True):
        hint = f'{turn * 90}deg' + (' flip' if flip else '')
        expected = [row[::-1] for row in rows[turn]] if flip else rows[turn]
        add(f'{turn * 90}' + ('-flip' if flip else ''),
            f'<image x="2" y="2" href="{url}" style="image-orientation:{hint}"/>',
            cells(expected),
            'SVG content images use oriented intrinsic dimensions; horizontal flipping follows clockwise rotation.')
add('stretched',
    f'<image x="2" y="2" width="9" height="4" preserveAspectRatio="none" href="{url}" style="image-orientation:90deg"/>',
    cells(rows[1], width=3, height=2),
    'The independent SVG viewport is negotiated before orientation, and final width/height address the oriented axes.')
add('auto-height',
    f'<image x="2" y="2" width="6" href="{url}" style="image-orientation:90deg"/>',
    cells(rows[1], width=2, height=2),
    'Auto height is derived from the reciprocal intrinsic aspect ratio after a quarter turn.')
percentage = data(svg('<rect width="50%" height="100%" fill="red"/>', ''))
add('percentage-viewport',
    f'<image x="2" y="2" width="6" height="4" href="{percentage}" style="image-orientation:90deg"/>',
    '<rect x="2" y="2" width="6" height="2" fill="red"/>',
    'A quarter turn supplies the independent document a 4 by 6 logical viewport before rotating its percentage geometry.')
add('shared-inherited',
    '<g style="image-orientation:90deg">'
    + f'<image width="4" height="6" href="{url}" style="image-orientation:none"/>'
    + f'<image x="6" width="6" height="4" href="{url}"/></g>',
    cells(rows[0], 0, 0, 2, 2) + cells(rows[1], 6, 0, 2, 2),
    'Different inherited orientations share the same raw 4 by 6 layout while retaining separate placements.')
ratio_only = data(svg(cells(rows[0], 0, 0), 'viewBox="0 0 2 3"'))
add('viewbox-auto-height',
    f'<image x="2" y="2" width="6" href="{ratio_only}" style="image-orientation:90deg"/>',
    cells(rows[1], width=2, height=2),
    'A viewBox-only natural ratio is inverted before resolving auto height, without inventing intrinsic dimensions.')
projective = 'transform-origin:0 0;transform:matrix3d(1,0,0,.025,0,1,0,0,0,0,1,0,0,0,0,1)'
# SVG2 render.html#RenderingOrder: antialiased adjoining edges retain source
# painting order. Reordering by the rotated grid would change source-over edges.
positions = {'red': (2, 0), 'lime': (2, 1), 'blue': (1, 0),
             'cyan': (1, 1), 'magenta': (0, 0), 'yellow': (0, 1)}
projective_reference = ''.join(cells([[color]], 2 + 3 * x, 2 + 2 * y, 3, 2)
                               for color, (x, y) in positions.items())
add('projective',
    f'<image x="2" y="2" width="9" height="4" preserveAspectRatio="none" href="{url}" style="image-orientation:90deg;{projective}"/>',
    f'<g style="{projective}">' + projective_reference + '</g>',
    'CSS transforms follow image orientation; retained child clips compose through perspective. The independent cell reference preserves source painting order (SVG2 render.html#RenderingOrder).')
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
