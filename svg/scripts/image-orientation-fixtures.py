#!/usr/bin/env python3
"""Original six-pixel orientation probes, with independently placed pixel references."""
from pathlib import Path
import base64
import json
import re
import struct
import zlib

root = Path(__file__).resolve().parents[1] / 'tests/fixtures/images'
colors = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0), (0, 255, 255), (255, 0, 255)]

def chunk(kind, body):
    return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body))

rows = b''.join(b'\0' + bytes(sum((list(c) for c in colors[y*2:y*2+2]), [])) for y in range(3))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 2, 3, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')
url = 'data:image/png;base64,' + base64.b64encode(png).decode()

def svg(body):
    return '<svg xmlns="http://www.w3.org/2000/svg" width="6" height="6">' + body + '</svg>\n'

cases = [
    ('none', 'none', 0, False), ('clockwise', '90deg', 1, False),
    ('half-turn', '180deg', 2, False), ('counterclockwise', '270deg', 3, False),
    ('flip', 'flip', 0, True), ('clockwise-flip', '90deg flip', 1, True),
    ('half-turn-flip', 'flip 180deg', 2, True), ('counterclockwise-flip', '270deg flip', 3, True),
    ('positive-tie', '45deg', 1, False), ('negative-tie', '-45deg', 0, False),
    ('negative-half-tie', '-135deg', 3, False), ('wrapped-angle', '450deg', 1, False),
    ('calculated-angle', 'calc(1turn - 90deg)', 3, False),
    ('inherit', 'inherit', 1, False), ('unset', 'unset', 1, False),
    ('initial', 'initial', 0, False), ('all-inherit', 'all:inherit', 1, False),
    ('all-initial', 'all:initial', 0, False),
    ('infinite-angle', 'calc(infinity * 1deg)', 0, False),
    ('negative-infinite-angle', 'calc(-infinity * 1deg)', 0, False),
    ('nan-angle', 'calc(NaN * 1deg)', 0, False),
    ('overflow-angle', 'calc(1e308deg * 10)', 0, False),
]
manifest_path = root / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest['cases'] = [c for c in manifest['cases'] if not c['id'].startswith('image-orientation-')]
def pixels(turns, flip, offset_x=1, offset_y=1):
    ref = []
    for y in range(3):
        for x in range(2):
            dx, dy, w, h = x, y, 2, 3
            for _ in range(turns):
                dx, dy, w, h = h - 1 - dy, dx, h, w
            if flip:
                dx = w - 1 - dx
            r, g, b = colors[y*2+x]
            ref.append(f'<rect x="{dx+offset_x}" y="{dy+offset_y}" width="1" height="1" fill="rgb({r},{g},{b})"/>')
    return "".join(ref)

for name, value, turns, flip in cases:
    style = value + ';x:1px;y:1px' if value.startswith('all:') else 'image-orientation:' + value
    image = f'<image x="1" y="1" href="{url}" style="{style}"/>'
    if name in ('inherit', 'unset', 'initial', 'all-inherit', 'all-initial'):
        image = '<g style="image-orientation:90deg">' + image + '</g>'
    filename = 'orientation-' + name + '.svg'
    (root / 'inputs' / filename).write_text(svg(image))
    (root / 'references' / filename).write_text(svg(pixels(turns, flip)))
    manifest['cases'].append(dict(id='image-orientation-'+name, input='inputs/'+filename,
        references=[dict(path='references/'+filename, relation='==')], status='pass', tolerance={},
        spec=('https://www.w3.org/TR/css-values-4/#numeric-data-types' if name in ('infinite-angle', 'negative-infinite-angle', 'nan-angle', 'overflow-angle') else 'https://www.w3.org/TR/css-images-3/#the-image-orientation'),
        reason='Original 2x3 RGB source with six distinct samples; reference rotates integer sample coordinates clockwise, then flips horizontally.'))
# The same URL is deliberately used by differently styled occurrences.
# This catches decode-time orientation that incorrectly changes every occurrence.
jpeg_source = (root / 'inputs/jpeg-orientation.svg').read_text()
jpeg_url = re.search(r'href="([^"]+)"', jpeg_source).group(1)
for name, source, reference in [
    ('shared-resource', f'<image href="{url}"/><image href="{url}" x="3" style="image-orientation:90deg"/>',
     pixels(0, False, 0, 0) + pixels(1, False, 3, 0)),
    ('jpeg-none', f'<image href="{jpeg_url}" style="image-orientation:none"/><image href="{jpeg_url}" x="3"/>',
     '<rect width="2" height="3" fill="#808080"/><rect x="3" width="3" height="2" fill="#808080"/>'),
]:
    filename = 'orientation-' + name + '.svg'
    (root / 'inputs' / filename).write_text(svg(source))
    (root / 'references' / filename).write_text(svg(reference))
    manifest['cases'].append(dict(id='image-orientation-'+name, input='inputs/'+filename,
        references=[dict(path='references/'+filename, relation='==')], status='pass', tolerance={},
        spec='https://www.w3.org/TR/css-images-3/#the-image-orientation',
        reason='Shared source pixels retain independent per-occurrence CSS orientation; EXIF is used only by from-image.'))
manifest_path.write_text(json.dumps(manifest, indent=2)+'\n')
