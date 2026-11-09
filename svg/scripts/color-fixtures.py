#!/usr/bin/env python3
"""Source colour management probes: embedded ICC profiles and PNG gAMA/cHRM.

Profiles are crafted here byte by byte (ICC.1:2022 §7, §10). Expected colours come
from an independent double-precision evaluation of the matrix/TRC model (§F.3)
with the sRGB encoding (IEC 61966-2-1), in the same operation order as the renderer,
and are written as rectangles in the reference SVGs. Needs Pillow for the JPEG case.
"""
import base64
from io import BytesIO
import json
import math
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/color'
D50 = (0.964202880859375, 1.0, 0.8249053955078125)
SRGB_COLORANTS = [0.4360747, 0.3850649, 0.1430804,
                  0.2225045, 0.7168786, 0.0606169,
                  0.0139322, 0.0971045, 0.7141733]
SPEC_ICC = 'https://www.color.org/specification/ICC.1-2022-05.pdf#page=115'  # Annex F.2, F.3
SPEC_LUT = 'https://www.color.org/specification/ICC.1-2022-05.pdf#page=65'  # 10.10-10.12
SPEC_EMBED = 'https://www.color.org/specification/ICC.1-2022-05.pdf#page=97'  # Annex B

# Samples: primaries, secondaries, a gray ramp and mid colours.
PIXELS = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 255),
          (128, 128, 128), (64, 32, 200), (10, 240, 90), (0, 0, 0)]


# ---- ICC profile writing ---------------------------------------------------

def s15(value):
    return struct.pack('>i', round(value * 65536))


def xyz_tag(x, y, z):
    return b'XYZ \0\0\0\0' + s15(x) + s15(y) + s15(z)


def curv(values):
    if isinstance(values, float):
        return b'curv\0\0\0\0' + struct.pack('>IH', 1, round(values * 256)) + b'\0\0'
    body = b'curv\0\0\0\0' + struct.pack('>I', len(values)) + b''.join(struct.pack('>H', v) for v in values)
    return body + b'\0' * (-len(body) % 4)


def para(kind, params):
    return b'para\0\0\0\0' + struct.pack('>HH', kind, 0) + b''.join(s15(p) for p in params)


def profile(space, tags, pcs=b'XYZ '):
    entries = []
    offset = 128 + 4 + 12 * len(tags)
    data = b''
    for name, body in tags:
        entries.append(name + struct.pack('>II', offset + len(data), len(body)))
        data += body
        data += b'\0' * (-len(data) % 4)
    size = 128 + 4 + 12 * len(tags) + len(data)
    header = struct.pack('>I', size) + b'none' + b'\x02\x40\0\0' + b'mntr' + space + pcs
    header += b'\0' * 12 + b'acsp' + b'\0' * (128 - 40)
    header = header[:68] + s15(D50[0]) + s15(D50[1]) + s15(D50[2]) + header[80:]
    return header + struct.pack('>I', len(tags)) + b''.join(entries) + data


def rgb_profile(colorants, curves):
    r, g, b = colorants
    return profile(b'RGB ', [(b'rXYZ', xyz_tag(*r)), (b'gXYZ', xyz_tag(*g)), (b'bXYZ', xyz_tag(*b)),
                             (b'rTRC', curves[0]), (b'gTRC', curves[1]), (b'bTRC', curves[2])])


# ---- Independent evaluation (mirrors graphics/codec/src/icc.silk) --------

def read16(d, o):
    return d[o] * 256 + d[o + 1]


def read32(d, o):
    return d[o] * 16777216 + d[o + 1] * 65536 + read16(d, o + 2)


def fixed(d, o):
    raw = read32(d, o)
    m = raw / 65536.0
    return m - 65536.0 if raw >= 2147483648 else m


def find(d, name):
    for i in range(read32(d, 128)):
        e = 132 + i * 12
        if d[e:e + 4] == name:
            return read32(d, e + 4), read32(d, e + 8)
    return None


def clamp(v):
    return 0.0 if v != v or v <= 0.0 else 1.0 if v >= 1.0 else v


def power(b, e):
    return 0.0 if b <= 0.0 else math.pow(b, e)


def evaluate(d, name, x):
    o, size = find(d, name)
    return evaluate_at(d, o, x)


def evaluate_at(d, o, x):
    if d[o:o + 4] == b'curv':
        n = read32(d, o + 8)
        if n == 0:
            return x
        if n == 1:
            return power(x, read16(d, o + 12) / 256.0)
        p = x * float(n - 1)
        i = int(math.floor(p))
        if i >= n - 1:
            i = n - 2
        lo = read16(d, o + 12 + i * 2) / 65535.0
        hi = read16(d, o + 14 + i * 2) / 65535.0
        return clamp(lo + (hi - lo) * (p - float(i)))
    kind = read16(d, o + 8)
    count = [1, 3, 4, 5, 7][kind]
    ps = [fixed(d, o + 12 + 4 * k) for k in range(count)]
    g = ps[0]
    a = ps[1] if count > 1 else 1.0
    b = ps[2] if count > 2 else 0.0
    c = ps[3] if count > 3 else 0.0
    dd = ps[4] if count > 4 else 0.0
    e = ps[5] if count > 5 else 0.0
    f = ps[6] if count > 6 else 0.0
    if kind == 0:
        v = power(x, g)
    elif kind == 1:
        v = power(a * x + b, g) if x >= -b / a else 0.0
    elif kind == 2:
        v = power(a * x + b, g) + c if x >= -b / a else c
    elif kind == 3:
        v = power(a * x + b, g) if x >= dd else c * x
    else:
        v = power(a * x + b, g) + e if x >= dd else c * x + f
    return clamp(v)


