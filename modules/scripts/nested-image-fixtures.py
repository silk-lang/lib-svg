#!/usr/bin/env python3
"""Original SVG-in-image probes; references are independently placed rectangles."""
import base64
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/images'
NS = 'http://www.w3.org/2000/svg'
SPEC = 'https://www.w3.org/TR/2018/CR-SVG2-20181004/embedded.html#ImageElement'


def document(body, attrs='width="12" height="12"'):
    return f'<svg xmlns="{NS}" {attrs}>{body}</svg>\n'


def data(svg):
    return 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode()).decode()


def rect(x, y, width, height, color):
    return f'<rect x="{x}" y="{y}" width="{width}" height="{height}" fill="{color}"/>'


manifest_path = ROOT / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest['cases'] = [c for c in manifest['cases'] if not c['id'].startswith('image-nested-')]


def add(name, actual, reference, reason):
    filename = 'nested-' + name + '.svg'
    (ROOT / 'inputs' / filename).write_text(document(actual))
    (ROOT / 'references' / filename).write_text(document(reference))
    manifest['cases'].append(dict(
        id='image-nested-' + name, input='inputs/' + filename,
        references=[dict(path='references/' + filename, relation='==')],
        status='pass', tolerance={}, spec=SPEC, reason=reason))


source = document(rect(0, 0, 1, 1, 'red') + rect(1, 0, 1, 1, 'blue'),
                  'width="2" height="1" viewBox="0 0 2 1"')
url = data(source)
add('intrinsic', f'<image x="1" y="2" href="{url}"/>',
    rect(1, 2, 1, 1, 'red') + rect(2, 2, 1, 1, 'blue'),
    'Absolute root dimensions provide intrinsic size; the embedded SVG is an independent document.')
add('meet', f'<image x="1" y="1" width="8" height="8" href="{url}"/>',
    rect(1, 3, 4, 4, 'red') + rect(5, 3, 4, 4, 'blue'),
    'Default xMidYMid meet fits the intrinsic two-to-one ratio into the image positioning rectangle.')
add('none', f'<image x="1" y="1" width="8" height="8" preserveAspectRatio="none" href="{url}"/>',
    rect(1, 1, 4, 8, 'red') + rect(5, 1, 4, 8, 'blue'),
    'The embedded root preserveAspectRatio is treated as none; the image attribute controls fitting.')
scoped = data(document('<rect width="100%" height="100%"/>', 'width="2" height="2"'))
add('style-isolation', '<style>rect {fill:lime}</style>'
    + f'<image x="1" y="1" width="6" height="6" fill="red" href="{scoped}"/>',
    rect(1, 1, 6, 6, 'black'),
    'Outer selectors and inherited fill must not enter the separate embedded document.')
percentage = data(document(rect(0, 0, '50%', '100%', 'red')
                           + rect('50%', 0, '50%', '100%', 'blue')))
add('percentage-viewport', f'<image x="1" y="1" width="8" height="4" preserveAspectRatio="none" href="{percentage}"/>',
    rect(1, 1, 4, 4, 'red') + rect(5, 1, 4, 4, 'blue'),
    'Percentages in the independent document resolve against its image-rendering viewport.')
external = document(rect(0, 0, 2, 2, 'red') + '<image width="2" height="2" href="nested-external.svg"/>',
                    'width="2" height="2" viewBox="0 0 2 2"')
(ROOT / 'inputs/nested-external.svg').write_text(document(rect(0, 0, 2, 2, 'blue'), 'width="2" height="2"'))
(ROOT / 'inputs/nested-secure-source.svg').write_text(external)
add('secure-external', '<image x="1" y="1" width="6" height="6" href="nested-secure-source.svg"/>',
    rect(1, 1, 6, 6, 'red'),
    'The outer static document may fetch the SVG; its embedded document is secure-static and cannot fetch a sibling SVG.')
add('shared-viewports', f'<image x="1" y="1" width="4" height="2" href="{url}"/>'
    + f'<image x="1" y="5" width="8" height="4" href="{url}"/>',
    rect(1, 1, 2, 2, 'red') + rect(3, 1, 2, 2, 'blue')
    + rect(1, 5, 4, 4, 'red') + rect(5, 5, 4, 4, 'blue'),
    'The same resource renders at two occurrence-specific viewport sizes without sharing the wrong layout.')
# These compare retained vector content at the final placement; rasterizing a
# source-sized intermediate would blur edges or lose visible overflow.
add('rotated', f'<image width="8" height="4" transform="translate(10 1) rotate(90)" href="{url}"/>',
    rect(6, 1, 4, 4, 'red') + rect(6, 5, 4, 4, 'blue'),
    'The image document and its viewport clips follow a non-axis-aligned affine placement.')
projective = 'transform-origin:0 0;transform:matrix3d(1,0,0,.04,0,1,0,0,0,0,1,0,0,0,0,1)'
add('projective', f'<image width="8" height="4" style="{projective}" href="{url}"/>',
    f'<g style="{projective}">' + rect(0, 0, 4, 4, 'red') + rect(4, 0, 4, 4, 'blue') + '</g>',
    'Projective image placement transforms both child geometry and physical viewport clip planes.')
