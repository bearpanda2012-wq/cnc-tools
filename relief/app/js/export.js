/* Exporters: closed binary STL (with optional frame) and 16-bit grayscale PNG heightmap. */
export function buildSTL(Z, w, h, res, o) {
  // o: { thickness, depth, frame (mm, 0 = none), mirror }
  const T = o.thickness, base = Math.max(0.5, T - o.depth), F = o.frame || 0;
  const Wm = (w - 1) * res, Hm = (h - 1) * res, PW = Wm + 2 * F, PH = Hm + 2 * F;
  const L = 2 * (w - 1) + 2 * (h - 1);
  const ntri = 2 * (w - 1) * (h - 1) + L * (F > 0 ? 7 : 3);
  const buf = new ArrayBuffer(84 + ntri * 50), dv = new DataView(buf);
  const hdr = 'Relief Studio STL ' + PW.toFixed(1) + 'x' + PH.toFixed(1) + 'x' + T + 'mm';
  for (let i = 0; i < 80; i++) dv.setUint8(i, i < hdr.length ? hdr.charCodeAt(i) : 32);
  dv.setUint32(80, ntri, true);
  let off = 84;
  const zAt = (i, j) => base + Z[j * w + (o.mirror ? w - 1 - i : i)];
  const X = i => F + i * res, Y = j => F + Hm - j * res;          // row 0 = top of image
  function tri(ax, ay, az, bx, by, bz, cx, cy, cz) {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(off, nx / l, true); dv.setFloat32(off + 4, ny / l, true); dv.setFloat32(off + 8, nz / l, true);
    dv.setFloat32(off + 12, ax, true); dv.setFloat32(off + 16, ay, true); dv.setFloat32(off + 20, az, true);
    dv.setFloat32(off + 24, bx, true); dv.setFloat32(off + 28, by, true); dv.setFloat32(off + 32, bz, true);
    dv.setFloat32(off + 36, cx, true); dv.setFloat32(off + 40, cy, true); dv.setFloat32(off + 44, cz, true);
    dv.setUint16(off + 48, 0, true); off += 50;
  }
  // relief surface (counter-clockwise seen from +Z)
  for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
    const x0 = X(i), x1 = X(i + 1), y0 = Y(j), y1 = Y(j + 1);
    const a = zAt(i, j), b = zAt(i + 1, j), c = zAt(i, j + 1), d = zAt(i + 1, j + 1);
    tri(x0, y1, c, x1, y1, d, x1, y0, b); tri(x0, y1, c, x1, y0, b, x0, y0, a);
  }
  // boundary loop of the relief, CCW (bottom row left→right, right col bottom→top, top row right→left, left col top→bottom)
  const loop = [];
  for (let i = 0; i < w - 1; i++) loop.push([i, h - 1]);
  for (let j = h - 1; j > 0; j--) loop.push([w - 1, j]);
  for (let i = w - 1; i > 0; i--) loop.push([i, 0]);
  for (let j = 0; j < h - 1; j++) loop.push([0, j]);
  const outer = [];
  if (F > 0) {
    const nx = w - 1, ny = h - 1;
    for (let i = 0; i < nx; i++) outer.push([i * PW / nx, 0]);
    for (let j = 0; j < ny; j++) outer.push([PW, j * PH / ny]);
    for (let i = 0; i < nx; i++) outer.push([PW - i * PW / nx, PH]);
    for (let j = 0; j < ny; j++) outer.push([0, PH - j * PH / ny]);
  }
  const cx = PW / 2, cy = PH / 2;
  for (let k = 0; k < L; k++) {
    const n = (k + 1) % L, [i0, j0] = loop[k], [i1, j1] = loop[n];
    const ax = X(i0), ay = Y(j0), az = zAt(i0, j0), bx = X(i1), by = Y(j1), bz = zAt(i1, j1);
    if (F > 0) {
      const [ox0, oy0] = outer[k], [ox1, oy1] = outer[n];
      // inner wall: relief edge up to frame top (normal points into the pocket)
      tri(ax, ay, az, ax, ay, T, bx, by, T); tri(ax, ay, az, bx, by, T, bx, by, bz);
      // frame top (normal +Z)
      tri(ox0, oy0, T, ox1, oy1, T, bx, by, T); tri(ox0, oy0, T, bx, by, T, ax, ay, T);
      // outer wall (normal outward)
      tri(ox0, oy0, T, ox0, oy0, 0, ox1, oy1, 0); tri(ox0, oy0, T, ox1, oy1, 0, ox1, oy1, T);
      // bottom fan (normal -Z)
      tri(ox1, oy1, 0, ox0, oy0, 0, cx, cy, 0);
    } else {
      tri(ax, ay, az, ax, ay, 0, bx, by, 0); tri(ax, ay, az, bx, by, 0, bx, by, bz);
      tri(bx, by, 0, ax, ay, 0, cx, cy, 0);
    }
  }
  return fixWinding(buf, ntri);
}
// The walls above are written with a consistent loop orientation; flip all if the signed volume is negative.
function fixWinding(buf, ntri) {
  const dv = new DataView(buf); let vol = 0;
  for (let t = 0; t < ntri; t++) { const o = 84 + t * 50 + 12, p = [];
    for (let k = 0; k < 9; k++) p.push(dv.getFloat32(o + k * 4, true));
    vol += (p[0] * (p[4] * p[8] - p[5] * p[7]) - p[1] * (p[3] * p[8] - p[5] * p[6]) + p[2] * (p[3] * p[7] - p[4] * p[6])) / 6; }
  if (vol < 0) for (let t = 0; t < ntri; t++) { const o = 84 + t * 50;
    for (let k = 0; k < 3; k++) dv.setFloat32(o + k * 4, -dv.getFloat32(o + k * 4, true), true);
    for (let k = 0; k < 3; k++) { const a = o + 24 + k * 4, b = o + 36 + k * 4, va = dv.getFloat32(a, true); dv.setFloat32(a, dv.getFloat32(b, true), true); dv.setFloat32(b, va, true); } }
  return new Blob([buf], { type: 'model/stl' });
}