def multiply(a, b):
    return [a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
            for r in range(3) for c in range(3)]


def inverse(m):
    c0 = m[4] * m[8] - m[5] * m[7]
    c1 = m[5] * m[6] - m[3] * m[8]
    c2 = m[3] * m[7] - m[4] * m[6]
    det = m[0] * c0 + m[1] * c1 + m[2] * c2
    return [c0 / det, (m[2] * m[7] - m[1] * m[8]) / det, (m[1] * m[5] - m[2] * m[4]) / det,
            c1 / det, (m[0] * m[8] - m[2] * m[6]) / det, (m[2] * m[3] - m[0] * m[5]) / det,
            c2 / det, (m[1] * m[6] - m[0] * m[7]) / det, (m[0] * m[4] - m[1] * m[3]) / det]


PCS = inverse(SRGB_COLORANTS)


def srgb_decode(v):
    return v / 12.92 if v <= 0.04045 else math.pow((v + 0.055) / 1.055, 2.4)


def srgb_encode(v):
    v = clamp(v)
    e = v * 12.92 if v <= 0.0031308 else 1.055 * math.pow(v, 1.0 / 2.4) - 0.055
    return int(math.floor(clamp(e) * 255.0 + 0.5))


def icc_transform(d):
    """(tables, matrix) or None, as fromProfile."""
    space = d[16:20]
    if space == b'GRAY':
        t = [evaluate(d, b'kTRC', i / 255.0) for i in range(256)]
        w = [PCS[r * 3] * D50[0] + PCS[r * 3 + 1] * D50[1] + PCS[r * 3 + 2] * D50[2] for r in range(3)]
        return [t, t, t], [w[0], 0.0, 0.0, 0.0, w[1], 0.0, 0.0, 0.0, w[2]]
    if space != b'RGB ' or find(d, b'rXYZ') is None:
        return None
    cols = []
    for name in (b'rXYZ', b'gXYZ', b'bXYZ'):
        o, _ = find(d, name)
        cols.append([fixed(d, o + 8), fixed(d, o + 12), fixed(d, o + 16)])
    source = [cols[0][0], cols[1][0], cols[2][0], cols[0][1], cols[1][1], cols[2][1],
              cols[0][2], cols[1][2], cols[2][2]]
    tables = [[evaluate(d, n, i / 255.0) for i in range(256)] for n in (b'rTRC', b'gTRC', b'bTRC')]
    return tables, multiply(PCS, source)


def bradford(x, y, z):
    cone = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296]
    s = [cone[r * 3] * x + cone[r * 3 + 1] * y + cone[r * 3 + 2] * z for r in range(3)]
    t = [cone[r * 3] * D50[0] + cone[r * 3 + 1] * D50[1] + cone[r * 3 + 2] * D50[2] for r in range(3)]
    scale = [t[0] / s[0], 0.0, 0.0, 0.0, t[1] / s[1], 0.0, 0.0, 0.0, t[2] / s[2]]
    return multiply(inverse(cone), multiply(scale, cone))


def png_transform(gamma, chrm):
    matrix = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
    if chrm is not None:
        wx_, wy_, rx, ry, gx, gy, bx, by = [v / 100000.0 for v in chrm]
        primary = [rx / ry, gx / gy, bx / by, 1.0, 1.0, 1.0,
                   (1.0 - rx - ry) / ry, (1.0 - gx - gy) / gy, (1.0 - bx - by) / by]
        wx = wx_ / wy_
        wz = (1.0 - wx_ - wy_) / wy_
        sv = inverse(primary)
        sr = sv[0] * wx + sv[1] + sv[2] * wz
        sg = sv[3] * wx + sv[4] + sv[5] * wz
        sb = sv[6] * wx + sv[7] + sv[8] * wz
        to_xyz = multiply(primary, [sr, 0.0, 0.0, 0.0, sg, 0.0, 0.0, 0.0, sb])
        matrix = multiply(PCS, multiply(bradford(wx, 1.0, wz), to_xyz))
    if gamma is not None:
        e = 100000.0 / gamma
        t = [power(i / 255.0, e) for i in range(256)]
    else:
        t = [srgb_decode(i / 255.0) for i in range(256)]
    return [t, t, t], matrix


def convert(transform, rgb):
    if transform is None:
        return rgb
    if transform[0] == 'lut':
        _, d, lut = transform
        xyz = lut_evaluate(d, lut, [c / 255.0 for c in rgb][:lut['inputs']])
        return tuple(int(math.floor(v * 255.0 + 0.5)) for v in encode_xyz(xyz))
    tables, m = transform
    lr, lg, lb = tables[0][rgb[0]], tables[1][rgb[1]], tables[2][rgb[2]]
    return (srgb_encode(m[0] * lr + m[1] * lg + m[2] * lb),
            srgb_encode(m[3] * lr + m[4] * lg + m[5] * lb),
            srgb_encode(m[6] * lr + m[7] * lg + m[8] * lb))


