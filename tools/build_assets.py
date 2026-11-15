"""
Turns the raw Moon Racer assets into the small web files in assets/.

Needs Python 3 with numpy and Pillow, and macOS `sips` (for the 16-bit TIFF).
Usage:  python tools/build_assets.py "/path/to/raw/Moon Racer folder"

Raw files expected in that folder:
  lroc_color_16bit_srgb_8k.tif, moon_surface.glb, biii-5__military_thruster.glb,
  race_track_-_c_.001_-_3.3km.glb, 2013_ferrari_la_ferrari.glb, byd_u9 copy.glb
"""
import io, json, os, shutil, struct, subprocess, sys, tempfile
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
RAW = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


# ---------- GLB helpers ----------
def read_glb(path):
    f = open(path, 'rb').read()
    l = struct.unpack('<I', f[12:16])[0]
    j = json.loads(f[20:20 + l])
    o = 20 + l
    bl = struct.unpack('<I', f[o:o + 4])[0]
    return j, f[o + 8:o + 8 + bl]


def write_glb(path, j, chunks):
    """chunks: list of bytes, one per bufferView (in order)."""
    blob = bytearray()
    for i, c in enumerate(chunks):
        while len(blob) % 4:
            blob.append(0)
        j['bufferViews'][i]['byteOffset'] = len(blob)
        j['bufferViews'][i]['byteLength'] = len(c)
        j['bufferViews'][i]['buffer'] = 0
        blob += c
    while len(blob) % 4:
        blob.append(0)
    j['buffers'] = [{'byteLength': len(blob)}]
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(blob), 0x004E4942) + bytes(blob))
    print('  wrote %s  %.2f MB' % (os.path.basename(path), total / 1e6))


def view_bytes(j, bin_, i):
    bv = j['bufferViews'][i]
    o = bv.get('byteOffset', 0)
    return bin_[o:o + bv['byteLength']]