// ---- 16-bit grayscale PNG ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8); dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out;
}
export async function buildPNG16(Z, w, h, depth, mirror) {
  const raw = new Uint8Array(h * (1 + 2 * w));
  for (let j = 0; j < h; j++) { const o = j * (1 + 2 * w); raw[o] = 0;
    for (let i = 0; i < w; i++) { const v = Math.round(Math.min(Math.max(Z[j * w + (mirror ? w - 1 - i : i)] / depth, 0), 1) * 65535);
      raw[o + 1 + 2 * i] = v >> 8; raw[o + 2 + 2 * i] = v & 255; } }
  const cs = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
  const z = new Uint8Array(await new Response(cs).arrayBuffer());
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 16; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Blob([sig, chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))], { type: 'image/png' });
}

// ---- generic closed solid between a top and bottom heightfield (double-sided / cut-out figures) ----
// top/bot: Float32Array (w*h) absolute Z in mm; inc: Uint8Array of grid vertices that belong to the solid (null = all)
export function buildSolid(top, bot, w, h, res, inc, mirror) {
  const Hm = (h - 1) * res, X = i => i * res, Y = j => Hm - j * res;
  const col = i => mirror ? w - 1 - i : i;
  const q = new Uint8Array((w - 1) * (h - 1));
  for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
    const a = j * w + col(i), b = j * w + col(i + 1), c = (j + 1) * w + col(i), d = (j + 1) * w + col(i + 1);
    q[j * (w - 1) + i] = !inc || (inc[a] && inc[b] && inc[c] && inc[d]) ? 1 : 0;
  }
  const Q = (i, j) => (i < 0 || j < 0 || i >= w - 1 || j >= h - 1) ? 0 : q[j * (w - 1) + i];
  let ntri = 0;
  for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) if (Q(i, j)) {
    ntri += 4; if (!Q(i, j - 1)) ntri += 2; if (!Q(i, j + 1)) ntri += 2; if (!Q(i - 1, j)) ntri += 2; if (!Q(i + 1, j)) ntri += 2;
  }
  const buf = new ArrayBuffer(84 + ntri * 50), dv = new DataView(buf); let off = 84;
  const hdr = 'Relief Studio double-sided STL'; for (let i = 0; i < 80; i++) dv.setUint8(i, i < hdr.length ? hdr.charCodeAt(i) : 32);
  dv.setUint32(80, ntri, true);
  function tri(p, r, s) {
    const ux = r[0] - p[0], uy = r[1] - p[1], uz = r[2] - p[2], vx = s[0] - p[0], vy = s[1] - p[1], vz = s[2] - p[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(off, nx / l, true); dv.setFloat32(off + 4, ny / l, true); dv.setFloat32(off + 8, nz / l, true);
    let o = off + 12; for (const v of [p, r, s]) { dv.setFloat32(o, v[0], true); dv.setFloat32(o + 4, v[1], true); dv.setFloat32(o + 8, v[2], true); o += 12; }
    dv.setUint16(off + 48, 0, true); off += 50;
  }
  const T = (i, j) => [X(i), Y(j), top[j * w + col(i)]], B = (i, j) => [X(i), Y(j), bot[j * w + col(i)]];
  for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
    if (!Q(i, j)) continue;
    // top (+Z): corners in CCW from above: (i,j+1) (i+1,j+1) (i+1,j) (i,j)
    tri(T(i, j + 1), T(i + 1, j + 1), T(i + 1, j)); tri(T(i, j + 1), T(i + 1, j), T(i, j));
    // bottom (-Z): reversed
    tri(B(i, j + 1), B(i + 1, j), B(i + 1, j + 1)); tri(B(i, j + 1), B(i, j), B(i + 1, j));
    // side walls on exposed quad edges; edge listed CCW around the quad (seen from above) => outward normal
    const edges = [];
    if (!Q(i, j + 1)) edges.push([i, j + 1, i + 1, j + 1]);   // bottom edge (lower y), left->right
    if (!Q(i + 1, j)) edges.push([i + 1, j + 1, i + 1, j]);   // right edge, up
    if (!Q(i, j - 1)) edges.push([i + 1, j, i, j]);           // top edge, right->left
    if (!Q(i - 1, j)) edges.push([i, j, i, j + 1]);           // left edge, down
    for (const [ai, aj, bi, bj] of edges) {
      const at = T(ai, aj), bt = T(bi, bj), ab = B(ai, aj), bb = B(bi, bj);
      tri(at, ab, bb); tri(at, bb, bt);
    }
  }
  return new Blob([buf], { type: 'model/stl' });
}