def identity(transform):
    for v in range(256):
        for probe in ((v, 0, 0), (0, v, 0), (0, 0, v), (v, v, v)):
            if convert(transform, probe) != probe:
                return False
    return True


def effective(transform):
    return None if transform is None or identity(transform) else transform


# ---- LUT profiles (mirrors the Lut code in icc.silk) ---------------------------

def mft(kind, inputs, grid, in_tables, clut, out_tables):
    """lut8Type (kind 1) or lut16Type (kind 2); tables and CLUT as normalized floats."""
    width = 2 if kind == 2 else 1
    top = 65535 if kind == 2 else 255
    enc = (lambda v: struct.pack('>H', round(v * top))) if kind == 2 else (lambda v: bytes([round(v * top)]))
    body = (b'mft2' if kind == 2 else b'mft1') + b'\0' * 4 + bytes([inputs, 3, grid, 0])
    body += b''.join(s15(v) for v in (1, 0, 0, 0, 1, 0, 0, 0, 1))
    if kind == 2:
        body += struct.pack('>HH', len(in_tables[0]), len(out_tables[0]))
    for t in in_tables:
        body += b''.join(enc(v) for v in t)
    body += b''.join(enc(v) for v in clut)
    for t in out_tables:
        body += b''.join(enc(v) for v in t)
    return body


def pad4(b):
    return b + b'\0' * (-len(b) % 4)


def mab(inputs, a=None, grid=None, clut=None, precision=2, m=None, matrix=None, b=None):
    """lutAToBType with optional A curves, CLUT, M curves, 3x4 matrix and B curves."""
    parts = []
    offsets = {}
    at = 32

    def place(key, blob):
        nonlocal at
        offsets[key] = at
        parts.append(pad4(blob))
        at += len(pad4(blob))
    place('b', b''.join(pad4(c) for c in b))
    if matrix is not None:
        place('matrix', b''.join(s15(v) for v in matrix))
    if m is not None:
        place('m', b''.join(pad4(c) for c in m))
    if clut is not None:
        top = 65535 if precision == 2 else 255
        data = bytes(list(grid) + [0] * (16 - len(grid))) + bytes([precision, 0, 0, 0])
        data += b''.join(struct.pack('>H', round(v * top)) if precision == 2 else bytes([round(v * top)])
                         for v in clut)
        place('clut', data)
    if a is not None:
        place('a', b''.join(pad4(c) for c in a))
    head = b'mAB ' + b'\0' * 4 + bytes([inputs, 3, 0, 0])
    head += struct.pack('>5I', offsets.get('b', 0), offsets.get('matrix', 0), offsets.get('m', 0),
                        offsets.get('clut', 0), offsets.get('a', 0))
    return head + b''.join(parts)


def curve_length(d, o):
    if d[o:o + 4] == b'curv':
        return (12 + read32(d, o + 8) * 2 + 3) // 4 * 4
    return 12 + 4 * [1, 3, 4, 5, 7][read16(d, o + 8)]


def lut_for(d, intent):
    lab = d[20:24] == b'Lab '
    name = b'A2B0' if intent == 0 else b'A2B2' if intent == 2 else b'A2B1'
    for tagname in (name, b'A2B0'):
        if find(d, tagname) is not None:
            o, size = find(d, tagname)
            return lut_parse(d, o, lab)
    return None


def lut_parse(d, o, lab):
    inputs = d[o + 8]
    lut = dict(offset=o, inputs=inputs, lab=lab)
    sig = d[o:o + 4]
    if sig in (b'mft1', b'mft2'):
        wide = sig == b'mft2'
        lut['kind'] = 2 if wide else 1
        lut['precision'] = 2 if wide else 1
        lut['grid'] = [d[o + 10]] * inputs
        lut['in'] = read16(d, o + 48) if wide else 256
        lut['out'] = read16(d, o + 50) if wide else 256
        header = 52 if wide else 48
        lut['clut'] = o + header + lut['in'] * inputs * lut['precision']
        return lut
    lut['kind'] = 3
    b_off, mat_off, m_off, clut_off, a_off = struct.unpack('>5I', d[o + 12:o + 32])

    def curves(start, count):
        out, at = [], o + start
        for _ in range(count):
            out.append(at)
            at += curve_length(d, at)
        return out
    lut['b'] = curves(b_off, 3)
    lut['m'] = curves(m_off, 3) if m_off else None
    lut['matrix'] = o + mat_off if mat_off else 0
    if clut_off:
        start = o + clut_off
        lut['grid'] = list(d[start:start + inputs])
        lut['precision'] = d[start + 16]
        lut['clut'] = start + 20
    else:
        lut['precision'] = 0
    lut['a'] = curves(a_off, inputs) if a_off else None
    return lut


def sample(d, at, width):
    return read16(d, at) / 65535.0 if width == 2 else d[at] / 255.0


def table_at(d, start, count, width, x):
    p = clamp(x) * float(count - 1)
    i = int(math.floor(p))
    if i >= count - 1:
        i = count - 2
    t = p - float(i)
    lo = sample(d, start + i * width, width)
    hi = sample(d, start + (i + 1) * width, width)
    return lo + (hi - lo) * t


