#!/usr/bin/env python3
"""Generate original PNG/JPEG image integration fixtures; needs Pillow for JPEG."""
from pathlib import Path
import zlib,struct,base64,json
root=Path(__file__).resolve().parents[1]/'tests/fixtures/images'
(root/'inputs').mkdir(parents=True,exist_ok=True);(root/'references').mkdir(exist_ok=True)
def chunk(k,d):return struct.pack('>I',len(d))+k+d+struct.pack('>I',zlib.crc32(k+d))
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',2,1,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0\xff\0\0\xff\0\0\xff\xff'))+chunk(b'IEND',b'')
url='data:image/png;base64,'+base64.b64encode(png).decode()
def svg(s): return '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8">'+s+'</svg>\n'
manifest_path=root/'manifest.json'
previous=json.loads(manifest_path.read_text())['cases'] if manifest_path.exists() else []
cases=[]
for name,attrs,ref in [('natural','x="2" y="3"','<rect x="2" y="3" width="1" height="1" fill="red"/><rect x="3" y="3" width="1" height="1" fill="blue"/>'),('none','x="2" y="2" width="8" height="4" preserveAspectRatio="none"','<rect x="2" y="2" width="4" height="4" fill="red"/><rect x="6" y="2" width="4" height="4" fill="blue"/>'),('meet','x="2" y="0" width="8" height="8"','<rect x="2" y="2" width="4" height="4" fill="red"/><rect x="6" y="2" width="4" height="4" fill="blue"/>'),('zero','width="0" height="8"',''),('broken','width="8" height="8"','')]:
 source=url if name!='broken' else 'data:image/png;base64,AAAA'
 (root/'inputs'/f'{name}.svg').write_text(svg(f'<image href="{source}" {attrs} style="image-rendering:optimizeSpeed"/>'))
 (root/'references'/f'{name}.svg').write_text(svg(ref))
 cases.append(dict(id='image-'+name,input=f'inputs/{name}.svg',references=[dict(path=f'references/{name}.svg',relation='==')],status='pass',reason='Original 2x1 red/blue RGBA PNG built with Python zlib and explicit PNG chunks; reference rectangles follow SVG image geometry and nearest sampling.',spec='https://www.w3.org/TR/2018/CR-SVG2-20181004/embedded.html#ImageElement',tolerance={}))
# Additional original fixtures. Constant JPEG blocks have only DC coefficients;
# value 128 remains exactly 128 after IDCT, independently of lossy quality.
from PIL import Image
from io import BytesIO
jpeg=BytesIO(); exif=Image.Exif();exif[274]=6
Image.new('L',(2,3),128).save(jpeg,format='JPEG',exif=exif)
jpegurl='data:image/jpeg;base64,'+base64.b64encode(jpeg.getvalue()).decode()
redblue='<rect width="1" height="1" fill="red"/><rect x="1" width="1" height="1" fill="blue"/>'
extras=[
 ('jpeg-orientation',f'<image x="2" y="3" href="{jpegurl}"/>','<rect x="2" y="3" width="3" height="2" fill="#808080"/>'),
 ('opacity',f'<image href="{url}" opacity="0.5"/>',f'<g opacity="0.5">{redblue}</g>'),
 ('ignore-fill-stroke',f'<image href="{url}" fill="none" stroke="lime" stroke-width="8" fill-opacity="0"/>',redblue),
 ('transform',f'<image href="{url}" transform="translate(3 2) scale(2)" style="image-rendering:optimizeSpeed"/>',f'<g transform="translate(3 2) scale(2)">{redblue}</g>'),
 ('repeated',f'<image href="{url}"/><image href="{url}" x="4" y="3"/>',redblue+f'<g transform="translate(4 3)">{redblue}</g>'),
 ('use',f'<defs><image id="tile" href="{url}"/></defs><use href="#tile" x="4" y="3"/>',f'<g transform="translate(4 3)">{redblue}</g>'),
 ('slice',f'<image href="{url}" width="4" height="4" preserveAspectRatio="xMidYMid slice" style="image-rendering:optimizeSpeed"/>','<rect width="2" height="4" fill="red"/><rect x="2" width="2" height="4" fill="blue"/>'),
 ('projective',f'<image href="{url}" width="8" height="4" style="transform:perspective(30px) rotateY(30deg);image-rendering:optimizeSpeed"/>','<defs><clipPath id="edge"><rect width="8" height="4"/></clipPath></defs><g style="transform:perspective(30px) rotateY(30deg)" clip-path="url(#edge)"><rect x="-100" y="-100" width="200" height="200" fill="blue"/><rect x="-100" y="-100" width="104" height="200" fill="red" shape-rendering="crispEdges"/></g>'),
]
for name,source,ref in extras:
 (root/'inputs'/f'{name}.svg').write_text(svg(source));(root/'references'/f'{name}.svg').write_text(svg(ref))
 cases.append(dict(id='image-'+name,input=f'inputs/{name}.svg',references=[dict(path=f'references/{name}.svg',relation='==')],status='pass',reason='Original sample data; reference rectangles independently express orientation, image placement and compositing. JPEG is uniform gray 128 with EXIF orientation 6.',spec='https://www.w3.org/TR/2018/CR-SVG2-20181004/embedded.html#ImageElement',tolerance={}))
alpha_png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',2,1,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0\xff\0\0\x80\0\0\xff\x40'))+chunk(b'IEND',b'')
alpha_url='data:image/png;base64,'+base64.b64encode(alpha_png).decode()
extras=[
 ('source-alpha',f'<image href="{alpha_url}"/>','<rect width="1" height="1" fill="red" fill-opacity="0.5019607843137255"/><rect x="1" width="1" height="1" fill="blue" fill-opacity="0.25098039215686275"/>'),
 ('mask-content',f'<defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="2" height="1" style="mask-type:alpha"><image href="{url}"/></mask></defs><rect width="8" height="8" fill="lime" mask="url(#m)"/>','<rect width="2" height="1" fill="lime"/>'),
 ('pattern-content',f'<defs><pattern id="p" patternUnits="userSpaceOnUse" width="2" height="1"><image href="{url}"/></pattern></defs><rect width="8" height="4" fill="url(#p)"/>',''.join(f'<rect x="{x}" width="1" height="4" fill="{("red" if x%2==0 else "blue")}"/>' for x in range(8))),
]
for name,source,ref in extras:
 (root/'inputs'/f'{name}.svg').write_text(svg(source));(root/'references'/f'{name}.svg').write_text(svg(ref))
 cases.append(dict(id='image-'+name,input=f'inputs/{name}.svg',references=[dict(path=f'references/{name}.svg',relation='==')],status='pass',reason='Original two-sample PNG verifies premultiplied source alpha and images used inside retained mask/pattern pictures.',spec='https://www.w3.org/TR/2018/CR-SVG2-20181004/embedded.html#ImageElement',tolerance={}))
ids={c['id'] for c in cases}
cases.extend(c for c in previous if c['id'] not in ids)
manifest_path.write_text(json.dumps(dict(version=1,suite='own',mode='reference',cases=cases),indent=2)+'\n')
