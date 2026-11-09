#!/usr/bin/env python3
"""Mesh gradient reference fixtures (2016 CR pservers.html #MeshGradients).

Each mesh is a grid of straight-edged rectangles, so the Coons map is affine and every
pixel centre has exact (u, v) coordinates. Expected colours come from an independent
double-precision evaluation of the corner interpolation (bilinear, or bicubic with the
monotone derivatives of #MeshPatchPainting) and are written as pixel rectangles in the
reference SVGs. The curved-seam case paints one colour, so its reference is a plain
rectangle. Cases are merged into tests/fixtures/painting/manifest.json.
"""
import math
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/painting'
SPEC = 'https://www.w3.org/TR/2016/CR-SVG2-20160915/pservers.html'


def hex_color(c):
    return '#%02x%02x%02x' % c


def quantize(value):
    value = min(1.0, max(0.0, value))
    scaled = value * 255.0 + 0.5
    if abs(scaled - round(scaled)) < 1e-6:
        raise SystemExit(f'colour channel {value} rounds ambiguously; adjust the fixture')
    return int(scaled)


def monotone(points, values):
    """Derivatives per unit length along one line of mesh corners."""
    n = len(points) - 1
    delta = []
    for k in range(n):
        length = abs(points[k + 1] - points[k])
        delta.append(0.0 if length == 0 else (values[k + 1] - values[k]) / length)
    out = [0.0] * (n + 1)
    if n == 1:
        return [delta[0], delta[0]]
    for k in range(1, n):
        before, after = delta[k - 1], delta[k]
        d = (before + after) / 2.0
        if before * after < 0:
            d = 0.0
        else:
            if abs(d) > abs(3 * before):
                d = 3 * before
            if abs(d) > abs(3 * after):
                d = 3 * after
        out[k] = d
    out[0] = 2 * delta[0] - out[1]
    out[n] = 2 * delta[n - 1] - out[n - 1]
    return out


def h(t):
    return (2 * t ** 3 - 3 * t ** 2 + 1, t ** 3 - 2 * t ** 2 + t, 3 * t ** 2 - 2 * t ** 3, t ** 3 - t ** 2)