def clut_evaluate(d, lut, values):
    n = lut['inputs']
    base, frac, stride = [0] * n, [0.0] * n, [0] * n
    step = 3
    for k in range(n - 1, -1, -1):
        stride[k] = step
        step *= lut['grid'][k]
        g = lut['grid'][k]
        p = clamp(values[k]) * float(g - 1)
        i = int(math.floor(p))
        if i >= g - 1:
            i = g - 2
        base[k] = i
        frac[k] = p - float(i)
    out = [0.0, 0.0, 0.0]
    for corner in range(1 << n):
        w = 1.0
        at = 0
        for k in range(n):
            bit = (corner >> (n - 1 - k)) & 1
            w = w * (frac[k] if bit == 1 else 1.0 - frac[k])
            at += (base[k] + bit) * stride[k]
        for o in range(3):
            out[o] = out[o] + w * sample(d, lut['clut'] + (at + o) * lut['precision'], lut['precision'])
    return out


def lut_evaluate(d, lut, inputs):
    n = lut['inputs']
    if lut['kind'] in (1, 2):
        width = lut['precision']
        tables = lut['offset'] + (52 if lut['kind'] == 2 else 48)
        values = [table_at(d, tables + k * lut['in'] * width, lut['in'], width, inputs[k]) for k in range(n)]
        pcs = clut_evaluate(d, lut, values)
        size = 3 * width
        for g in lut['grid']:
            size *= g
        outputs = lut['clut'] + size
        pcs = [table_at(d, outputs + o * lut['out'] * width, lut['out'], width, pcs[o]) for o in range(3)]
    else:
        values = [evaluate_at(d, lut['a'][k], clamp(inputs[k])) if lut['a'] else clamp(inputs[k])
                  for k in range(n)]
        pcs = clut_evaluate(d, lut, values) if lut['precision'] else values[:3]
        if lut['m']:
            pcs = [evaluate_at(d, lut['m'][o], clamp(pcs[o])) for o in range(3)]
        if lut['matrix']:
            e = lut['matrix']
            x, y, z = pcs
            f = [fixed(d, e + 4 * k) for k in range(12)]
            pcs = [clamp(f[0] * x + f[1] * y + f[2] * z + f[9]),
                   clamp(f[3] * x + f[4] * y + f[5] * z + f[10]),
                   clamp(f[6] * x + f[7] * y + f[8] * z + f[11])]
        pcs = [evaluate_at(d, lut['b'][o], clamp(pcs[o])) for o in range(3)]
    return decode_pcs(lut, pcs)


def decode_pcs(lut, pcs):
    if not lut['lab']:
        scale = 65535.0 / 32768.0
        return [pcs[0] * scale, pcs[1] * scale, pcs[2] * scale]
    legacy = 65535.0 / 65280.0 if lut['kind'] == 2 else 1.0
    l = pcs[0] * legacy * 100.0
    a = pcs[1] * legacy * 255.0 - 128.0
    b = pcs[2] * legacy * 255.0 - 128.0
    fy = (l + 16.0) / 116.0
    fx = fy + a / 500.0
    fz = fy - b / 200.0

    def inv(t):
        return t * t * t if t > 6.0 / 29.0 else (t - 4.0 / 29.0) * 108.0 / 841.0
    return [D50[0] * inv(fx), D50[1] * inv(fy), D50[2] * inv(fz)]


def encode_xyz(xyz):
    def enc(v):
        v = clamp(v)
        return clamp(v * 12.92 if v <= 0.0031308 else 1.055 * math.pow(v, 1.0 / 2.4) - 0.055)
    m = PCS
    return [enc(m[r * 3] * xyz[0] + m[r * 3 + 1] * xyz[1] + m[r * 3 + 2] * xyz[2]) for r in range(3)]


def lut_transform(d, intent=None):
    if intent is None:
        intent = read32(d, 64) if read32(d, 64) <= 3 else 0
    lut = lut_for(d, intent)
    return ('lut', d, lut) if lut else None


# ---- Images ----------------------------------------------------------------

def chunk(kind, body):
    return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body))


def png(pixels, chunks=(), gray=False):
    if gray:
        rows = b'\0' + bytes(p[0] for p in pixels)
        header = struct.pack('>IIBBBBB', len(pixels), 1, 8, 0, 0, 0, 0)
    else:
        rows = b'\0' + bytes(c for p in pixels for c in p)
        depth = 6 if len(pixels[0]) == 4 else 2
        header = struct.pack('>IIBBBBB', len(pixels), 1, 8, depth, 0, 0, 0)
    out = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header)
    for kind, body in chunks:
        out += chunk(kind, body)
    return out + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')


def iccp(data):
    return (b'iCCP', b'probe\0\0' + zlib.compress(data))


def url(data, mime='image/png'):
    return f'data:{mime};base64,' + base64.b64encode(data).decode()


