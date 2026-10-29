/* Relief Studio – whole-relief tools, frame assembly and production helpers (no DOM).
   Inner relief Z: Float32Array (w*h), mm above pocket floor (0..depth).
   Plate field P: Float32Array (pw*ph), mm above plate bottom (0..T). */
(function (root) {
  'use strict';
  const O = {};
  const R = () => (root.Relief || (typeof require !== 'undefined' ? require('./relief.js') : null));

  // ---------- curves (monotone cubic through 5 points at x=0,.25,.5,.75,1) ----------
  O.curveLUT = function (ys) {
    const n = ys.length, xs = ys.map((_, i) => i / (n - 1)), d = [], m = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b; if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } }
    const lut = new Float32Array(1025);
    for (let k = 0; k <= 1024; k++) { const x = k / 1024, i = Math.min(n - 2, Math.floor(x * (n - 1))), h = xs[i + 1] - xs[i], t = (x - xs[i]) / h;
      const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
      lut[k] = Math.min(1, Math.max(0, h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1])); }
    return lut;
  };
  O.isIdentityCurve = ys => ys.every((y, i) => Math.abs(y - i / (ys.length - 1)) < 1e-3);

  // ---------- procedural textures (value 0..1, mean ~0.5) ----------
  function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v; }
  function fbm(x, y, o) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); f *= 2; a *= 0.5; } return s / (1 - Math.pow(0.5, o)); }
  O.TEXTURES = { wood: 'ลายไม้', hammered: 'ค้อนตอก', lines: 'เส้นขนาน', dots: 'จุด', cross: 'ตาราง', sand: 'ทราย', scales: 'เกล็ด' };
  O.texture = function (type, w, h, res, scaleMm, angleDeg) {
    const out = new Float32Array(w * h), s = Math.max(0.3, scaleMm), a = angleDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const X = i * res, Y = j * res, u = (X * ca + Y * sa) / s, v = (-X * sa + Y * ca) / s; let t = 0;
      switch (type) {
        case 'wood': { const n = fbm(u * 0.15, v * 1.2, 4); t = 0.5 + 0.5 * Math.sin((v + 4 * n) * Math.PI * 2 * 0.5) * 0.7 + 0.3 * (n - 0.5); break; }
        case 'hammered': { const fx = u * 0.5, fy = v * 0.5, xi = Math.floor(fx), yi = Math.floor(fy); let dm = 9;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const px = xi + dx + hash(xi + dx, yi + dy), py = yi + dy + hash(yi + dy, xi + dx + 7); dm = Math.min(dm, Math.hypot(fx - px, fy - py)); }
          t = Math.min(1, dm * 1.4); break; }
        case 'lines': t = 0.5 + 0.5 * Math.cos(v * Math.PI * 2); break;
        case 'dots': { const fu = u - Math.round(u), fv = v - Math.round(v); t = Math.max(0, 1 - Math.hypot(fu, fv) * 2.4); break; }
        case 'cross': t = 0.5 + 0.25 * Math.cos(u * Math.PI * 2) + 0.25 * Math.cos(v * Math.PI * 2); break;
        case 'sand': t = fbm(u * 2, v * 2, 3); break;
        case 'scales': { const row = Math.floor(v), off = (row & 1) * 0.5, fu = u + off - Math.floor(u + off) - 0.5, fv = v - row; t = Math.max(0, Math.min(1, 1 - Math.hypot(fu * 1.2, fv - 0.15) * 1.3)); break; }
      }
      out[j * w + i] = t;
    }
    return out;
  };

  // ---------- whole-relief operations on inner Z ----------
  /* ops: { curve:[5], fade:{amt(0..1), dir:'top'|'bottom'|'left'|'right'|'center'|'edge'}, tilt:{x(mm), y(mm)},
            dome:{amt(mm), type:'dome'|'cylX'|'cylY'|'saddle'},
            tex:{type, amt(mm), scale(mm), angle, where:'all'|'bg'|'mask', thr(mm)},
            layers:[{data:Float32(w*h 0..1), mode:'add'|'sub'|'max'|'min'|'replace', height(mm), invert}],
            flattenBg:{on, mask:Uint8 (AI cutout) , level(mm)} } */
  O.applyOps = function (Z, w, h, res, depth, ops, maskTex) {
    const N = w * h, out = Float32Array.from(Z);
    if (!ops) return out;
    // layers
    for (const L of ops.layers || []) {
      if (!L.data || L.data.length !== N || L.enabled === false) continue;
      for (let i = 0; i < N; i++) { let v = L.data[i]; if (L.invert) v = 1 - v; v *= L.height;
        switch (L.mode) { case 'add': out[i] += v; break; case 'sub': out[i] -= v; break; case 'max': out[i] = Math.max(out[i], v); break;
          case 'min': out[i] = Math.min(out[i], v); break; case 'replace': if (L.data[i] > 0.02) out[i] = v; break; } }
    }
    // AI background flatten
    if (ops.flattenBg && ops.flattenBg.on && ops.flattenBg.mask) {
      const m = ops.flattenBg.mask, f = R().gauss(Float32Array.from(m, v => v ? 1 : 0), w, h, 0.6 / res), lv = ops.flattenBg.level || 0;
      for (let i = 0; i < N; i++) out[i] = lv + (out[i] - lv) * Math.min(1, f[i] * 1.6) ;
    }
    // curves (on normalised height)
    if (ops.curve && !O.isIdentityCurve(ops.curve)) { const lut = O.curveLUT(ops.curve);
      for (let i = 0; i < N; i++) { const t = Math.min(1, Math.max(0, out[i] / depth)); out[i] = lut[Math.round(t * 1024)] * depth; } }
    // dome / cylinder / saddle (adds mm at centre, 0 at edges)
    if (ops.dome && ops.dome.amt) { const A = ops.dome.amt, ty = ops.dome.type || 'dome';
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const x = (i / (w - 1)) * 2 - 1, y = (j / (h - 1)) * 2 - 1;
        const cx = 1 - x * x, cy = 1 - y * y; let v = ty === 'cylX' ? cx : ty === 'cylY' ? cy : ty === 'saddle' ? (cx - cy) * 0.5 : cx * cy;
        out[j * w + i] += A * v; } }
    // tilt (mm rise across width / height)
    if (ops.tilt && (ops.tilt.x || ops.tilt.y)) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++)
      out[j * w + i] += (ops.tilt.x || 0) * (i / (w - 1) - 0.5) + (ops.tilt.y || 0) * (0.5 - j / (h - 1));
    // texture
    if (ops.tex && ops.tex.amt && ops.tex.type) { const T = ops.tex, tx = O.texture(T.type, w, h, res, T.scale, T.angle || 0);
      for (let i = 0; i < N; i++) { let wgt = 1;
        if (T.where === 'bg') wgt = Math.max(0, Math.min(1, (T.thr - out[i]) / Math.max(0.5, T.thr * 0.3)));
        else if (T.where === 'mask') wgt = maskTex ? maskTex[i] : 0;
        out[i] += (tx[i] - 0.5) * T.amt * wgt; } }
    // fade (multiplies height towards one side)
    if (ops.fade && ops.fade.amt) { const a = ops.fade.amt, d = ops.fade.dir;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const x = i / (w - 1), y = j / (h - 1); let t;
        switch (d) { case 'top': t = y; break; case 'bottom': t = 1 - y; break; case 'left': t = x; break; case 'right': t = 1 - x; break;
          case 'center': t = Math.min(1, Math.hypot(x - 0.5, y - 0.5) * 2); break; default: t = 1 - Math.min(1, Math.hypot(x - 0.5, y - 0.5) * 2); }
        const k = j * w + i; out[k] *= 1 - a * (1 - t); } }
    for (let i = 0; i < N; i++) out[i] = Math.min(Math.max(out[i], 0), depth);
    return out;
  };

  // ---------- frame shapes, inner edge and molding → plate field ----------
  O.SHAPES = { rect: 'สี่เหลี่ยม', rounded: 'มุมโค้ง', ellipse: 'วงรี', arch: 'โค้งบน', gothic: 'โค้งแหลมบน', octagon: 'แปดเหลี่ยม' };
  O.MOLDINGS = { flat: 'เรียบ', bevel: 'ลาดเอียง', bead: 'บัวลูกแก้ว', cove: 'บัวคว่ำ (เว้า)', ogee: 'บัวโอจี', step: 'ขั้นบันได' };
  O.EDGES = { vertical: 'ตั้งฉาก', chamfer: 'ลบมุมเอียง', round: 'มนนูน', cove: 'มนเว้า' };
  // signed inside-test for the inner shape, coordinates in mm relative to inner rect (0..Wi, 0..Hi, y down)
  function shapeMask(wi, hi, res, f) {
    const m = new Uint8Array(wi * hi), Wm = (wi - 1) * res, Hm = (hi - 1) * res, r = Math.min(f.radius || 0, Wm / 2, Hm / 2);
    for (let j = 0; j < hi; j++) for (let i = 0; i < wi; i++) { const x = i * res, y = j * res; let ins = true;
      switch (f.shape) {
        case 'rounded': { const dx = Math.max(r - x, x - (Wm - r), 0), dy = Math.max(r - y, y - (Hm - r), 0); ins = dx * dx + dy * dy <= r * r + 1e-6; break; }
        case 'ellipse': { const u = (x - Wm / 2) / (Wm / 2), v = (y - Hm / 2) / (Hm / 2); ins = u * u + v * v <= 1.0001; break; }
        case 'arch': { const R0 = Wm / 2; if (y < R0) ins = Math.hypot(x - Wm / 2, y - R0) <= R0 + 1e-6; break; }
        case 'gothic': { const R0 = Wm * 0.85, cy = Wm * 0.85 * 0.85; if (y < cy) ins = Math.hypot(x - (Wm - R0), y - cy) <= R0 && Math.hypot(x - R0, y - cy) <= R0; break; }
        case 'octagon': { const c = Math.min(Wm, Hm) * 0.22; ins = x + y >= c && (Wm - x) + y >= c && x + (Hm - y) >= c && (Wm - x) + (Hm - y) >= c; break; }
      }
      m[j * wi + i] = ins ? 1 : 0; }
    return m;
  }
  O.shapeMask = shapeMask;
  /* f: { F(mm frame width), T, depth, shape, radius, molding, moldDepth, edge, edgeW, outerRound } */
  O.assemble = function (Z, w, h, res, f) {
    const Rl = R(), fo = Math.max(0, Math.round((f.F || 0) / res)), pw = w + 2 * fo, ph = h + 2 * fo, N = pw * ph;
    const T = f.T, base = Math.max(0.5, T - f.depth), P = new Float32Array(N), wall = new Float32Array(N);
    const inMask = shapeMask(w, h, res, f);
    const full = new Uint8Array(N); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) full[(j + fo) * pw + i + fo] = inMask[j * w + i];
    const dIn = Rl.edt(full, pw, ph);                   // for frame pixels: distance (px) to nearest inside pixel
    const dOut = Rl.edt(full.map(v => 1 - v), pw, ph);  // for inside pixels: distance to nearest frame pixel
    const md = Math.min(f.moldDepth || 0, T - base - 0.2), ew = (f.edge && f.edge !== 'vertical') ? Math.max(0, f.edgeW || 0) : 0;
    let band = 1e9; // frame band width (mm) measured from inner shape outward to nearest plate edge
    for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) {
      const k = j * pw + i;
      if (full[k]) {
        let z = base + Z[(j - fo) * w + (i - fo)];
        if (ew > 0) { const d = dOut[k] * res; if (d < ew) { const t = d / ew;
          const fr = f.edge === 'chamfer' ? t : f.edge === 'round' ? 1 - Math.sqrt(Math.max(0, 1 - t * t)) : Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
          const wz = T - md - (T - md - base) * fr; wall[k] = wz; z = Math.max(z, wz); } }
        P[k] = z;
      } else {
        // frame: u = 0 at inner shape boundary .. 1 at plate outer edge
        const din = dIn[k] * res, mw = Math.max(1, f.moldW || f.F || 1), u = Math.min(1, din / mw);   // molding follows the inner shape
        let drop = 0;
        switch (f.molding) {
          case 'bevel': drop = md * (1 - u); break;
          case 'bead': { const c = 0.5, rr = 0.32; const q = (u - c) / rr; drop = md * (Math.abs(q) < 1 ? 1 - Math.sqrt(1 - q * q) : 1); break; }
          case 'cove': drop = md * Math.sqrt(Math.max(0, 1 - u * u)); break;
          case 'ogee': drop = md * (0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, u * 1.15))); break;
          case 'step': drop = u < 0.35 ? md : u < 0.65 ? md * 0.5 : 0; break;
        }
        P[k] = T - drop;
      }
      if (f.outerRound > 0) { const de = Math.min(i, j, pw - 1 - i, ph - 1 - j) * res, r = f.outerRound;
        if (de < r) P[k] = Math.min(P[k], T - r + Math.sqrt(Math.max(0, r * r - (r - de) * (r - de)))); }
    }
    // soften pixel stepping of the frame profile (frame pixels only)
    const sm = Rl.gauss(P, pw, ph, 0.6 / res);
    for (let k = 0; k < N; k++) if (!full[k]) P[k] = sm[k] > P[k] - 0.6 && sm[k] < P[k] + 0.6 ? sm[k] : P[k];
    return { P, pw, ph, fo, base, inner: full, wall, T };
  };

  // ---------- CNC: ball-nose cutter simulation (grayscale opening with sphere) ----------
  O.ballCut = function (Zin, w, h, res, radius) {
    const r = radius / res, ri = Math.ceil(r), offs = [];
    for (let dy = -ri; dy <= ri; dy++) for (let dx = -ri; dx <= ri; dx++) { const d2 = dx * dx + dy * dy; if (d2 <= r * r) offs.push(dx, dy, (r - Math.sqrt(Math.max(0, r * r - d2))) * res); }
    const n = offs.length / 3, tip = new Float32Array(w * h), out = new Float32Array(w * h);
    // lowest tip height that does not gouge: tip(p) = max_u ( Z(p+u) - b(u) )
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let m = -Infinity;
      for (let k = 0; k < n; k++) { const x = i + offs[3 * k], y = j + offs[3 * k + 1]; if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const v = Zin[y * w + x] - offs[3 * k + 2]; if (v > m) m = v; }
      tip[j * w + i] = m; }
    // cut surface: s(q) = min_u ( tip(q-u) + b(u) )
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let m = Infinity;
      for (let k = 0; k < n; k++) { const x = i - offs[3 * k], y = j - offs[3 * k + 1]; if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const v = tip[y * w + x] + offs[3 * k + 2]; if (v < m) m = v; }
      out[j * w + i] = m; }
    return out;
  };
  // machining time estimate (minutes). P: plate field; stock top = T
  O.estimateTime = function (P, pw, ph, res, T, c) {
    // c: { finDia, finStep(%), feed(mm/min), plunge, roughDia, roughStep(%), stepDown(mm) }
    const Wm = (pw - 1) * res, Hm = (ph - 1) * res;
    let vol = 0, minZ = T; for (let i = 0; i < P.length; i++) { vol += Math.max(0, T - P[i]); if (P[i] < minZ) minZ = P[i]; }
    vol *= res * res;                                                    // mm^3
    const finStep = Math.max(0.01, c.finDia * c.finStep / 100), finLen = (Hm / finStep + 1) * Wm;
    const roughStep = Math.max(0.1, c.roughDia * c.roughStep / 100), layers = Math.max(1, Math.ceil((T - minZ) / Math.max(0.1, c.stepDown)));
    const roughArea = vol / Math.max(0.1, (T - minZ));                   // mean footprint area per layer
    const roughLen = layers * roughArea / roughStep;
    const fin = finLen / c.feed * 1.15, rough = roughLen / c.feed * 1.25;
    return { volume_cm3: vol / 1000, finishMin: fin, roughMin: rough, totalMin: fin + rough, finishLenM: finLen / 1000, roughLenM: roughLen / 1000, layers };
  };
  // split plate field into pieces along the long axis
  O.tiles = function (pw, ph, res, maxLen, overlap) {
    const long = ph >= pw ? 'y' : 'x', L = (long === 'y' ? ph : pw), step = Math.max(2, Math.floor(maxLen / res)), ov = Math.round((overlap || 0) / res), out = [];
    for (let s = 0; s < L - 1; s += step) { const a = Math.max(0, s - (s ? ov : 0)), b = Math.min(L - 1, s + step); out.push(long === 'y' ? { x0: 0, x1: pw - 1, y0: a, y1: b } : { x0: a, x1: b, y0: 0, y1: ph - 1 }); if (b >= L - 1) break; }
    return out;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = O; else root.ReliefOps = O;
})(typeof self !== 'undefined' ? self : this);