class Mesh:
    """A rectangular mesh: column edges xs, row edges ys, corner colours [row][column]."""

    def __init__(self, xs, ys, colors, bicubic=False):
        self.xs, self.ys, self.colors, self.bicubic = xs, ys, colors, bicubic
        rows, cols = len(ys) - 1, len(xs) - 1
        self.du = [[[0.0] * 4 for _ in range(cols + 1)] for _ in range(rows + 1)]
        self.dv = [[[0.0] * 4 for _ in range(cols + 1)] for _ in range(rows + 1)]
        for k in range(4):
            for r in range(rows + 1):
                d = monotone(xs, [colors[r][c][k] for c in range(cols + 1)])
                for c in range(cols + 1):
                    self.du[r][c][k] = d[c]
            for c in range(cols + 1):
                d = monotone(ys, [colors[r][c][k] for r in range(rows + 1)])
                for r in range(rows + 1):
                    self.dv[r][c][k] = d[r]

    def color(self, x, y):
        xs, ys = self.xs, self.ys
        if not (xs[0] < x < xs[-1] and ys[0] < y < ys[-1]):
            return None
        c = max(i for i in range(len(xs) - 1) if xs[i] < x)
        r = max(i for i in range(len(ys) - 1) if ys[i] < y)
        w, hgt = xs[c + 1] - xs[c], ys[r + 1] - ys[r]
        u, v = (x - xs[c]) / w, (y - ys[r]) / hgt
        corners = [(r, c), (r, c + 1), (r + 1, c + 1), (r + 1, c)]
        col = [self.colors[a][b] for a, b in corners]
        out = []
        for k in range(4):
            if not self.bicubic:
                value = ((1 - u) * (1 - v) * col[0][k] + u * (1 - v) * col[1][k]
                         + u * v * col[2][k] + (1 - u) * v * col[3][k])
            else:
                a0, a1, a2, a3 = h(u)
                b0, b1, b2, b3 = h(v)
                su = [self.du[a][b][k] * (w) for a, b in corners]
                sv = [self.dv[a][b][k] * (hgt) for a, b in corners]
                value = (b0 * (a0 * col[0][k] + a2 * col[1][k]) + b2 * (a0 * col[3][k] + a2 * col[2][k])
                         + b0 * (a1 * su[0] + a3 * su[1]) + b2 * (a1 * su[3] + a3 * su[2])
                         + b1 * (a0 * sv[0] + a2 * sv[1]) + b3 * (a0 * sv[3] + a2 * sv[2]))
                value = min(1.0, max(0.0, value))
            out.append(value)
        return out

    def markup(self, ident, x_attr, y_attr, extra=''):
        """Rows of patches; edges alternate between l, L, c and C forms."""
        xs, ys = self.xs, self.ys
        rows, cols = len(ys) - 1, len(xs) - 1

        def rgb(r, c):
            return hex_color(tuple(round(v * 255) for v in self.colors[r][c][:3]))

        def seg(i, x0, y0, x1, y1, last):
            dx, dy = x1 - x0, y1 - y0
            form = i % 4
            if form == 0:
                return 'l' if last else f'l {fmt(dx)},{fmt(dy)}'
            if form == 1:
                return 'L' if last else f'L {fmt(x1)} {fmt(y1)}'
            pts = [(dx / 3, dy / 3), (2 * dx / 3, 2 * dy / 3), (dx, dy)]
            if form == 3:
                pts = [(x0 + px, y0 + py) for px, py in pts]
            pts = pts[:2] if last else pts
            return ('c ' if form == 2 else 'C ') + ' '.join(f'{fmt(px)},{fmt(py)}' for px, py in pts)

        lines = [f'<meshgradient id="{ident}" {x_attr} {y_attr}{extra}>']
        i = 0
        for r in range(rows):
            lines.append('  <meshrow>')
            for c in range(cols):
                lines.append('    <meshpatch>')
                corner = [(xs[c], ys[r]), (xs[c + 1], ys[r]), (xs[c + 1], ys[r + 1]), (xs[c], ys[r + 1])]
                rc = [(r, c), (r, c + 1), (r + 1, c + 1), (r + 1, c)]
                sides = [s for s in range(4) if not ((s == 0 and r > 0) or (s == 3 and c > 0))]
                for s in sides:
                    (x0, y0), (x1, y1) = corner[s], corner[(s + 1) % 4]
                    path = seg(i, x0, y0, x1, y1, s == sides[-1])
                    i += 1
                    defined = (s == 0 and (r > 0 or c > 0)) or (s == 1 and r > 0) or (s == 3 and c > 0)
                    color = '' if defined else f' stop-color="{rgb(*rc[s])}"'
                    lines.append(f'      <stop path="{path}"{color}/>')
                lines.append('    </meshpatch>')
            lines.append('  </meshrow>')
        lines.append('</meshgradient>')
        return '\n'.join(lines)


def fmt(value):
    text = repr(float(value))
    return text[:-2] if text.endswith('.0') else text


def pixels(width, height, sample):
    rects = []
    for py in range(height):
        run = None
        for px in range(width + 1):
            color = sample(px + 0.5, py + 0.5) if px < width else None
            key = None if color is None else tuple(quantize(c) for c in color[:3])
            if run and run[1] == key:
                continue
            if run and run[1] is not None:
                rects.append(f'<rect x="{run[0]}" y="{py}" width="{px - run[0]}" height="1" fill="{hex_color(run[1])}"/>')
            run = (px, key)
    return rects


def svg(width, height, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}">\n'
            + body + '\n</svg>\n')


def palette(*rows):
    return [[tuple(v / 255 for v in color) + (1.0,) for color in row] for row in rows]


CASES = []


def case(ident, input_svg, reference_svg, reason, anchor):
    (ROOT / 'inputs' / f'{ident}.svg').write_text(input_svg)
    (ROOT / 'references' / f'{ident}.svg').write_text(reference_svg)
    CASES.append({
        'id': ident,
        'input': f'inputs/{ident}.svg',
        'references': [{'path': f'references/{ident}.svg', 'relation': '=='}],
        'status': 'pass',
        'reason': reason,
        'spec': f'{SPEC}#{anchor}',
        'tolerance': {},
    })