// ---- OBJ (closed heightfield solid, ASCII) ----
export function buildOBJ(P, w, h, res, mirror) {
  const Hm = (h - 1) * res, parts = ['# Relief Studio OBJ\n'], col = i => mirror ? w - 1 - i : i;
  let buf = '';
  const flush = () => { parts.push(buf); buf = ''; };
  for (let j = 0; j < h; j++) { for (let i = 0; i < w; i++) buf += `v ${(i * res).toFixed(3)} ${(Hm - j * res).toFixed(3)} ${P[j * w + col(i)].toFixed(3)}\n`; if (buf.length > 4e6) flush(); }
  const nb = w * h;  // bottom corner vertices
  buf += `v 0 0 0\nv ${((w - 1) * res).toFixed(3)} 0 0\nv ${((w - 1) * res).toFixed(3)} ${Hm.toFixed(3)} 0\nv 0 ${Hm.toFixed(3)} 0\n`;
  const V = (i, j) => j * w + i + 1;
  for (let j = 0; j < h - 1; j++) { for (let i = 0; i < w - 1; i++) buf += `f ${V(i, j + 1)} ${V(i + 1, j + 1)} ${V(i + 1, j)} ${V(i, j)}\n`; if (buf.length > 4e6) flush(); }
  const b0 = nb + 1, b1 = nb + 2, b2 = nb + 3, b3 = nb + 4;
  // side walls as fans to the bottom corners
  for (let i = 0; i < w - 1; i++) buf += `f ${V(i, h - 1)} ${b0 + 0 * 0} ${V(i + 1, h - 1)}\n`;
  buf += `f ${V(w - 1, h - 1)} ${b0} ${b1}\n`;
  for (let j = h - 1; j > 0; j--) buf += `f ${V(w - 1, j)} ${b1} ${V(w - 1, j - 1)}\n`;
  buf += `f ${V(w - 1, 0)} ${b1} ${b2}\n`;
  for (let i = w - 1; i > 0; i--) buf += `f ${V(i, 0)} ${b2} ${V(i - 1, 0)}\n`;
  buf += `f ${V(0, 0)} ${b2} ${b3}\n`;
  for (let j = 0; j < h - 1; j++) buf += `f ${V(0, j)} ${b3} ${V(0, j + 1)}\n`;
  buf += `f ${V(0, h - 1)} ${b3} ${b0}\n`;
  buf += `f ${b0} ${b3} ${b2} ${b1}\n`;
  flush();
  return new Blob(parts, { type: 'text/plain' });
}

// ---- trial watermark: raised diagonal text added to a field ----
export function watermark(F, w, h, res, amt, maxZ) {
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff';
  const fs = Math.max(10, Math.round(18 / res)); g.font = `bold ${fs}px sans-serif`; g.textAlign = 'center';
  g.translate(w / 2, h / 2); g.rotate(-Math.PI / 6);
  const L = Math.hypot(w, h);
  for (let y = -L; y < L; y += fs * 4) for (let x = -L; x < L; x += fs * 14) g.fillText('RELIEF STUDIO · TRIAL', x + ((y / (fs * 4)) & 1) * fs * 7, y);
  const d = g.getImageData(0, 0, w, h).data, out = new Float32Array(F);
  for (let i = 0; i < w * h; i++) out[i] = Math.min(maxZ, out[i] + amt * d[i * 4] / 255);
  return out;
}