def accessor(j, bin_, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    dt = np.dtype(CT[a['componentType']])
    n = NC[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    st = bv.get('byteStride', 0)
    if st and st != dt.itemsize * n:
        raw = np.frombuffer(bin_, dtype=np.uint8, count=st * (a['count'] - 1) + dt.itemsize * n, offset=off)
        idx = np.arange(a['count'])[:, None] * st + np.arange(dt.itemsize * n)[None, :]
        return raw[idx].copy().view(dt).reshape(a['count'], n)
    return np.frombuffer(bin_, dtype=dt, count=a['count'] * n, offset=off).reshape(a['count'], n)


def to_webp(data, max_size, quality):
    im = Image.open(io.BytesIO(data))
    if im.mode in ('P', 'LA', 'I', 'I;16'):
        im = im.convert('RGBA' if 'A' in im.mode or 'transparency' in im.info else 'RGB')
    if im.mode == 'RGBA' and im.getextrema()[3][0] == 255:
        im = im.convert('RGB')
    if max(im.size) > max_size:
        s = max_size / max(im.size)
        im = im.resize((round(im.size[0] * s), round(im.size[1] * s)), Image.LANCZOS)
    b = io.BytesIO()
    im.save(b, 'WEBP', quality=quality, method=6)
    return b.getvalue()


def recompress_textures(src, dst, max_size=1024, quality=82, edits=None):
    """Same model, textures re-encoded as WebP (EXT_texture_webp).
    edits: {material name: function(PIL image) -> PIL image} applied to that material's textures."""
    j, bin_ = read_glb(src)
    chunks = [view_bytes(j, bin_, i) for i in range(len(j['bufferViews']))]
    for name, fn in (edits or {}).items():
        mat = next(m for m in j['materials'] if m.get('name') == name)
        pbr = mat['pbrMetallicRoughness']
        # colour, roughness and bump maps all carry the marking, so edit all three
        for tex in (pbr.get('baseColorTexture'), pbr.get('metallicRoughnessTexture'), mat.get('normalTexture')):
            if not tex:
                continue
            img = j['images'][j['textures'][tex['index']]['source']]
            out = io.BytesIO()
            fn(Image.open(io.BytesIO(chunks[img['bufferView']])).convert('RGB')).save(out, 'PNG')
            chunks[img['bufferView']] = out.getvalue()
    for im in j.get('images', []):
        chunks[im['bufferView']] = to_webp(chunks[im['bufferView']], max_size, quality)
        im['mimeType'] = 'image/webp'
    for t in j.get('textures', []):
        t['extensions'] = {'EXT_texture_webp': {'source': t.pop('source')}}
    for k in ('extensionsUsed', 'extensionsRequired'):
        j[k] = sorted(set(j.get(k, []) + ['EXT_texture_webp']))
    write_glb(dst, j, chunks)


def wipe_pod_number(im):
    """The thruster model has '05' painted on it. Paint it out (with the bare metal next to it),
    so the game can give every pod its own number."""
    a = np.asarray(im).copy()
    assert a.shape[0] == 1024
    # first '05': copy the clean strip to its left, mirrored
    a[160:385, 655:740] = a[160:385, 570:655][:, ::-1]
    # second '05': clean metal from its left, then redraw the yellow line that ran through the digits
    line = a[385:440, 864:886].copy()
    a[120:360, 846:932] = a[120:360, 790:846][:, np.arange(86) % 56]
    for y in range(120, 360):
        a[y, 864:886] = line[(y - 120) % 55]
    return Image.fromarray(a)


# ---------- moon terrain: bake transforms, drop unused data, quantize ----------
def node_matrix(nd):
    if 'matrix' in nd:
        return np.array(nd['matrix'], dtype=float).reshape(4, 4).T
    return np.eye(4)  # this model only uses matrices


def build_moon(src, dst):
    j, bin_ = read_glb(src)
    prims = []

    def rec(n, M):
        nd = j['nodes'][n]
        W = M @ node_matrix(nd)
        if 'mesh' in nd:
            for pr in j['meshes'][nd['mesh']]['primitives']:
                prims.append((pr, W))
        for c in nd.get('children', []):
            rec(c, W)

    for r in j['scenes'][0]['nodes']:
        rec(r, np.eye(4))

    allpos = []
    data = []
    for pr, W in prims:
        p = accessor(j, bin_, pr['attributes']['POSITION']).astype(np.float64) @ W[:3, :3].T + W[:3, 3]
        R = W[:3, :3] / np.cbrt(abs(np.linalg.det(W[:3, :3])))
        nrm = accessor(j, bin_, pr['attributes']['NORMAL']).astype(np.float64) @ R.T
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12
        uv0 = accessor(j, bin_, pr['attributes']['TEXCOORD_0']).astype(np.float64)
        uv1 = accessor(j, bin_, pr['attributes']['TEXCOORD_1']).astype(np.float64)
        idx = accessor(j, bin_, pr['indices']).reshape(-1).astype(np.uint32)
        if np.linalg.det(W[:3, :3]) < 0:
            idx = idx.reshape(-1, 3)[:, ::-1].reshape(-1)
        data.append((p, nrm, uv0, uv1, idx))
        allpos.append(p)
    allpos = np.concatenate(allpos)
    lo, hi = allpos.min(0), allpos.max(0)
    scale = (hi - lo).max() / 65535.0
    print('  moon bounds', lo.round(1), hi.round(1), 'uv0', min(d[2].min() for d in data), max(d[2].max() for d in data),
          'uv1', min(d[3].min() for d in data), max(d[3].max() for d in data))

    out = {'asset': {'version': '2.0', 'generator': 'moon-racer build_assets.py'},
           'extensionsUsed': ['KHR_mesh_quantization', 'EXT_texture_webp'],
           'extensionsRequired': ['KHR_mesh_quantization', 'EXT_texture_webp'],
           'scene': 0, 'scenes': [{'nodes': [0]}],
           'nodes': [{'name': 'MoonSurface', 'children': []}],
           'meshes': [], 'accessors': [], 'bufferViews': [],
           'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]}
    chunks = []

    def add(arr, ctype, typ, target, normalized=False, minmax=False):
        chunks.append(arr.tobytes())
        bv = {'buffer': 0, 'byteOffset': 0, 'byteLength': 0, 'target': target}
        if target == 34962:
            bv['byteStride'] = arr.dtype.itemsize * arr.shape[1]
        out['bufferViews'].append(bv)
        a = {'bufferView': len(out['bufferViews']) - 1, 'componentType': ctype, 'count': len(arr), 'type': typ}
        if normalized:
            a['normalized'] = True
        if minmax:
            a['min'] = arr.min(0).tolist()
            a['max'] = arr.max(0).tolist()
        out['accessors'].append(a)
        return len(out['accessors']) - 1

    for k, (p, nrm, uv0, uv1, idx) in enumerate(data):
        q = np.zeros((len(p), 4), dtype=np.uint16)
        q[:, :3] = np.clip(np.round((p - lo) / scale), 0, 65535)
        n8 = np.zeros((len(p), 4), dtype=np.int8)
        n8[:, :3] = np.clip(np.round(nrm * 127), -127, 127)
        t0 = np.clip(np.round(uv0 * 65535), 0, 65535).astype(np.uint16)
        t1 = np.clip(np.round(uv1 * 65535), 0, 65535).astype(np.uint16)
        assert idx.max() < 65536
        ii = idx.astype(np.uint16).reshape(-1, 1)
        chunks_before = len(chunks)
        ai = add(ii, 5123, 'SCALAR', 34963)
        # positions are stored as VEC3 inside a 4-component (8 byte) stride
        ap = add(q, 5123, 'VEC3', 34962, minmax=False)
        out['accessors'][ap]['min'] = q[:, :3].min(0).tolist()
        out['accessors'][ap]['max'] = q[:, :3].max(0).tolist()
        an = add(n8, 5120, 'VEC3', 34962, normalized=True)
        a0 = add(t0, 5123, 'VEC2', 34962, normalized=True)
        a1 = add(t1, 5123, 'VEC2', 34962, normalized=True)
        out['meshes'].append({'name': 'moon_%d' % k, 'primitives': [{
            'attributes': {'POSITION': ap, 'NORMAL': an, 'TEXCOORD_0': a0, 'TEXCOORD_1': a1},
            'indices': ai, 'material': 0}]})
        out['nodes'].append({'name': 'moon_%d' % k, 'mesh': k,
                             'translation': lo.tolist(), 'scale': [scale] * 3})
        out['nodes'][0]['children'].append(len(out['nodes']) - 1)

    # textures: 0 colour, 1 roughness/metal, 2 normal
    specs = [(0, 4096, 80), (1, 1024, 80), (2, 4096, 88)]
    out['images'], out['textures'] = [], []
    for ti, size, qual in specs:
        src_img = j['images'][j['textures'][ti]['source']]
        chunks.append(to_webp(view_bytes(j, bin_, src_img['bufferView']), size, qual))
        out['bufferViews'].append({'buffer': 0, 'byteOffset': 0, 'byteLength': 0})
        out['images'].append({'mimeType': 'image/webp', 'bufferView': len(out['bufferViews']) - 1})
        out['textures'].append({'sampler': 0, 'extensions': {'EXT_texture_webp': {'source': len(out['images']) - 1}}})
        print('   texture %d -> %.2f MB' % (ti, len(chunks[-1]) / 1e6))
    out['materials'] = [{'name': 'MoonSurface',
                         'normalTexture': {'index': 2, 'texCoord': 1},
                         'pbrMetallicRoughness': {'baseColorTexture': {'index': 0},
                                                  'metallicRoughnessTexture': {'index': 1},
                                                  'metallicFactor': 0.0}}]
    write_glb(dst, out, chunks)


# ---------- race track: fix inside-out faces, rebuild the road with clean UVs, export rails ----------
def build_track(src, dst_glb, dst_json):
    from collections import defaultdict
    j, bin_ = read_glb(src)
    meshes = {}

    def rec(n, M):
        nd = j['nodes'][n]
        W = M @ node_matrix(nd)
        if 'mesh' in nd:
            pr = j['meshes'][nd['mesh']]['primitives'][0]
            p = accessor(j, bin_, pr['attributes']['POSITION']).astype(np.float64) @ W[:3, :3].T + W[:3, 3]
            nr = accessor(j, bin_, pr['attributes']['NORMAL']).astype(np.float64) @ W[:3, :3].T
            meshes[nd['mesh']] = (p, nr, accessor(j, bin_, pr['indices']).reshape(-1, 3).astype(np.int64))
        for c in nd.get('children', []):
            rec(c, W)

    for r in j['scenes'][0]['nodes']:
        rec(r, np.eye(4))

    # mesh 0 = deck incl. road top, 1 = red kerbs, 2 = white kerbs, 3 = side walls, 4-6 = a placeholder car
    car = np.concatenate([meshes[k][0] for k in (4, 5, 6)])
    car_pos = (car.min(0) + car.max(0)) / 2

    p, nr, idx = meshes[0]
    key = np.round(p * 100).astype(np.int64)
    uq, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    wp = uq / 100.0
    t = inv[idx]
    fn = np.cross(wp[t[:, 1]] - wp[t[:, 0]], wp[t[:, 2]] - wp[t[:, 0]])
    fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
    # the model is inside-out: the road's top faces have normals pointing DOWN
    is_top = fn[:, 1] < -0.7
    top = t[is_top]
    E = defaultdict(int)
    for tri in top:
        for i in range(3):
            E[tuple(sorted((tri[i], tri[(i + 1) % 3])))] += 1
    adj = defaultdict(list)
    for (u, v), c in E.items():
        if c == 1:
            adj[u].append(v); adj[v].append(u)
    loops, seen = [], set()
    for s in list(adj):
        if s in seen:
            continue
        loop = [s]; seen.add(s); cur = s
        while True:
            nx = [v for v in adj[cur] if v not in seen]
            if not nx:
                break
            cur = nx[0]; seen.add(cur); loop.append(cur)
        loops.append(loop)
    assert len(loops) == 2 and len(loops[0]) == len(loops[1]), [len(l) for l in loops]
    A, B = loops
    N = len(A)
    inB = {v: k for k, v in enumerate(B)}
    nb = defaultdict(set)
    for (u, v) in E:
        nb[u].add(v); nb[v].add(u)
    partner = []
    for a in A:
        cand = [v for v in nb[a] if v in inB]
        partner.append(min(cand, key=lambda v: np.linalg.norm(wp[v] - wp[a])))
    Ap = wp[A]; Bp = wp[partner]
    mid = (Ap + Bp) / 2
    # start at the placeholder car
    s0 = int(np.argmin(np.linalg.norm(mid[:, [0, 2]] - car_pos[[0, 2]], axis=1)))
    Ap = np.roll(Ap, -s0, axis=0); Bp = np.roll(Bp, -s0, axis=0); mid = np.roll(mid, -s0, axis=0)
    # drive in the direction that gives the longer straight after the start line
    def straight_ahead(m):
        d0 = m[3] - m[0]; d0 = d0 / np.linalg.norm(d0)
        for i in range(1, len(m) - 3):
            d = m[i + 3] - m[i]; d = d / np.linalg.norm(d)
            if np.dot(d, d0) < 0.94:
                return i
        return len(m)
    rev = np.roll(mid[::-1], 1, axis=0)
    if straight_ahead(rev) > straight_ahead(mid):
        Ap = np.roll(Ap[::-1], 1, axis=0); Bp = np.roll(Bp[::-1], 1, axis=0); mid = rev
    # which rail is on the driver's left?
    fwd = mid[1] - mid[0]
    left_dir = np.array([fwd[2], 0, -fwd[0]])
    if np.dot(Ap[0] - mid[0], left_dir) > 0:
        Lr, Rr = Ap, Bp
    else:
        Lr, Rr = Bp, Ap
    seg = np.linalg.norm(np.roll(mid, -1, axis=0) - mid, axis=1)
    dist = np.concatenate([[0], np.cumsum(seg)])
    length = float(dist[-1])
    width = np.linalg.norm(Lr - Rr, axis=1)
    print('  track: %d sections, %.0f m long, width %.2f-%.2f m, start at' % (N, length, width.min(), width.max()), mid[0].round(1))

    def flipped(mesh_p, mesh_n, mesh_i):
        return mesh_p.astype(np.float32), (-mesh_n).astype(np.float32), mesh_i[:, ::-1].copy()

    # road: rebuilt from the two rails, u across (0 left .. 1 right), v = metres along the lap
    Lc = np.concatenate([Lr, Lr[:1]]); Rc = np.concatenate([Rr, Rr[:1]])
    rp = np.empty((2 * (N + 1), 3)); rp[0::2] = Lc; rp[1::2] = Rc
    ruv = np.empty((2 * (N + 1), 2)); ruv[0::2, 0] = 0; ruv[1::2, 0] = 1; ruv[0::2, 1] = dist; ruv[1::2, 1] = dist
    ri = []
    for i in range(N):
        l0, r0, l1, r1 = 2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 3
        ri += [[l0, l1, r0], [r0, l1, r1]]
    ri = np.array(ri)
    fnr = np.cross(rp[ri[:, 1]] - rp[ri[:, 0]], rp[ri[:, 2]] - rp[ri[:, 0]])
    if fnr[:, 1].mean() < 0:
        ri = ri[:, ::-1].copy(); fnr = -fnr
    rn = np.zeros_like(rp)
    for k in range(3):
        np.add.at(rn, ri[:, k], fnr)
    rn[0] += rn[2 * N]; rn[1] += rn[2 * N + 1]; rn[2 * N] = rn[0]; rn[2 * N + 1] = rn[1]
    rn /= np.linalg.norm(rn, axis=1, keepdims=True)

    # deck: everything in mesh 0 that is not the road top, plus the side walls (mesh 3)
    keep = idx[~is_top]
    dp, dn, di = flipped(p, nr, keep)
    wp3, wn3, wi3 = flipped(*meshes[3])
    deck_p = np.concatenate([dp, wp3]); deck_n = np.concatenate([dn, wn3]); deck_i = np.concatenate([di, wi3 + len(dp)])
    used, remap = np.unique(deck_i, return_inverse=True)
    deck_p, deck_n, deck_i = deck_p[used], deck_n[used], remap.reshape(-1, 3)

    parts = [('road', rp.astype(np.float32), rn.astype(np.float32), ri, ruv.astype(np.float32)),
             ('deck', deck_p, deck_n, deck_i, None)]
    for name, k in (('kerb_red', 1), ('kerb_white', 2)):
        kp, kn, ki = flipped(*meshes[k])
        parts.append((name, kp, kn, ki, None))

    out = {'asset': {'version': '2.0', 'generator': 'moon-racer build_assets.py'}, 'scene': 0,
           'scenes': [{'nodes': list(range(len(parts)))}], 'nodes': [], 'meshes': [], 'accessors': [],
           'bufferViews': [], 'materials': []}
    chunks = []

    def add(arr, ctype, typ, target, minmax=False):
        chunks.append(np.ascontiguousarray(arr).tobytes())
        out['bufferViews'].append({'buffer': 0, 'byteOffset': 0, 'byteLength': 0, 'target': target})
        a = {'bufferView': len(out['bufferViews']) - 1, 'componentType': ctype, 'count': len(arr), 'type': typ}
        if minmax:
            a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        out['accessors'].append(a)
        return len(out['accessors']) - 1

    for m, (name, pp, nn, ii, uv) in enumerate(parts):
        attrs = {'POSITION': add(pp, 5126, 'VEC3', 34962, True), 'NORMAL': add(nn, 5126, 'VEC3', 34962)}
        if uv is not None:
            attrs['TEXCOORD_0'] = add(uv, 5126, 'VEC2', 34962)
        flat = ii.reshape(-1, 1)
        ai = add(flat.astype(np.uint16), 5123, 'SCALAR', 34963) if flat.max() < 65536 else add(flat.astype(np.uint32), 5125, 'SCALAR', 34963)
        out['materials'].append({'name': name})
        out['meshes'].append({'name': name, 'primitives': [{'attributes': attrs, 'indices': ai, 'material': m}]})
        out['nodes'].append({'name': name, 'mesh': m})
    write_glb(dst_glb, out, chunks)

    os.makedirs(os.path.dirname(dst_json), exist_ok=True)
    r2 = lambda a: [[round(float(v), 2) for v in row] for row in a]
    with open(dst_json, 'w') as f:
        json.dump({'length': round(length, 1), 'sections': N, 'left': r2(Lr), 'right': r2(Rr),
                   'dist': [round(float(d), 2) for d in dist[:-1]]}, f, separators=(',', ':'))
    print('  wrote track.json  %.2f MB' % (os.path.getsize(dst_json) / 1e6))


# ---------- flat moon map: colour grade + tile pyramid ----------
def grade(a):
    x = np.clip((a - 0.27) / (0.98 - 0.27), 0, 1) ** 1.5
    x = x * np.array([0.97, 1.0, 1.04])
    return np.clip(x * 0.93 + 0.012, 0, 1)


def build_map(src_tif, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    tmp = os.path.join(tempfile.mkdtemp(), 'map8k.jpg')
    subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '100', src_tif, '--out', tmp],
                   check=True, stdout=subprocess.DEVNULL)
    im = Image.open(tmp)
    a = np.asarray(im).astype(np.float32) / 255
    full = Image.fromarray((grade(a) * 255 + 0.5).astype(np.uint8))
    W, H = full.size
    total = 0
    base = full.resize((2048, 1024), Image.LANCZOS)
    base.save(os.path.join(out_dir, 'base.webp'), 'WEBP', quality=78, method=6)
    total += os.path.getsize(os.path.join(out_dir, 'base.webp'))
    T = 1024
    for z, w in ((1, 4096), (2, 8192)):
        lvl = full if w == W else full.resize((w, w // 2), Image.LANCZOS)
        for ty in range(lvl.size[1] // T):
            for tx in range(lvl.size[0] // T):
                p = os.path.join(out_dir, '%d_%d_%d.webp' % (z, tx, ty))
                lvl.crop((tx * T, ty * T, tx * T + T, ty * T + T)).save(p, 'WEBP', quality=80, method=6)
                total += os.path.getsize(p)
    print('  map tiles: %.1f MB in total' % (total / 1e6))


if __name__ == '__main__':
    np.seterr(all='ignore')  # numpy on Apple Silicon prints harmless matmul warnings
    only = sys.argv[2:]
    m = os.path.join(OUT, 'models')
    os.makedirs(m, exist_ok=True)
    if only == ['thruster']:
        recompress_textures(os.path.join(RAW, 'biii-5__military_thruster.glb'), os.path.join(m, 'thruster.glb'), 1024, 82, {'wing_top': wipe_pod_number})
        sys.exit()
    if only == ['track']:
        build_track(os.path.join(RAW, 'race_track_-_c_.001_-_3.3km.glb'), os.path.join(m, 'track.glb'), os.path.join(OUT, 'data', 'track.json'))
        sys.exit()
    print('map');      build_map(os.path.join(RAW, 'lroc_color_16bit_srgb_8k.tif'), os.path.join(OUT, 'map'))
    print('moon');     build_moon(os.path.join(RAW, 'moon_surface.glb'), os.path.join(m, 'moon-surface.glb'))
    print('thruster'); recompress_textures(os.path.join(RAW, 'biii-5__military_thruster.glb'), os.path.join(m, 'thruster.glb'), 1024, 82, {'wing_top': wipe_pod_number})
    print('track');    build_track(os.path.join(RAW, 'race_track_-_c_.001_-_3.3km.glb'), os.path.join(m, 'track.glb'), os.path.join(OUT, 'data', 'track.json'))
    print('cars (copied as they are)')
    shutil.copyfile(os.path.join(RAW, '2013_ferrari_la_ferrari.glb'), os.path.join(m, 'car-laferrari.glb'))
    shutil.copyfile(os.path.join(RAW, 'byd_u9 copy.glb'), os.path.join(m, 'car-byd-u9.glb'))
    for f in sorted(os.listdir(m)):
        print('  %-22s %.2f MB' % (f, os.path.getsize(os.path.join(m, f)) / 1e6))