overflow = data(document(rect(-2, 0, 6, 2, 'red'),
                         'width="2" height="2" overflow="visible"'))
add('overflow-visible', f'<image x="4" y="4" width="2" height="2" overflow="visible" href="{overflow}"/>',
    rect(2, 4, 6, 2, 'red'),
    'Visible overflow on both image and document root preserves content beyond the image viewport.')
fixed = data(document(rect(0, 0, 2, 2, 'red'), 'width="2" height="2"'))
add('no-viewbox', f'<image x="1" y="1" width="6" height="6" href="{fixed}"/>',
    rect(1, 1, 2, 2, 'red'),
    'Without a viewBox the new SVG viewport does not scale fixed user-unit geometry.')
add('overflow-hidden', f'<image x="4" y="4" width="2" height="2" overflow="hidden" href="{overflow}"/>',
    rect(4, 4, 2, 2, 'red'),
    'Hidden overflow on the image clips independently of visible overflow on its document root.')
nested = data(document(f'<image width="8" height="4" href="{url}"/>',
                       'width="8" height="4"'))
add('recursive-data', f'<image x="1" y="1" width="8" height="4" href="{nested}"/>',
    rect(1, 1, 4, 4, 'red') + rect(5, 1, 4, 4, 'blue'),
    'Secure embedded documents permit nested data images and retain their independent layouts.')
add('group-opacity', f'<image x="1" y="1" width="8" height="4" opacity=".5" href="{url}"/>',
    '<g opacity=".5">' + rect(1, 1, 4, 4, 'red') + rect(5, 1, 4, 4, 'blue') + '</g>',
    'Image opacity is applied once to the isolated embedded document output.')
deferred = data(source.replace('viewBox="0 0 2 1"',
                               'viewBox="0 0 2 1" preserveAspectRatio="xMaxYMax meet"'))
add('defer', f'<image x="1" y="1" width="8" height="8" preserveAspectRatio="defer xMinYMin meet" href="{deferred}"/>',
    rect(1, 5, 4, 4, 'red') + rect(5, 5, 4, 4, 'blue'),
    'SVG 1.1 defer uses the explicitly supplied child aspect-ratio alignment before SVG2 viewport layout.')
add('ignore-root-par', f'<image x="1" y="1" width="8" height="8" preserveAspectRatio="xMinYMin meet" href="{deferred}"/>',
    rect(1, 1, 4, 4, 'red') + rect(5, 1, 4, 4, 'blue'),
    'Without defer, image alignment wins over the child root aspect-ratio attribute.')
pattern = '<defs><pattern id="p" patternUnits="userSpaceOnUse" width="4" height="2">{}</pattern></defs><rect width="12" height="12" fill="url(#p)"/>'
add('in-pattern', pattern.format(f'<image width="4" height="2" href="{url}"/>'),
    pattern.format(rect(0, 0, 2, 2, 'red') + rect(2, 0, 2, 2, 'blue')),
    'Embedded commands also execute in retained pattern pictures at tile resolution.')
mask = '<defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="12" height="12" style="mask-type:alpha">{}</mask></defs><rect width="12" height="12" fill="lime" mask="url(#m)"/>'
add('in-mask', mask.format(f'<image x="1" y="2" width="8" height="4" href="{url}"/>'),
    mask.format(rect(1, 2, 8, 4, 'white')),
    'An embedded image supplies alpha coverage as content of an SVG mask.')
gradient_content = '<defs><linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="8" height="4" fill="url(#g)"/>'
gradient = data(document(gradient_content, 'width="8" height="4"'))
add('gradient-projective', f'<image width="8" height="4" style="{projective}" href="{gradient}"/>',
    f'<g style="{projective}">{gradient_content}</g>',
    'Child gradient sampling composes the image placement instead of retaining source-device coordinates.')
overflow_pattern = pattern.replace('id="p"', 'id="p" overflow="visible"')
overflow_source = data(document('<rect x="-2" width="6" height="2" fill="red" opacity=".5"/>',
                                'width="2" height="2" overflow="visible"'))
add('in-overflow-pattern', overflow_pattern.format(f'<image x="3" width="2" height="2" overflow="visible" href="{overflow_source}"/>'),
    overflow_pattern.format('<rect x="1" width="6" height="2" fill="red" opacity=".5"/>'),
    'Pattern overflow enumeration includes child document painting beyond the image positioning rectangle, including overlapping alpha.')
# Resource files are also direct-render controls, so every tracked SVG has an
# explicit manifest entry and the secure test cannot pass because its payload broke.
for filename in ('nested-external.svg', 'nested-secure-source.svg'):
    reference = 'control-' + filename
    (ROOT / 'references' / reference).write_text(document(rect(0, 0, 2, 2, 'blue'), 'width="2" height="2"'))
    manifest['cases'].append(dict(
        id='image-nested-control-' + filename[:-4], input='inputs/' + filename,
        references=[dict(path='references/' + reference, relation='==')],
        status='pass', tolerance={}, spec=SPEC,
        reason='Direct static rendering validates the resource content and that external image loading works outside secure embedded mode.'))
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