def curved_mesh(ident, color, rows=3, columns=4):
    """A user-space mesh over (20, 20, 280, 200) with wavy inner corners and bent inner
    edges, every stop one colour."""
    x0, y0, width, height = 20, 20, 280, 200
    corners = [[(x0 + width * j / columns + 9 * math.sin(i * 1.7 + j * 0.9) * (0 < j < columns),
                 y0 + height * i / rows + 10 * math.cos(i * 1.1 + j * 1.9) * (0 < i < rows))
                for j in range(columns + 1)] for i in range(rows + 1)]

    def edge(a, b, bend):
        dx, dy = b[0] - a[0], b[1] - a[1]
        c1 = (a[0] + dx / 3 - dy * bend, a[1] + dy / 3 + dx * bend)
        c2 = (a[0] + 2 * dx / 3 + dy * bend, a[1] + 2 * dy / 3 - dx * bend)
        return 'C ' + ' '.join(f'{fmt(round(x, 2))},{fmt(round(y, 2))}' for x, y in (c1, c2, b))

    def across(i, j):
        return 0.0 if i in (0, rows) else 0.18 * math.sin(i * 2.3 + j * 1.3)

    def down(i, j):
        return 0.0 if j in (0, columns) else 0.2 * math.cos(i * 1.6 + j * 2.1)

    out = [f'<meshgradient id="{ident}" x="{x0}" y="{y0}" gradientUnits="userSpaceOnUse">']
    for i in range(rows):
        out.append('  <meshrow>')
        for j in range(columns):
            tl, tr = corners[i][j], corners[i][j + 1]
            br, bl = corners[i + 1][j + 1], corners[i + 1][j]
            stops = []
            if i == 0:
                stops.append((edge(tl, tr, across(i, j)), j == 0))
            stops.append((edge(tr, br, down(i, j + 1)), i == 0))
            stops.append((edge(br, bl, -across(i + 1, j)), True))
            if j == 0:
                stops.append((edge(bl, tl, -down(i, j)), True))
            out.append('    <meshpatch>')
            for path, colored in stops:
                out.append(f'      <stop path="{path}"' + (f' stop-color="{color}"' if colored else '') + '/>')
            out.append('    </meshpatch>')
        out.append('  </meshrow>')
    out.append('</meshgradient>')
    return '\n'.join(out)