def svg(width, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="1">' + body + '</svg>\n'


def hexcolor(rgb):
    return '#%02x%02x%02x' % tuple(rgb[:3])


def reference(pixels, transform):
    t = effective(transform)
    body = ''
    for x, p in enumerate(pixels):
        out = convert(t, p[:3])
        if len(p) == 4:
            # Premultiplied storage: straight samples are re-derived before conversion.
            a = p[3]
            pre = [(c * a + 127) // 255 for c in p[:3]]
            back = [min(255, (c * 255 + a // 2) // a) for c in pre]
            out = convert(t, back)
            body += (f'<rect x="{x}" width="1" height="1" fill="{hexcolor(out)}" '
                     f'fill-opacity="{a / 255!r}"/>')
            continue
        body += f'<rect x="{x}" width="1" height="1" fill="{hexcolor(out)}"/>'
    return body


# Profiles under test.
WIDE = [(0.6097, 0.3111, 0.0195), (0.2053, 0.6257, 0.0609), (0.1492, 0.0632, 0.7446)]
SRGB_COLS = [(SRGB_COLORANTS[0], SRGB_COLORANTS[3], SRGB_COLORANTS[6]),
             (SRGB_COLORANTS[1], SRGB_COLORANTS[4], SRGB_COLORANTS[7]),
             (SRGB_COLORANTS[2], SRGB_COLORANTS[5], SRGB_COLORANTS[8])]
SRGB_PARA = para(3, [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045])
PROFILES = {
    'srgb': rgb_profile(SRGB_COLS, [SRGB_PARA] * 3),
    'linear': rgb_profile(SRGB_COLS, [curv([])] * 3),
    'wide-gamma': rgb_profile(WIDE, [curv(2.19921875)] * 3),
    'table': rgb_profile(SRGB_COLS, [curv([0, 4000, 16000, 40000, 65535])] * 3),
    'parametric': rgb_profile(WIDE, [para(0, [1.8]), para(1, [2.2, 1.1, -0.1]),
                                     para(4, [2.4, 0.95, 0.05, 0.08, 0.04, 0.01, 0.002])]),
    'gray': profile(b'GRAY', [(b'kTRC', curv(1.0))]),
}


def lut_only():
    # A profile whose only transform is a lut16Type A2B0 tag (§10.11): left for LUT support.
    return profile(b'RGB ', [(b'A2B0', b'mft2\0\0\0\0' + bytes([3, 3, 2, 0]) + b'\0' * 36)])


def jpeg_with(icc):
    from PIL import Image
    out = BytesIO()
    Image.new('L', (4, 1), 128).save(out, format='JPEG', icc_profile=icc, quality=100)
    return out.getvalue()


def device_color(d, comps, intent=0):
    """Continuous evaluation, as icc.deviceColor; None means fallback."""
    lut = lut_for(d, intent)
    if lut is not None:
        if len(comps) != lut['inputs']:
            return None
        return encode_xyz(lut_evaluate(d, lut, [clamp(c) for c in comps]))
    space = d[16:20]
    if space == b'GRAY':
        if len(comps) != 1:
            return None
        y = evaluate(d, b'kTRC', clamp(comps[0]))
        lin = [y, y, y]
        w = [PCS[r * 3] * D50[0] + PCS[r * 3 + 1] * D50[1] + PCS[r * 3 + 2] * D50[2] for r in range(3)]
        m = [w[0], 0.0, 0.0, 0.0, w[1], 0.0, 0.0, 0.0, w[2]]
    elif space == b'RGB ' and find(d, b'rXYZ') is not None:
        if len(comps) != 3:
            return None
        _, m = icc_transform(d)
        lin = [evaluate(d, n, clamp(c)) for n, c in zip((b'rTRC', b'gTRC', b'bTRC'), comps)]
    else:
        return None

    def enc(v):
        v = clamp(v)
        return clamp(v * 12.92 if v <= 0.0031308 else 1.055 * math.pow(v, 1.0 / 2.4) - 0.055)
    return [enc(m[r * 3] * lin[0] + m[r * 3 + 1] * lin[1] + m[r * 3 + 2] * lin[2]) for r in range(3)]


def css_color(rgb):
    return 'color(srgb %r %r %r)' % tuple(rgb)


def profile_element(name, data, ident=''):
    extra = f' id="{ident}"' if ident else ''
    return (f'<color-profile name="{name}"{extra} '
            f'href="{url(data, "application/vnd.iccprofile")}"/>')


def main():
    (ROOT / 'inputs').mkdir(parents=True, exist_ok=True)
    (ROOT / 'references').mkdir(exist_ok=True)
    cases = []

    def add(name, data, transform, reason, spec, pixels=PIXELS, mime='image/png'):
        width = len(pixels)
        image = (f'<image href="{url(data, mime)}" width="{width}" height="1" '
                 'style="image-rendering:optimizeSpeed"/>')
        (ROOT / 'inputs' / f'{name}.svg').write_text(svg(width, image))
        (ROOT / 'references' / f'{name}.svg').write_text(svg(width, reference(pixels, transform)))
        cases.append(dict(id='color-' + name, input=f'inputs/{name}.svg',
                          references=[dict(path=f'references/{name}.svg', relation='==')],
                          status='pass', reason=reason, spec=spec, tolerance={}))

    for key, data in PROFILES.items():
        if key == 'gray':
            continue
        add(f'icc-{key}', png(PIXELS, [iccp(data)]), icc_transform(data),
            f'PNG iCCP matrix/TRC profile ({key}) converted to sRGB; expected colours evaluated independently.',
            SPEC_ICC)
    gray_pixels = [(v, v, v) for v in (0, 32, 64, 128, 192, 255)]
    add('icc-gray', png(gray_pixels, [iccp(PROFILES['gray'])], gray=True), icc_transform(PROFILES['gray']),
        'Gray TRC profile (ICC.1:2022 F.2): luminance maps to the PCS white.', SPEC_ICC, gray_pixels)
    alpha_pixels = [(200, 40, 90, 128), (10, 250, 30, 64), (255, 255, 255, 255), (90, 90, 200, 1)]
    add('icc-alpha', png(alpha_pixels, [iccp(PROFILES['linear'])]), icc_transform(PROFILES['linear']),
        'Translucent samples convert their straight values; alpha is unchanged.', SPEC_ICC, alpha_pixels)
    add('icc-lut-malformed', png(PIXELS, [iccp(lut_only())]), None,
        'A truncated lut16Type A2B0 tag is ignored and the samples are treated as sRGB.', SPEC_LUT)
    add('icc-malformed', png(PIXELS, [iccp(PROFILES['linear'][:100])]), None,
        'A truncated profile is ignored and the samples are treated as sRGB.', SPEC_ICC)
    add('icc-over-gama', png(PIXELS, [(b'gAMA', struct.pack('>I', 100000)), iccp(PROFILES['wide-gamma'])]),
        icc_transform(PROFILES['wide-gamma']), 'iCCP takes precedence over gAMA.', 'https://www.w3.org/TR/png-3/#11iCCP')
    add('gama', png(PIXELS, [(b'gAMA', struct.pack('>I', 100000))]), png_transform(100000, None),
        'gAMA alone: linear = sample^(100000/gAMA) with sRGB primaries ', 'https://www.w3.org/TR/png-3/#11gAMA')
    chrm = (31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000)
    wide_chrm = (34570, 35850, 73470, 26530, 15950, 84270, 3660, 100)
    add('gama-chrm', png(PIXELS, [(b'gAMA', struct.pack('>I', 55556)), (b'cHRM', struct.pack('>8I', *wide_chrm))]),
        png_transform(55556, wide_chrm), 'gAMA with cHRM: primaries and white adapted to D50 with Bradford.', 'https://www.w3.org/TR/png-3/#11cHRM')
    add('chrm-srgb', png(PIXELS, [(b'cHRM', struct.pack('>8I', *chrm))]), png_transform(None, chrm),
        'cHRM with sRGB primaries and no gAMA keeps sRGB samples.', 'https://www.w3.org/TR/png-3/#11cHRM')
    add('srgb-over-gama', png(PIXELS, [(b'sRGB', b'\0'), (b'gAMA', struct.pack('>I', 100000))]), None,
        'An sRGB chunk overrides gAMA and cHRM.', 'https://www.w3.org/TR/png-3/#11sRGB')
    jpeg_pixels = [(128, 128, 128)] * 4
    add('jpeg-icc', jpeg_with(PROFILES['linear']), icc_transform(PROFILES['linear']),
        'JPEG APP2 ICC_PROFILE (ICC.1:2022 Annex B); uniform gray 128 survives the DCT exactly.',
        SPEC_EMBED, jpeg_pixels, 'image/jpeg')

    # SVG 1.1 color-profile elements, icc-color() and the color-profile property.
    spec_paint = 'https://www.w3.org/TR/SVG11/painting.html#SpecifyingPaint'
    spec_prop = 'https://www.w3.org/TR/SVG11/color.html#ColorProfileProperty'
    spec_element = 'https://www.w3.org/TR/SVG11/color.html#ColorProfileElement'

    def page(name, width, height, body, ref, reason, spec):
        head = f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}">'
        (ROOT / 'inputs' / f'{name}.svg').write_text(head + body + '</svg>\n')
        (ROOT / 'references' / f'{name}.svg').write_text(head + ref + '</svg>\n')
        cases.append(dict(id='color-' + name, input=f'inputs/{name}.svg',
                          references=[dict(path=f'references/{name}.svg', relation='==')],
                          status='pass', reason=reason, spec=spec, tolerance={}))

    lin = PROFILES['linear']
    wide = PROFILES['wide-gamma']
    gray = PROFILES['gray']
    defs = profile_element('lin', lin) + profile_element('wide', wide, 'w') + profile_element('g', gray)
    probes = [('lin', [0.5, 0.5, 0.5]), ('wide', [0.2, 0.7, 0.4]), ('g', [0.25]),
              ('lin', [0.5, 0.5]), ('missing', [0.1, 0.2, 0.3])]
    body = ref = ''
    for x, (name, comps) in enumerate(probes):
        data = {'lin': lin, 'wide': wide, 'g': gray}.get(name)
        args = ', '.join(repr(c) for c in comps)
        body += f'<rect x="{x * 2}" width="2" height="2" fill="#ff8000 icc-color({name}, {args})"/>'
        out = device_color(data, comps) if data else None
        fill = css_color(out) if out else '#ff8000'
        ref += f'<rect x="{x * 2}" width="2" height="2" fill="{fill}"/>'
    page('icc-paint', 10, 2, '<defs>' + defs + '</defs>' + body, ref,
         'icc-color() through matrix/TRC and gray profiles; a wrong component count or unknown '
         'profile uses the sRGB fallback.', spec_paint)

    stop = device_color(wide, [0.9, 0.1, 0.3])
    flood = device_color(lin, [0.25, 0.5, 0.75])
    body = ('<defs>' + defs + '<linearGradient id="s"><stop offset="0" stop-color="#000 icc-color(wide, 0.9, 0.1, 0.3)"/>'
            '<stop offset="1" stop-color="#000 icc-color(wide, 0.9, 0.1, 0.3)"/></linearGradient>'
            '<filter id="f" x="0" y="0" width="1" height="1"><feFlood flood-color="#000 icc-color(lin, 0.25, 0.5, 0.75)"/></filter>'
            '</defs><rect width="2" height="2" fill="url(#s)"/><rect x="2" width="2" height="2" filter="url(#f)"/>'
            '<rect x="4" width="2" height="2" stroke="none" fill="url(#none) #000 icc-color(lin, 0.25, 0.5, 0.75)"/>')
    ref = (f'<rect width="2" height="2" fill="{css_color(stop)}"/><rect x="2" width="2" height="2" fill="{css_color(flood)}"/>'
           f'<rect x="4" width="2" height="2" fill="{css_color(flood)}"/>')
    page('icc-stop-flood', 6, 2, body, ref,
         'stop-color, flood-color and paint-server fallbacks accept icc-color().', spec_paint)

    tagged = png(PIXELS, [iccp(wide)])
    untagged = png(PIXELS)
    width = len(PIXELS)

    def img(data, y, attrs=''):
        return (f'<image href="{url(data)}" y="{y}" width="{width}" height="1" {attrs} '
                'style="image-rendering:optimizeSpeed"/>')

    def row(transform, y):
        t = effective(transform)
        return ''.join(f'<rect x="{x}" y="{y}" width="1" height="1" fill="{hexcolor(convert(t, p))}"/>'
                       for x, p in enumerate(PIXELS))
    body = ('<defs>' + defs + '</defs>' + img(tagged, 0) + img(tagged, 1, 'color-profile="sRGB"')
            + img(tagged, 2) + img(untagged, 3, 'color-profile="lin"')
            + img(untagged, 4, 'style="color-profile:url(#w)"')
            + f'<g color-profile="lin">{img(untagged, 5)}</g>'
            + img(tagged, 6, 'color-profile="missing"'))
    ref = (row(icc_transform(wide), 0) + row(None, 1) + row(icc_transform(wide), 2)
           + row(icc_transform(lin), 3) + row(icc_transform(wide), 4) + row(icc_transform(lin), 5)
           + row(icc_transform(wide), 6))
    body = body.replace('style="color-profile:url(#w)" style="image-rendering:optimizeSpeed"',
                        'style="color-profile:url(#w);image-rendering:optimizeSpeed"')
    page('image-color-profile', width, 7, body, ref,
         'color-profile on images: sRGB ignores the embedded profile per occurrence, names and '
         'IRIs select a color-profile element, the property inherits, unknown names keep auto.', spec_prop)

    sheet = device_color(wide, [0.3, 0.6, 0.9])
    rule = f'@color-profile {{ name: sheet; src: url("{url(lin, "application/vnd.iccprofile")}") }}'
    rule2 = f'@color-profile {{ name: sheet2; src: url("{url(wide, "application/vnd.iccprofile")}") }}'
    body = (f'<style>{rule} {rule2}</style>'
            '<rect width="2" height="2" fill="#000 icc-color(sheet2, 0.3, 0.6, 0.9)"/>'
            + img(untagged, 0, 'x="2" color-profile="sheet"').replace('width="8"', 'width="8"'))
    ref = (f'<rect width="2" height="2" fill="{css_color(sheet)}"/>'
           + ''.join(f'<rect x="{x + 2}" y="0" width="1" height="1" fill="{hexcolor(convert(effective(icc_transform(lin)), p))}"/>'
                     for x, p in enumerate(PIXELS)))
    page('at-color-profile', width + 2, 2, body, ref,
         '@color-profile rules name profiles for icc-color() and the color-profile property.',
         'https://www.w3.org/TR/SVG11/color.html#ColorProfileAtRule')

    # LUT-based profiles (ICC.1:2022 10.10-10.12), with PCS Lab and XYZ.
    grid3 = [(r / 2, g / 2, b / 2) for r in range(3) for g in range(3) for b in range(3)]

    def lab_point(r, g, b):
        return [0.2 * r + 0.7 * g + 0.1 * b, 0.5 + 0.3 * (r - g), 0.5 + 0.3 * (g - b)]
    lab_clut = [v for p in grid3 for v in lab_point(*p)]
    curve5 = [(i / 4) ** 1.5 for i in range(5)]
    mft2_lab = profile(b'RGB ', [(b'A2B0', mft(2, 3, 3, [curve5] * 3, lab_clut, [[0.0, 0.48, 1.0]] * 3))],
                       pcs=b'Lab ')
    t256 = [(i / 255) ** 1.2 for i in range(256)]
    mft1_lab = profile(b'RGB ', [(b'A2B0', mft(1, 3, 3, [t256] * 3, lab_clut, [[i / 255 for i in range(256)]] * 3))],
                       pcs=b'Lab ')
    xyz_scale = 32768 / 65535
    grid342 = [(r / 2, g / 3, b) for r in range(3) for g in range(4) for b in range(2)]
    xyz_clut = [min(1.0, v * xyz_scale) for (r, g, b) in grid342
                for v in (0.43 * r + 0.39 * g + 0.14 * b, 0.22 * r + 0.72 * g + 0.06 * b,
                          0.01 * r + 0.10 * g + 0.71 * b)]
    mab_xyz = profile(b'RGB ', [(b'A2B0', mab(3, a=[para(0, [2.2])] * 3, grid=(3, 4, 2), clut=xyz_clut,
                                             m=[para(0, [1.1]), curv([]), curv(0.9)],
                                             matrix=[0.9, 0.0, 0.0, 0.0, 0.95, 0.0, 0.0, 0.0, 0.9, 0.02, 0.01, 0.0],
                                             b=[curv([0, 30000, 65535])] * 3))])
    grid4 = [(c, m_, y, k) for c in range(2) for m_ in range(2) for y in range(2) for k in range(2)]
    cmyk_clut = [v for (c, m_, y, k) in grid4
                 for v in (max(0.0, 0.95 - 0.3 * c - 0.5 * m_ - 0.1 * y - 0.8 * k),
                           0.5 - 0.2 * c + 0.3 * m_ - 0.05 * y, 0.5 - 0.1 * c - 0.1 * m_ + 0.35 * y)]
    mab_cmyk = profile(b'CMYK', [(b'A2B0', mab(4, a=[curv([])] * 4, grid=(2, 2, 2, 2), clut=cmyk_clut,
                                              precision=1, b=[curv([])] * 3))], pcs=b'Lab ')
    gray_lut = profile(b'GRAY', [(b'A2B0', mft(2, 1, 5, [[0.0, 1.0]], [v for i in range(5) for v in (i / 4, 0.5, 0.5)],
                                               [[0.0, 1.0]] * 3))], pcs=b'Lab ')
    # A2B0 and A2B1 differ, and matrix/TRC tags are present too: AToB wins (8.3).
    srgb_tags = [(b'rXYZ', xyz_tag(*SRGB_COLS[0])), (b'gXYZ', xyz_tag(*SRGB_COLS[1])),
                 (b'bXYZ', xyz_tag(*SRGB_COLS[2])), (b'rTRC', curv([])), (b'gTRC', curv([])), (b'bTRC', curv([]))]
    intents = profile(b'RGB ', srgb_tags + [
        (b'A2B0', mab(3, b=[para(0, [2.2]), para(0, [2.0]), para(0, [1.8])],
                      matrix=[0.43, 0.39, 0.14, 0.22, 0.72, 0.06, 0.01, 0.10, 0.71, 0.0, 0.0, 0.0])),
        (b'A2B1', mab(3, b=[para(0, [1.0])] * 3,
                      matrix=[0.43, 0.39, 0.14, 0.22, 0.72, 0.06, 0.01, 0.10, 0.71, 0.0, 0.0, 0.0]))])
    lut_profiles = {'mft2-lab': mft2_lab, 'mft1-lab': mft1_lab, 'mab-xyz': mab_xyz, 'mab-intents': intents}
    for key, data in lut_profiles.items():
        add(f'lut-{key}', png(PIXELS, [iccp(data)]), lut_transform(data),
            f'PNG iCCP with a LUT-based A2B0 tag ({key}); expected colours evaluated independently.', SPEC_LUT)
    add('lut-gray', png(gray_pixels, [iccp(gray_lut)], gray=True), lut_transform(gray_lut),
        'Gray lut16Type with a legacy Lab PCS.', SPEC_LUT, gray_pixels)

    defs = (profile_element('cmyk', mab_cmyk) + profile_element('perc', intents)
            + profile_element('rel', intents).replace('/>', ' rendering-intent="relative-colorimetric"/>', 1)
            + profile_element('mft', mft2_lab))
    probes = [('cmyk', [0.1, 0.7, 0.2, 0.05], 0), ('cmyk', [0.9, 0.1, 0.6, 0.3], 0), ('cmyk', [0.1, 0.2, 0.3], 0),
              ('perc', [0.3, 0.6, 0.2], 0), ('rel', [0.3, 0.6, 0.2], 1), ('mft', [0.8, 0.4, 0.1], 0)]
    data_of = {'cmyk': mab_cmyk, 'perc': intents, 'rel': intents, 'mft': mft2_lab}
    body = ref = ''
    for x, (name, comps, intent) in enumerate(probes):
        args = ', '.join(repr(c) for c in comps)
        body += f'<rect x="{x * 2}" width="2" height="2" fill="#ff8000 icc-color({name}, {args})"/>'
        out = device_color(data_of[name], comps, intent)
        ref += f'<rect x="{x * 2}" width="2" height="2" fill="{css_color(out) if out else "#ff8000"}"/>'
    page('lut-paint', 12, 2, '<defs>' + defs + '</defs>' + body, ref,
         'icc-color() through CMYK and RGB LUT profiles; the element rendering-intent selects A2B1.',
         SPEC_LUT)
    body = ('<defs>' + defs + '</defs>' + img(untagged, 0, 'color-profile="perc"')
            + img(untagged, 1, 'color-profile="rel"'))
    ref = row(lut_transform(intents, 0), 0) + row(lut_transform(intents, 1), 1)
    page('lut-image-intent', width, 2, body, ref,
         'A color-profile element\'s rendering-intent picks the AToB tag used for images.', SPEC_LUT)

    (ROOT / 'manifest.json').write_text(json.dumps(dict(version=1, suite='own', mode='reference', cases=cases),
                                                   indent=2) + '\n')
    for c in cases:
        print(c['id'])


if __name__ == '__main__':
    main()
