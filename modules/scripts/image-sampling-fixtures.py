#!/usr/bin/env python3
"""CSS Images 3 sampling probes with independently expanded source pixels."""
import base64
import json
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/images'
COLORS = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0)]


def chunk(kind, body):
    return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body))


def source(mx=1, my=1):
    # Every source sample becomes an mx by my block, without interpolation.
    rows = b''.join(b'\0' + bytes(c for x in range(2 * mx)
                                for c in COLORS[(y // my) * 2 + x // mx])
                    for y in range(2 * my))
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', 2 * mx, 2 * my, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))
    return 'data:image/png;base64,' + base64.b64encode(png).decode()


def image(url, width, height, hint):
    return (f'<image x="1" y="1" width="{width}" height="{height}" '
            f'preserveAspectRatio="none" href="{url}" style="image-rendering:{hint}"/>')


def svg(body):
    return '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12">' + body + '</svg>\n'


manifest_path = ROOT / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest['cases'] = [c for c in manifest['cases'] if not c['id'].startswith('image-sampling-')]
# Ties are intentionally avoided: the pinned text says "closest" without
# choosing which integer to use when two are equally close.
cases = [
    ('crisp-edges', 'crisp-edges', 6, 6, 3, 3),
    ('pixelated-integer', 'pixelated', 6, 6, 3, 3),
    ('pixelated-round-down', 'pixelated', 4.8, 4.8, 2, 2),
    ('pixelated-round-up', 'pixelated', 5.2, 5.2, 3, 3),
    ('pixelated-anisotropic', 'pixelated', 5.2, 7.2, 3, 4),
    ('pixelated-downscale', 'pixelated', 1.4, 1.4, 1, 1),
    ('smooth', 'smooth', 5.2, 7.2, 1, 1),
    ('high-quality', 'high-quality', 5.2, 7.2, 1, 1),
]
for name, hint, width, height, mx, my in cases:
    # Reference uses the already-expanded raster, then the renderer's selected
    # smooth algorithm. This checks the normative two-stage construction;
    # CSS deliberately leaves the smooth algorithm to the implementation.
    reference = image(source(mx, my), width, height, 'optimizeQuality')
    filename = 'sampling-' + name + '.svg'
    (ROOT / 'inputs' / filename).write_text(svg(image(source(), width, height, hint)))
    (ROOT / 'references' / filename).write_text(svg(reference))
    manifest['cases'].append(dict(
        id='image-sampling-' + name, input='inputs/' + filename,
        references=[dict(path='references/' + filename, relation='==')],
        status='pass', tolerance={},
        spec='https://www.w3.org/TR/css-images-3/#the-image-rendering',
        reason='Original four-color PNG; reference explicitly duplicates samples to the nearest positive integer size on each axis, then uses the selected smooth algorithm.'))
def add(name, actual, reference, reason):
    filename = 'sampling-' + name + '.svg'
    (ROOT / 'inputs' / filename).write_text(svg(actual))
    (ROOT / 'references' / filename).write_text(svg(reference))
    manifest['cases'].append(dict(
        id='image-sampling-' + name, input='inputs/' + filename,
        references=[dict(path='references/' + filename, relation='==')],
        status='pass', tolerance={},
        spec='https://www.w3.org/TR/css-images-3/#the-image-rendering',
        reason=reason))


for name, transform in [('scaled', 'scale(1.8)'),
                        ('rotated-scaled', 'translate(12 0) rotate(90) scale(1.8)')]:
    # 2.8/2 * 1.8 = 2.52 on each axis, so the device transform changes
    # the first-stage integer multiple from one to three.
    wrap = lambda body: f'<g transform="{transform}">{body}</g>'
    add(name, wrap(image(source(), 2.8, 2.8, 'pixelated')),
        wrap(image(source(3, 3), 2.8, 2.8, 'smooth')),
        'Complete device mapping determines the nearest integer expansion; the independent reference expands threefold before the same scale and rotation.')

# This mild perspective keeps both finite-device magnification bounds between
# 2.5 and 3.5, so the selected intermediate is independently threefold.
wrap = lambda body: ('<g style="transform:matrix3d(1,0,0,0.01,0,1,0,0,0,0,1,0,0,0,0,1)">'
                     + body + '</g>')
add('projective', wrap(image(source(), 6, 6, 'pixelated')),
    wrap(image(source(3, 3), 6, 6, 'smooth')),
    'A finite perspective image uses a threefold independently expanded reference before the same projective bilinear mapping.')

actual = image(source(), 5.2, 3.2, 'pixelated')
reference = image(source(3, 2), 5.2, 3.2, 'smooth')
for shift, width, height, mx, my in [(4, 3.2, 5.2, 2, 3), (8, 5.2, 3.2, 3, 2)]:
    actual += f'<g transform="translate(0 {shift})">' + image(source(), width, height, 'pixelated') + '</g>'
    reference += f'<g transform="translate(0 {shift})">' + image(source(mx, my), width, height, 'smooth') + '</g>'
add('shared-resource-scales', actual, reference,
    'One decoded resource is used at two anisotropic integer expansions and then reuses the first expansion; independent references have duplicated samples for each scale.')

manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