def main():
    # Two by two user-space mesh with unequal patch sizes and every edge form.
    grid = Mesh([4, 16, 36], [3, 13, 27], palette(
        [(200, 30, 40), (40, 180, 70), (20, 60, 210)],
        [(240, 200, 20), (90, 10, 150), (250, 250, 250)],
        [(10, 10, 10), (30, 220, 230), (230, 120, 60)],
    ))
    case('mesh-bilinear-grid',
         svg(40, 30, '<defs>\n' + grid.markup('m', 'x="4"', 'y="3"', ' gradientUnits="userSpaceOnUse"')
             + '\n</defs>\n<rect x="4" y="3" width="32" height="24" fill="url(#m)"/>'),
         svg(40, 30, '\n'.join(pixels(40, 30, grid.color))),
         'A two by two mesh shares edges and corner colours between neighbouring patches; '
         'straight edges written as l, L, c and C make each patch affine, so pixel centres '
         'take the bilinear corner interpolation exactly.',
         'MeshStructure')

    # Object-bounding-box units through a template, with a transform on the referencing
    # element: path data are bbox fractions mapped by bbox then transform.
    unit = Mesh([0, 0.5, 1], [0, 1], palette(
        [(250, 40, 40), (40, 40, 250), (40, 200, 40)],
        [(250, 220, 40), (240, 240, 240), (120, 30, 120)],
    ))
    bbox = (8, 4, 24, 16)
    placed = Mesh([bbox[0] + bbox[2] * x for x in unit.xs],
                  [bbox[1] + bbox[3] * (0.25 + 0.5 * y) for y in unit.ys], unit.colors)
    case('mesh-bbox-template',
         svg(40, 24, '<defs>\n' + unit.markup('base', 'x="0"', 'y="0"')
             + '\n<meshgradient id="m" href="#base" transform="translate(0 0.25) scale(1 0.5)"/>\n</defs>\n'
             '<rect x="8" y="4" width="24" height="16" fill="url(#m)"/>'),
         svg(40, 24, '\n'.join(pixels(40, 24, placed.color))),
         'A meshgradient without children uses its template\'s rows; object-bounding-box path '
         'data are bbox fractions, and the referencing element\'s transform halves the mesh '
         'height. The rest of the rectangle is unpainted.',
         'MeshGradientAttributes')

    # Bicubic interpolation over three by two patches.
    smooth = Mesh([2, 10, 22, 38], [2, 12, 26], palette(
        [(250, 10, 10), (200, 90, 30), (60, 200, 90), (10, 40, 250)],
        [(30, 30, 200), (240, 240, 20), (230, 20, 230), (20, 230, 230)],
        [(240, 140, 10), (10, 120, 60), (100, 100, 100), (250, 250, 250)],
    ), bicubic=True)
    case('mesh-bicubic',
         svg(40, 28, '<defs>\n' + smooth.markup('m', 'x="2"', 'y="2"', ' gradientUnits="userSpaceOnUse" type="bicubic"')
             + '\n</defs>\n<rect x="2" y="2" width="36" height="24" fill="url(#m)"/>'),
         svg(40, 28, '\n'.join(pixels(40, 28, smooth.color))),
         'type="bicubic" uses monotone corner derivatives along mesh rows and columns, zero '
         'cross derivatives and chord-scaled Hermite interpolation, clamped to [0, 1].',
         'MeshPatchPainting')

    # Meshes in error paint nothing.
    bad = '''<defs>
<meshgradient id="ragged" gradientUnits="userSpaceOnUse" x="2" y="2">
  <meshrow><meshpatch>
    <stop path="l 8,0" stop-color="red"/><stop path="l 0,8" stop-color="red"/>
    <stop path="l -8,0" stop-color="red"/><stop path="l" stop-color="red"/>
  </meshpatch><meshpatch>
    <stop path="l 8,0"/><stop path="l 0,8" stop-color="red"/><stop path="l" stop-color="red"/>
  </meshpatch></meshrow>
  <meshrow><meshpatch>
    <stop path="l 0,8"/><stop path="l -8,0" stop-color="red"/><stop path="l" stop-color="red"/>
  </meshpatch></meshrow>
</meshgradient>
<meshgradient id="moveto" gradientUnits="userSpaceOnUse" x="22" y="2">
  <meshrow><meshpatch>
    <stop path="m 8,0" stop-color="red"/><stop path="l 0,8" stop-color="red"/>
    <stop path="l -8,0" stop-color="red"/><stop path="l" stop-color="red"/>
  </meshpatch></meshrow>
</meshgradient>
<meshgradient id="short" gradientUnits="userSpaceOnUse" x="2" y="22">
  <meshrow><meshpatch>
    <stop path="l 8,0" stop-color="red"/><stop path="l 0,8" stop-color="red"/>
  </meshpatch></meshrow>
</meshgradient>
</defs>
<rect x="2" y="2" width="16" height="16" fill="url(#ragged)"/>
<rect x="22" y="2" width="8" height="8" fill="url(#moveto)"/>
<rect x="2" y="22" width="8" height="8" fill="url(#short)"/>'''
    case('mesh-in-error',
         svg(40, 32, bad), svg(40, 32, ''),
         'A row with fewer patches than the first, a stop path that is not c, C, l or L, and a '
         'patch with too few stops put the mesh in error; such meshes paint nothing.',
         'MeshStructure')

    # Curved edges shared by patches of different sizes: neighbours must split each
    # shared edge at the same points, or slivers between their triangles stay unpainted
    # (this layout left pinholes at (87, 196) and (88, 203) when each patch picked its
    # own grid).
    case('mesh-curved-seam',
         svg(320, 240, '<defs>\n' + curved_mesh('m', '#2878c8')
             + '\n</defs>\n<rect x="22" y="22" width="276" height="196" fill="url(#m)"/>'),
         svg(320, 240, '<rect x="22" y="22" width="276" height="196" fill="#2878c8"/>'),
         'Neighbouring patches meet along their shared edges, curved or not: a one-colour mesh '
         'paints every pixel it covers.',
         'MeshPatchPainting')

    merge(ROOT / 'manifest.json', CASES)


def merge(path, cases):
    """Replaces this script's cases in a manifest, keeping the other entries' text."""
    import re
    text = path.read_text()
    ids = '|'.join(re.escape(c['id']) for c in cases)
    text = re.sub(r',\n    \{\n      "id": "(?:%s)",.*?\n    \}(?=,\n    \{|\n  \])' % ids, '', text,
                  flags=re.S)
    blocks = ''.join(',\n' + '\n'.join('    ' + line for line in json.dumps(c, indent=2).split('\n'))
                     for c in cases)
    end = text.rindex('\n  ]')
    path.write_text(text[:end] + blocks + text[end:])

if __name__ == '__main__':
    main()
