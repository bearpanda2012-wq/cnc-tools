/* ReliefForge – core image→bas-relief algorithms (no DOM). Works in workers and Node.
   All rasters are Float32Array, row-major, (w,h). Units in mm unless noted. */
(function (root) {
  'use strict';
  const R = {};

  // ---------- basic raster ops ----------
  R.resize = function (src, w, h, W, H) {           // bilinear
    const out = new Float32Array(W * H);
    const sx = (w - 1) / Math.max(W - 1, 1), sy = (h - 1) / Math.max(H - 1, 1);
    for (let j = 0; j < H; j++) {
      const y = j * sy, y0 = Math.floor(y), y1 = Math.min(y0 + 1, h - 1), fy = y - y0;
      for (let i = 0; i < W; i++) {
        const x = i * sx, x0 = Math.floor(x), x1 = Math.min(x0 + 1, w - 1), fx = x - x0;
        const a = src[y0 * w + x0], b = src[y0 * w + x1], c = src[y1 * w + x0], d = src[y1 * w + x1];
        out[j * W + i] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      }
    }
    return out;
  };

  function boxPass(src, dst, w, h, r, horiz) {     // running box mean, clamp edges
    const n = 2 * r + 1, inv = 1 / n;
    if (horiz) {
      for (let j = 0; j < h; j++) {
        const o = j * w; let s = 0;
        for (let k = -r; k <= r; k++) s += src[o + Math.min(Math.max(k, 0), w - 1)];
        for (let i = 0; i < w; i++) {
          dst[o + i] = s * inv;
          s += src[o + Math.min(i + r + 1, w - 1)] - src[o + Math.max(i - r, 0)];
        }
      }
    } else {
      for (let i = 0; i < w; i++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += src[Math.min(Math.max(k, 0), h - 1) * w + i];
        for (let j = 0; j < h; j++) {
          dst[j * w + i] = s * inv;
          s += src[Math.min(j + r + 1, h - 1) * w + i] - src[Math.max(j - r, 0) * w + i];
        }
      }
    }
  }
  function gaussKernelPass(src, dst, w, h, sigma, horiz) {
    const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1); let s = 0;
    for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sigma * sigma)); s += k[i + r]; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    if (horiz) {
      for (let j = 0; j < h; j++) { const o = j * w;
        for (let i = 0; i < w; i++) { let a = 0;
          for (let t = -r; t <= r; t++) a += k[t + r] * src[o + Math.min(Math.max(i + t, 0), w - 1)];
          dst[o + i] = a; } }
    } else {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let a = 0;
        for (let t = -r; t <= r; t++) a += k[t + r] * src[Math.min(Math.max(j + t, 0), h - 1) * w + i];
        dst[j * w + i] = a; }
    }
  }
  // Gaussian blur, sigma in px. Exact kernel for small sigma, 3x box otherwise.
  R.gauss = function (src, w, h, sigma) {
    if (sigma <= 0.05) return Float32Array.from(src);
    const a = new Float32Array(w * h), b = new Float32Array(w * h);
    if (sigma < 3) { gaussKernelPass(src, a, w, h, sigma, true); gaussKernelPass(a, b, w, h, sigma, false); return b; }
    const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
    let cur = Float32Array.from(src);
    for (let p = 0; p < 3; p++) { boxPass(cur, a, w, h, r, true); boxPass(a, cur, w, h, r, false); }
    return cur;
  };

  // van Herk / Gil-Werman 1D min/max over window k (odd)
  function vhg1d(line, n, k, isMax, out) {
    const r = (k - 1) >> 1, g = new Float32Array(n + k), hh = new Float32Array(n + k);
    const pad = new Float32Array(n + 2 * r);
    for (let i = 0; i < n + 2 * r; i++) pad[i] = line[Math.min(Math.max(i - r, 0), n - 1)];
    const N = n + 2 * r, op = isMax ? Math.max : Math.min;
    for (let i = 0; i < N; i++) g[i] = (i % k === 0) ? pad[i] : op(g[i - 1], pad[i]);
    for (let i = N - 1; i >= 0; i--) hh[i] = (i === N - 1 || (i + 1) % k === 0) ? pad[i] : op(hh[i + 1], pad[i]);
    for (let i = 0; i < n; i++) out[i] = op(hh[i], g[i + 2 * r]);
  }
  R.rankFilter = function (src, w, h, k, isMax) {
    k = Math.max(1, k | 1);
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    const line = new Float32Array(Math.max(w, h)), res = new Float32Array(Math.max(w, h));
    for (let j = 0; j < h; j++) { for (let i = 0; i < w; i++) line[i] = src[j * w + i];
      vhg1d(line, w, k, isMax, res); for (let i = 0; i < w; i++) tmp[j * w + i] = res[i]; }
    for (let i = 0; i < w; i++) { for (let j = 0; j < h; j++) line[j] = tmp[j * w + i];
      vhg1d(line, h, k, isMax, res); for (let j = 0; j < h; j++) out[j * w + i] = res[j]; }
    return out;
  };
  R.minF = (s, w, h, k) => R.rankFilter(s, w, h, k, false);
  R.maxF = (s, w, h, k) => R.rankFilter(s, w, h, k, true);

  R.median3 = function (src, w, h) {
    const out = new Float32Array(w * h), v = new Float32Array(9);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) { const y = Math.min(Math.max(j + dy, 0), h - 1);
        for (let dx = -1; dx <= 1; dx++) { const x = Math.min(Math.max(i + dx, 0), w - 1); v[n++] = src[y * w + x]; } }
      v.sort(); out[j * w + i] = v[4];
    }
    return out;
  };

  R.percentile = function (a, p, mask) {           // approximate via sampling
    const n = a.length, m = Math.min(n, 400000), s = new Float32Array(m);
    let c = 0;
    for (let t = 0; t < m * 4 && c < m; t++) {
      const idx = Math.floor(Math.random() * n);
      if (!mask || mask[idx]) s[c++] = a[idx];
    }
    const arr = s.subarray(0, Math.max(c, 1)).sort();
    return arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p / 100 * (arr.length - 1))))];
  };
  R.meanStd = function (a) {
    let s = 0, s2 = 0; for (let i = 0; i < a.length; i++) { s += a[i]; s2 += a[i] * a[i]; }
    const m = s / a.length; return [m, Math.sqrt(Math.max(s2 / a.length - m * m, 1e-12))];
  };

  // ---------- binary morphology helpers ----------
  // exact Euclidean distance transform (Felzenszwalb) – distance (px) to nearest 'true' pixel
  R.edt = function (bin, w, h) {
    const INF = 1e20, f = new Float64Array(Math.max(w, h)), d = new Float64Array(Math.max(w, h));
    const v = new Int32Array(Math.max(w, h)), z = new Float64Array(Math.max(w, h) + 1);
    const g = new Float64Array(w * h);
    function dt1(n) {
      let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < n; q++) {
        let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
        k++; v[k] = q; z[k] = s; z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
    }
    for (let i = 0; i < w; i++) { for (let j = 0; j < h; j++) f[j] = bin[j * w + i] ? 0 : INF; dt1(h); for (let j = 0; j < h; j++) g[j * w + i] = d[j]; }
    const out = new Float32Array(w * h);
    for (let j = 0; j < h; j++) { for (let i = 0; i < w; i++) f[i] = g[j * w + i]; dt1(w); for (let i = 0; i < w; i++) out[j * w + i] = Math.sqrt(d[i]); }
    return out;
  };
  // connected components (8-conn) sizes → keep components with size > minSize
  R.removeSmall = function (bin, w, h, minSize) {
    const lab = new Int32Array(w * h).fill(-1), out = new Uint8Array(w * h), stack = new Int32Array(w * h);
    for (let s = 0; s < w * h; s++) {
      if (!bin[s] || lab[s] >= 0) continue;
      let sp = 0, cnt = 0; stack[sp++] = s; lab[s] = s; const comp = [];
      while (sp) { const p = stack[--sp]; comp.push(p); cnt++;
        const x = p % w, y = (p / w) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx; if (bin[q] && lab[q] < 0) { lab[q] = s; stack[sp++] = q; } } }
      if (cnt > minSize) for (const p of comp) out[p] = 1;
    }
    return out;
  };
  // Zhang–Suen thinning
  R.skeleton = function (bin, w, h) {
    const img = Uint8Array.from(bin); let changed = true; const del = [];
    const P = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : img[y * w + x];
    while (changed) {
      changed = false;
      for (let pass = 0; pass < 2; pass++) {
        del.length = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          if (!img[y * w + x]) continue;
          const p2 = P(x, y - 1), p3 = P(x + 1, y - 1), p4 = P(x + 1, y), p5 = P(x + 1, y + 1),
            p6 = P(x, y + 1), p7 = P(x - 1, y + 1), p8 = P(x - 1, y), p9 = P(x - 1, y - 1);
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9; if (B < 2 || B > 6) continue;
          const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
          if (A !== 1) continue;
          if (pass === 0 ? (p2 * p4 * p6 || p4 * p6 * p8) : (p2 * p4 * p8 || p2 * p6 * p8)) continue;
          del.push(y * w + x);
        }
        if (del.length) { changed = true; for (const p of del) img[p] = 0; }
      }
    }
    return img;
  };

  // ---------- FFT / DCT Poisson (Neumann) ----------
  function fft(re, im, inv) {                       // in-place radix-2
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = 2 * Math.PI / len * (inv ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0;
        for (let j = 0; j < len / 2; j++) {
          const ar = re[i + j], ai = im[i + j], br = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci,
            bi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
          re[i + j] = ar + br; im[i + j] = ai + bi; re[i + j + len / 2] = ar - br; im[i + j + len / 2] = ai - bi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
    if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  function makeDCT(N) {
    const re = new Float64Array(N), im = new Float64Array(N), c = new Float64Array(N), s = new Float64Array(N);
    for (let k = 0; k < N; k++) { c[k] = Math.cos(Math.PI * k / (2 * N)); s[k] = Math.sin(Math.PI * k / (2 * N)); }
    return {
      fwd(x, out) {                                  // DCT-II (unnormalised): X_k = sum x_n cos(pi k (2n+1)/2N)
        for (let n = 0; n < N / 2; n++) { re[n] = x[2 * n]; re[N - 1 - n] = x[2 * n + 1]; }
        im.fill(0); fft(re, im, false);
        for (let k = 0; k < N; k++) out[k] = re[k] * c[k] + im[k] * s[k];
      },
      inv(X, out) {                                  // exact inverse of fwd
        for (let k = 0; k < N; k++) {
          const a = X[k], b = k === 0 ? 0 : -X[N - k];
          re[k] = a * c[k] - b * s[k]; im[k] = a * s[k] + b * c[k];
        }
        re[0] *= 0.5; im[0] *= 0.5;
        // V_k = 0.5*(X_k - i X_{N-k}) e^{i pi k/2N}  (scaled so that ifft gives v)
        for (let k = 1; k < N; k++) { re[k] *= 0.5; im[k] *= 0.5; }
        fft(re, im, true);
        for (let n = 0; n < N / 2; n++) { out[2 * n] = re[n] * 2; out[2 * n + 1] = re[N - 1 - n] * 2; }
      }
    };
  }
  // Solve Lap(u)=f with zero-flux boundaries on a (Nx,Ny) power-of-two grid, spacing hx,hy.
  R.poissonNeumann = function (f, Nx, Ny, hx, hy) {
    const dx = makeDCT(Nx), dy = makeDCT(Ny);
    const F = new Float64Array(Nx * Ny), rowIn = new Float64Array(Nx), rowOut = new Float64Array(Nx);
    const colIn = new Float64Array(Ny), colOut = new Float64Array(Ny);
    for (let j = 0; j < Ny; j++) { for (let i = 0; i < Nx; i++) rowIn[i] = f[j * Nx + i]; dx.fwd(rowIn, rowOut); for (let i = 0; i < Nx; i++) F[j * Nx + i] = rowOut[i]; }
    for (let i = 0; i < Nx; i++) { for (let j = 0; j < Ny; j++) colIn[j] = F[j * Nx + i]; dy.fwd(colIn, colOut); for (let j = 0; j < Ny; j++) F[j * Nx + i] = colOut[j]; }
    for (let j = 0; j < Ny; j++) for (let i = 0; i < Nx; i++) {
      const lam = (2 * Math.cos(Math.PI * i / Nx) - 2) / (hx * hx) + (2 * Math.cos(Math.PI * j / Ny) - 2) / (hy * hy);
      F[j * Nx + i] = (i === 0 && j === 0) ? 0 : F[j * Nx + i] / lam;
    }
    for (let i = 0; i < Nx; i++) { for (let j = 0; j < Ny; j++) colIn[j] = F[j * Nx + i]; dy.inv(colIn, colOut); for (let j = 0; j < Ny; j++) F[j * Nx + i] = colOut[j]; }
    const u = new Float32Array(Nx * Ny);
    for (let j = 0; j < Ny; j++) { for (let i = 0; i < Nx; i++) rowIn[i] = F[j * Nx + i]; dx.inv(rowIn, rowOut); for (let i = 0; i < Nx; i++) u[j * Nx + i] = rowOut[i]; }
    return u;
  };
  R._makeDCT = makeDCT;

  // ---------- relief composition ----------
  /* inp: { w,h,res(mm/px), gray(Float32 0..1), detail(optional Float32 0..1), full, coarse, fine (Float32 depth maps on grid),
            focus: [{mask:Uint8Array, depth:Float32Array(0..1 inside)}] }
     p: parameters (see DEFAULTS) */
  R.DEFAULTS = {
    depth: 20, wFull: 2.2, wCoarse: 1.2, wFine: 1.0, alpha: 3.0, lam: 1.2, sigUnsharp: 3.0,
    photo: 0.6, detailBlur: 0.6, detailFine: 2.0, detailWide: 5.0, detailMix: 0.8,
    envelope: 0.85, smooth: 0.45, finalSmooth: 0.5, median: true,
    grooveSens: 0.07, grooveDepth: 1.3, grooveWidth: 0.5, grooveMinLen: 30,
    focusHeight: 9, focusSharp: 2.0, zeroPlane: 0, shape: 1.0, invert: false
  };

  R.compose = function (inp, P, progress) {
    P = Object.assign({}, R.DEFAULTS, P || {});
    const w = inp.w, h = inp.h, res = inp.res, N = w * h, px = mm => mm / res;
    const say = progress || (() => {});
    // 1. combined depth (relative units)
    const norm = (a) => { const [m, s] = R.meanStd(a); const o = new Float32Array(N); for (let i = 0; i < N; i++) o[i] = (a[i] - m) / s; return o; };
    say('รวมความลึกหลายระดับ');
    let fr = inp.full;
    { // remove broad tilt from global depth (rolling ball ~ 30mm radius)
      const k = Math.max(3, Math.round(px(60)) | 1);
      const op = R.gauss(R.maxF(R.minF(fr, w, h, k), w, h, k), w, h, px(3));
      fr = new Float32Array(N); for (let i = 0; i < N; i++) fr[i] = inp.full[i] - op[i];
      fr = norm(fr);
    }
    const D = new Float32Array(N);
    const gF = inp.fine ? R.gauss(inp.fine, w, h, px(0.6)) : null, gC = inp.coarse ? R.gauss(inp.coarse, w, h, px(0.75)) : null, gG = R.gauss(fr, w, h, px(1));
    for (let i = 0; i < N; i++) D[i] = 4 * (P.wFull * gG[i] + (gC ? P.wCoarse * gC[i] : 0) + (gF ? P.wFine * gF[i] : 0));

    // 2. photo/detail layer (no dark pits inside focus regions)
    say('ดึงรายละเอียดจากภาพ');
    const src = new Float32Array(N);
    for (let i = 0; i < N; i++) src[i] = inp.detail ? (0.2 * inp.gray[i] + 0.8 * inp.detail[i]) : inp.gray[i];
    const Ln = R.gauss(src, w, h, px(P.detailBlur));
    const b1 = R.gauss(Ln, w, h, px(P.detailFine)), b2 = R.gauss(Ln, w, h, px(P.detailWide));
    const a1 = new Float32Array(N), a2 = new Float32Array(N);
    for (let i = 0; i < N; i++) { a1[i] = Ln[i] - b1[i]; a2[i] = Ln[i] - b2[i]; }
    const s1 = R.meanStd(a1)[1], s2 = R.meanStd(a2)[1];
    let Fm = new Float32Array(N);                    // feathered focus mask
    const FM = new Uint8Array(N);
    for (const f of (inp.focus || [])) for (let i = 0; i < N; i++) if (f.mask[i]) FM[i] = 1;
    if (inp.focus && inp.focus.length) {
      const er = R.edt(FM.map(v => 1 - v), w, h);   // distance inside mask to its border
      const t = new Float32Array(N); for (let i = 0; i < N; i++) t[i] = FM[i] && er[i] > px(1) ? 1 : 0;
      Fm = R.gauss(t, w, h, px(1)); for (let i = 0; i < N; i++) Fm[i] = Math.min(1, Fm[i] * 1.3);
    }
    const Ld = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const v1 = Math.tanh(a1[i] / s1 / 1.6) * 1.6, v2 = Math.tanh(a2[i] / s2 / 1.6) * 1.6;
      let v = (v1 + v2 * P.detailMix) * P.photo;
      if (Fm[i] > 0) v = (1 - Fm[i]) * v + Fm[i] * 0.6 * Math.max(v2 * P.photo, -0.3);
      Ld[i] = v;
    }

    // 3. gradient-domain compression on a power-of-two grid
    say('บีบระดับสูงต่ำ (gradient domain)');
    let Nx = 1; while (Nx < w) Nx <<= 1; let Ny = 1; while (Ny < h) Ny <<= 1;
    const Wmm = (w - 1) * res, Hmm = (h - 1) * res, hx = Wmm / (Nx - 1), hy = Hmm / (Ny - 1);
    const D2 = R.resize(D, w, h, Nx, Ny), L2 = R.resize(Ld, w, h, Nx, Ny);
    const M2 = Nx * Ny, gx = new Float32Array(M2), gy = new Float32Array(M2);
    for (let j = 0; j < Ny; j++) for (let i = 0; i < Nx; i++) {
      const k = j * Nx + i;
      if (i < Nx - 1) gx[k] = (D2[k + 1] - D2[k]) / hx;
      if (j < Ny - 1) gy[k] = (D2[k + Nx] - D2[k]) / hy;
      const m = Math.hypot(gx[k], gy[k]) + 1e-9, c = Math.log1p(P.alpha * m) / (P.alpha * m);
      gx[k] *= c; gy[k] *= c;
    }
    const sgx = R.gauss(gx, Nx, Ny, P.sigUnsharp / hx), sgy = R.gauss(gy, Nx, Ny, P.sigUnsharp / hy);
    for (let j = 0; j < Ny; j++) for (let i = 0; i < Nx; i++) {
      const k = j * Nx + i;
      gx[k] += P.lam * (gx[k] - sgx[k]); gy[k] += P.lam * (gy[k] - sgy[k]);
      if (i < Nx - 1) gx[k] += (L2[k + 1] - L2[k]) / hx; else gx[k] = 0;
      if (j < Ny - 1) gy[k] += (L2[k + Nx] - L2[k]) / hy; else gy[k] = 0;
    }
    const div = new Float32Array(M2);
    for (let j = 0; j < Ny; j++) for (let i = 0; i < Nx; i++) {
      const k = j * Nx + i;
      div[k] = (gx[k] - (i > 0 ? gx[k - 1] : 0)) / hx + (gy[k] - (j > 0 ? gy[k - Nx] : 0)) / hy;
    }
    say('แก้สมการ Poisson');
    const U = R.poissonNeumann(div, Nx, Ny, hx, hy);
    let Z = R.resize(U, Nx, Ny, w, h);

    // 4. lift low areas so nothing gets clipped flat; keep background natural
    say('ปรับพื้นและความเนียน');
    { const k = Math.max(3, Math.round(px(30)) | 1);
      const env = R.gauss(R.minF(Z, w, h, k), w, h, px(20));
      for (let i = 0; i < N; i++) Z[i] -= P.envelope * env[i];
      const lo = R.percentile(Z, 0.2); for (let i = 0; i < N; i++) Z[i] = Math.max(Z[i] - lo, 0); }
    Z = R.gauss(Z, w, h, px(P.smooth));

    // 5. V-grooves along carved (dark) lines
    if (P.grooveDepth > 0) {
      say('ทำร่อง V');
      const Ls = R.gauss(src, w, h, px(0.4)), k = Math.max(3, Math.round(px(5)) | 1);
      const cl = R.minF(R.maxF(Ls, w, h, k), w, h, k);   // closing
      const g = new Uint8Array(N); for (let i = 0; i < N; i++) g[i] = (cl[i] - Ls[i]) > P.grooveSens ? 1 : 0;
      const gk = R.removeSmall(g, w, h, Math.round(P.grooveMinLen / (res * res)));
      const sk = R.skeleton(gk, w, h);
      const dl = R.edt(sk, w, h), gw = P.grooveWidth * 2.2;
      for (let i = 0; i < N; i++) { const t = Math.max(0, 1 - dl[i] * res / gw); Z[i] -= P.grooveDepth * Math.pow(t, 1.6) * (1 - Fm[i]); }
    }
    if (P.median) Z = R.median3(Z, w, h);
    Z = R.gauss(Z, w, h, px(P.finalSmooth));
    for (let i = 0; i < N; i++) Z[i] = Math.max(Z[i], 0);
    { const s = R.percentile(Z, 99.95) || 1; for (let i = 0; i < N; i++) Z[i] = Z[i] / s * P.depth; }

    // 6. focus regions: replace interior with close-up AI sculpt
    if (inp.focus && inp.focus.length) {
      say('ปั้นบริเวณละเอียด');
      for (const f of inp.focus) {
        let fd = R.gauss(f.depth, w, h, px(0.8));
        const f4 = R.gauss(fd, w, h, px(2)), f10 = R.gauss(fd, w, h, px(5));
        const ring = new Uint8Array(N), dm = R.edt(f.mask, w, h);
        for (let i = 0; i < N; i++) ring[i] = !f.mask[i] && dm[i] <= px(2) ? 1 : 0;
        const zr = new Float32Array(N), rr = new Float32Array(N);
        for (let i = 0; i < N; i++) { zr[i] = ring[i] ? Z[i] : 0; rr[i] = ring[i]; }
        // ring level spread inward; widen the spread where the narrow one does not reach
        const gz = R.gauss(zr, w, h, px(7)), gr = R.gauss(rr, w, h, px(7));
        for (const sg of [16, 35, 80]) {
          const gz2 = R.gauss(zr, w, h, px(sg)), gr2 = R.gauss(rr, w, h, px(sg));
          for (let i = 0; i < N; i++) {
            const wt = Math.min(1, gr[i] / 0.05);            // trust narrow estimate only where it has support
            if (wt < 1 && gr2[i] > 1e-7) { const a = gz2[i] / gr2[i], b = gr[i] > 1e-9 ? gz[i] / gr[i] : a;
              gz[i] = (wt * b + (1 - wt) * a); gr[i] = 1; }
            else if (wt >= 1) { gz[i] = gz[i] / gr[i]; gr[i] = 1; }
          }
        }
        const inner = R.edt(f.mask.map(v => 1 - v), w, h);
        const t = new Float32Array(N); for (let i = 0; i < N; i++) t[i] = f.mask[i] && inner[i] > px(1.5) ? 1 : 0;
        const Fin = R.gauss(t, w, h, px(1.25));
        const H = P.focusHeight * P.depth / 20;
        for (let i = 0; i < N; i++) {
          if (Fin[i] < 1e-3) continue;
          let v = fd[i] + P.focusSharp * (fd[i] - f4[i]) + 0.5 * P.focusSharp * (fd[i] - f10[i]);
          v = Math.min(Math.max(v, 0), 1.3);
          const lvl = gz[i] / Math.max(gr[i], 1e-6), fi = Math.min(1, Fin[i] * 1.25);
          Z[i] = Z[i] * (1 - fi) + (lvl + H * v) * fi;
        }
      }
    }

    // 7. zero plane, shape curve, clamp
    const zp = P.zeroPlane * P.depth, inv = 1 / Math.max(1e-6, P.depth - zp);
    for (let i = 0; i < N; i++) {
      let z = Math.min(Math.max(Z[i], 0), P.depth);
      z = Math.max(z - zp, 0) * inv;                  // 0..1
      if (P.shape !== 1) z = Math.pow(z, P.shape);
      Z[i] = (P.invert ? 1 - z : z) * P.depth;
    }
    return Z;
  };

  // ---------- tiling helpers for the depth model ----------
  R.tileGrid = function (len, T, stride) {
    const xs = []; if (len <= T) return [0];
    for (let x = 0; x <= len - T; x += stride) xs.push(x);
    if (xs[xs.length - 1] !== len - T) xs.push(len - T);
    return xs;
  };
  R.window = function (T) {
    const wv = new Float32Array(T * T);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const d = Math.min(Math.min(x + 1, T - x), Math.min(y + 1, T - y));
      const v = Math.min(1, d / (T * 0.25)); wv[y * T + x] = v * v + 1e-4;
    }
    return wv;
  };

  // hillshade preview (Uint8 gray)
  R.hillshade = function (Z, w, h, res, out) {
    const L = [-0.45, 0.55, 0.70], ln = Math.hypot(...L); L[0] /= ln; L[1] /= ln; L[2] /= ln;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const zx = (Z[j * w + Math.min(i + 1, w - 1)] - Z[j * w + Math.max(i - 1, 0)]) / (2 * res);
      const zy = (Z[Math.min(j + 1, h - 1) * w + i] - Z[Math.max(j - 1, 0) * w + i]) / (2 * res);
      const nx = -zx, ny = zy, nz = 1, nl = Math.hypot(nx, ny, nz);
      const s = 0.25 + 0.75 * Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / nl);
      out[k] = Math.min(255, s * 255);
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = R; else root.Relief = R;
})(typeof self !== 'undefined' ? self : this);
