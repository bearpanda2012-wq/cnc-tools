/* ReliefForge worker – runs the depth model (onnxruntime-web) and the relief pipeline off the UI thread. */
'use strict';
const ORT_VER = '1.20.1';
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`;
let ORT_LOADED = false;
importScripts('relief.js', 'ops.js');

const S = { session: null, backend: null, inputName: 'pixel_values', fp16in: false,
  grid: null, w: 0, h: 0, res: 0.5, gray: null, detail: null, full: null, coarse: null, fine: null, focus: new Map() };

const post = (type, data, transfer) => self.postMessage(Object.assign({ type }, data || {}), transfer || []);
const prog = (stage, frac, text) => post('progress', { stage, frac, text });

async function loadOrt() {
  if (ORT_LOADED) return;
  importScripts(ORT_BASE + 'ort.webgpu.min.js');
  ort.env.wasm.wasmPaths = ORT_BASE;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
  ORT_LOADED = true;
}

async function fetchModel(url) {
  let cache = null;
  try { cache = await caches.open('reliefforge-models-v1'); const hit = await cache.match(url); if (hit) { prog('model', 1, 'โหลดโมเดลจากแคช'); return new Uint8Array(await hit.arrayBuffer()); } } catch (e) { cache = null; }
  const r = await fetch(url, { mode: 'cors' });
  if (!r.ok) throw new Error('ดาวน์โหลดโมเดลไม่สำเร็จ: HTTP ' + r.status);
  const total = +r.headers.get('content-length') || 0, reader = r.body.getReader(), parts = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length;
    prog('model', total ? got / total : 0, `ดาวน์โหลดโมเดล ${(got / 1e6).toFixed(1)}${total ? ' / ' + (total / 1e6).toFixed(1) : ''} MB`); }
  const buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  try { if (cache) await cache.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })); } catch (e) {}
  return buf;
}

async function init(msg) {
  await loadOrt();
  const prefer = msg.device || 'auto';
  let order = prefer === 'wasm' ? ['wasm'] : ['webgpu', 'wasm'];
  if (!('gpu' in navigator)) order = ['wasm'];
  let lastErr = null;
  for (const ep of order) {
    try {
      const url = ep === 'webgpu' ? msg.modelGpu : msg.modelCpu;
      const bytes = await fetchModel(url);
      prog('model', 1, 'เตรียมโมเดล (' + ep + ')');
      S.session = await ort.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: 'all' });
      S.backend = ep; S.inputName = S.session.inputNames[0];
      // probe once with a tiny tensor to learn the input dtype
      try { await runTensor(new Float32Array(3 * 28 * 28), 28, 28); S.fp16in = false; }
      catch (e) { S.fp16in = true; await runTensor(new Float32Array(3 * 28 * 28), 28, 28); }
      post('ready', { backend: ep });
      return;
    } catch (e) { lastErr = e; S.session = null; }
  }
  throw lastErr || new Error('ไม่สามารถเริ่มโมเดลได้');
}

function f32toF16(a) {
  const out = new Uint16Array(a.length), f = new Float32Array(1), u = new Uint32Array(f.buffer);
  for (let i = 0; i < a.length; i++) { f[0] = a[i]; const x = u[0];
    const s = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
    out[i] = e <= 0 ? s : e >= 31 ? (s | 0x7c00) : (s | (e << 10) | (m >>> 13)); }
  return out;
}
function f16toF32(a) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) { const h = a[i], s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
    out[i] = e === 0 ? s * m * 5.96e-8 : e === 31 ? s * 65504 : s * Math.pow(2, e - 15) * (1 + m / 1024); }
  return out;
}
async function runTensor(chw, tw, th) {
  const t = S.fp16in ? new ort.Tensor('float16', f32toF16(chw), [1, 3, th, tw]) : new ort.Tensor('float32', chw, [1, 3, th, tw]);
  const out = await S.session.run({ [S.inputName]: t });
  const o = out[S.session.outputNames[0]];
  const data = o.type === 'float16' ? (o.data instanceof Uint16Array ? f16toF32(o.data) : Float32Array.from(o.data)) : o.data;
  if (t.dispose) t.dispose();
  return { data, h: o.dims[o.dims.length - 2], w: o.dims[o.dims.length - 1] };
}

// ---- extra models (background cutout, upscaler) ----
const M = {};
async function openModel(key, urlGpu, urlCpu, device) {
  if (M[key]) return M[key];
  await loadOrt();
  let order = device === 'wasm' || !('gpu' in navigator) ? ['wasm'] : ['webgpu', 'wasm'], err = null;
  for (const ep of order) {
    try {
      const bytes = await fetchModel(ep === 'webgpu' ? urlGpu : urlCpu);
      prog('model', 1, 'เตรียมโมเดล ' + key + ' (' + ep + ')');
      const sess = await ort.InferenceSession.create(bytes, { executionProviders: [ep], graphOptimizationLevel: 'all' });
      const meta = sess.inputMetadata && sess.inputMetadata[0];
      const fp16 = /float16/.test((meta && meta.type) || '') || (ep === 'webgpu' && /fp16/.test(urlGpu));
      return (M[key] = { sess, ep, fp16, inName: sess.inputNames[0] });
    } catch (e) { err = e; }
  }
  throw err;
}
async function runOn(m, chw, dims) {
  let t = m.fp16 ? new ort.Tensor('float16', f32toF16(chw), dims) : new ort.Tensor('float32', chw, dims);
  let out;
  try { out = await m.sess.run({ [m.inName]: t }); }
  catch (e) { if (m.fp16) throw e; m.fp16 = true; t = new ort.Tensor('float16', f32toF16(chw), dims); out = await m.sess.run({ [m.inName]: t }); }
  const o = out[m.sess.outputNames[m.sess.outputNames.length - 1]];
  const data = o.type === 'float16' ? (o.data instanceof Uint16Array ? f16toF32(o.data) : Float32Array.from(o.data)) : o.data;
  return { data, dims: o.dims };
}
function rgbCHW(bmp, sx, sy, sw, sh, tw, th, norm) {
  canvas.width = tw; canvas.height = th; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, tw, th); ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, tw, th);
  const px = ctx.getImageData(0, 0, tw, th).data, n = tw * th, chw = new Float32Array(3 * n);
  const mean = norm ? [0.485, 0.456, 0.406] : [0, 0, 0], std = norm ? [0.229, 0.224, 0.225] : [1, 1, 1];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) chw[c * n + i] = (px[i * 4 + c] / 255 - mean[c]) / std[c];
  return chw;
}
// BiRefNet cutout on the current grid image, square tiles along the long side, max-blended
async function cutout(msg) {
  const m = await openModel('cutout', msg.urlGpu, msg.urlCpu, msg.device);
  const w = S.w, h = S.h, src = S.hires || S.grid, k = S.hires ? S.k : 1, T = Math.min(w, h), st = Math.round(T * 0.6);
  const xs = Relief.tileGrid(w, T, st), ys = Relief.tileGrid(h, T, st), acc = new Float32Array(w * h); let n = 0;
  for (const y of ys) for (const x of xs) {
    const r = await runOn(m, rgbCHW(src, x * k, y * k, T * k, T * k, 1024, 1024, true), [1, 3, 1024, 1024]);
    const d = Relief.resize(r.data, r.dims[r.dims.length - 1], r.dims[r.dims.length - 2], T, T);
    for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) { const v = 1 / (1 + Math.exp(-d[j * T + i])), q = (y + j) * w + x + i; if (v > acc[q]) acc[q] = v; }
    n++; prog('cutout', n / (xs.length * ys.length), `AI ตัดพื้นหลัง ${n}/${xs.length * ys.length}`);
  }
  post('cutoutDone', { mask: acc }, [acc.buffer]);
}
// Swin2SR x2 upscaler on an ImageBitmap, tiled with overlap
async function upscale(msg) {
  const m = await openModel('upscale', msg.urlGpu, msg.urlCpu, msg.device);
  const bmp = msg.bitmap, W = bmp.width, H = bmp.height, T = 160, ov = 16, st = T - 2 * ov;
  const out = new OffscreenCanvas(W * 2, H * 2), oc = out.getContext('2d');
  const xs = Relief.tileGrid(W, Math.min(T, W), st), ys = Relief.tileGrid(H, Math.min(T, H), st); let n = 0;
  for (const y of ys) for (const x of xs) {
    const tw = Math.min(T, W), th = Math.min(T, H), pw = Math.ceil(tw / 8) * 8, ph = Math.ceil(th / 8) * 8;
    const chw = rgbCHW(bmp, x, y, tw, th, tw, th, false), pad = new Float32Array(3 * pw * ph);
    for (let c = 0; c < 3; c++) for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) pad[c * pw * ph + j * pw + i] = chw[c * tw * th + Math.min(j, th - 1) * tw + Math.min(i, tw - 1)];
    const r = await runOn(m, pad, [1, 3, ph, pw]), ow = r.dims[3], oh = r.dims[2], img = new ImageData(tw * 2, th * 2);
    for (let j = 0; j < th * 2; j++) for (let i = 0; i < tw * 2; i++) for (let c = 0; c < 3; c++) img.data[(j * tw * 2 + i) * 4 + c] = Math.max(0, Math.min(255, r.data[c * ow * oh + j * ow + i] * 255));
    for (let i = 0; i < tw * 2 * th * 2; i++) img.data[i * 4 + 3] = 255;
    const l = x ? ov : 0, t = y ? ov : 0;   // drop overlap margins except at image borders
    const tmp = new OffscreenCanvas(tw * 2, th * 2); tmp.getContext('2d').putImageData(img, 0, 0);
    oc.drawImage(tmp, l * 2, t * 2, (tw - l) * 2, (th - t) * 2, (x + l) * 2, (y + t) * 2, (tw - l) * 2, (th - t) * 2);
    n++; prog('upscale', n / (xs.length * ys.length), `AI ขยายรูป ${n}/${xs.length * ys.length}`);
  }
  const res = out.transferToImageBitmap(); post('upscaleDone', { bitmap: res }, [res]);
}
function cutsim(msg) {
  const P = new Float32Array(msg.P), C = ReliefOps.ballCut(P, msg.pw, msg.ph, msg.res, msg.radius), D = new Float32Array(P.length);
  let miss = 0, maxd = 0; for (let i = 0; i < P.length; i++) { D[i] = C[i] - P[i]; if (D[i] > 0.1) miss++; if (D[i] > maxd) maxd = D[i]; }
  post('cutsimDone', { C, D, missPct: miss / P.length * 100, maxd }, [C.buffer, D.buffer]);
}
function getState() {
  const o = { w: S.w, h: S.h, res: S.res, full: S.full, coarse: S.coarse, fine: S.fine, focus: [...S.focus].map(([id, f]) => ({ id, mask: f.mask, depth: f.depth })) };
  post('state', o);
}
function setState(m) {
  S.w = m.w; S.h = m.h; S.res = m.res; S.full = m.full; S.coarse = m.coarse; S.fine = m.fine; S.gray = m.gray; S.focus.clear();
  for (const f of m.focus || []) S.focus.set(f.id, { mask: f.mask, depth: f.depth });
  if (m.rgba) { const px = new Uint8ClampedArray(m.rgba), n = m.w * m.h; S.gray = new Float32Array(n); for (let i = 0; i < n; i++) S.gray[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255; }
  if (m.rgba) createImageBitmap(new ImageData(new Uint8ClampedArray(m.rgba), m.w, m.h)).then(b => { S.grid = b; S.hires = null; post('stateSet', {}); });
  else post('stateSet', {});
}

// draw region (sx,sy,sw,sh) of the grid bitmap into (tw,th), optionally mirrored; return CHW normalised tensor data
const canvas = new OffscreenCanvas(16, 16), ctx = canvas.getContext('2d', { willReadFrequently: true });
function tensorFrom(bmp, sx, sy, sw, sh, tw, th, flip) {
  canvas.width = tw; canvas.height = th; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.save(); if (flip) { ctx.translate(tw, 0); ctx.scale(-1, 1); }
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, tw, th); ctx.restore();
  const px = ctx.getImageData(0, 0, tw, th).data, n = tw * th, chw = new Float32Array(3 * n);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) chw[c * n + i] = (px[i * 4 + c] / 255 - mean[c]) / std[c];
  return chw;
}
async function depthOf(sx, sy, sw, sh, tw, th, flip) {
  const k = S.hires ? S.k : 1, src = S.hires || S.grid;
  const r = await runTensor(tensorFrom(src, sx * k, sy * k, sw * k, sh * k, tw, th, flip), tw, th);
  let d = r.data; if (flip) { const o = new Float32Array(d.length); for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) o[y * r.w + x] = d[y * r.w + (r.w - 1 - x)]; d = o; }
  return Relief.resize(d, r.w, r.h, sw, sh);
}
const m14 = v => Math.max(14, Math.round(v / 14) * 14);

async function tiledPass(Tpx, hp, label, f0, f1) {
  const R = Relief, w = S.w, h = S.h, T = Math.min(Tpx, Math.min(w, h)), st = Math.max(1, Math.round(T * 2 / 3));
  const xs = R.tileGrid(w, T, st), ys = R.tileGrid(h, T, st), win = R.window(T);
  const acc = new Float32Array(w * h), wac = new Float32Array(w * h); let n = 0; const tot = xs.length * ys.length;
  for (const y of ys) for (const x of xs) {
    let d = await depthOf(x, y, T, T, 504, 504, false);
    const lp = R.gauss(d, T, T, T * hp); for (let i = 0; i < d.length; i++) d[i] -= lp[i];
    const sd = R.meanStd(d)[1] + 1e-6;
    for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) { const k = (y + j) * w + x + i, wv = win[j * T + i]; acc[k] += d[j * T + i] / sd * wv; wac[k] += wv; }
    n++; prog('depth', f0 + (f1 - f0) * n / tot, `${label} ${n}/${tot}`);
  }
  for (let i = 0; i < acc.length; i++) acc[i] /= Math.max(wac[i], 1e-6);
  return acc;
}

async function depth(msg) {
  S.w = msg.w; S.h = msg.h; S.res = msg.res;
  const px = new Uint8ClampedArray(msg.rgba), img = new ImageData(px, msg.w, msg.h);
  S.grid = await createImageBitmap(img);
  if (S.hires && S.hires.close) S.hires.close();
  S.hires = msg.hires || null; S.k = msg.k || 1;
  const n = S.w * S.h; S.gray = new Float32Array(n);
  for (let i = 0; i < n; i++) S.gray[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
  S.focus.clear();
  const shortMm = Math.min(S.w, S.h) * S.res;
  // global pass
  prog('depth', 0.02, 'วิเคราะห์ภาพรวม');
  { const long = Math.max(S.w, S.h), sc = Math.min(1540 / long, 1); let tw = m14(S.w * sc), th = m14(S.h * sc);
    if (Math.min(tw, th) < 280) { const k = 280 / Math.min(tw, th); tw = m14(tw * k); th = m14(th * k); }
    S.full = await depthOf(0, 0, S.w, S.h, tw, th, false); }
  const q = msg.quality || 'high';
  const coarseMm = Math.max(60, shortMm / 2), fineMm = Math.max(30, shortMm / 4);
  S.coarse = await tiledPass(Math.round(coarseMm / S.res), 0.12, 'ช่องใหญ่', 0.05, q === 'fast' ? 1 : 0.4);
  S.fine = q === 'fast' ? null : await tiledPass(Math.round(fineMm / S.res), 0.10, 'ช่องซูม', 0.4, q === 'ultra' ? 0.7 : 1);
  if (q === 'ultra') { // extra-zoom pass blended into fine
    const ex = await tiledPass(Math.round(Math.max(20, shortMm / 7) / S.res), 0.10, 'ช่องซูมพิเศษ', 0.7, 1);
    for (let i = 0; i < n; i++) S.fine[i] = 0.6 * S.fine[i] + 0.4 * ex[i];
  }
  const bad = a => { if (!a) return 0; let c = 0; for (let i = 0; i < a.length; i++) if (!isFinite(a[i])) c++; return c; };
  post('depthDone', { nan: [bad(S.full), bad(S.coarse), bad(S.fine), bad(S.gray)] });
}

async function focus(msg) {
  const w = S.w, h = S.h, mask = new Uint8Array(msg.mask);
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (mask[j * w + i]) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  if (x1 < x0) return post('focusDone', { id: msg.id, empty: true });
  const mg = Math.round(15 / S.res); x0 = Math.max(0, x0 - mg); y0 = Math.max(0, y0 - mg); x1 = Math.min(w - 1, x1 + mg); y1 = Math.min(h - 1, y1 + mg);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1; let tw = 518, th = m14(ch / cw * 518);
  if (th > 1036) { th = 1036; tw = m14(cw / ch * 1036); }
  prog('focus', 0.3, 'ปั้นบริเวณละเอียด');
  const a = await depthOf(x0, y0, cw, ch, tw, th, false), b = await depthOf(x0, y0, cw, ch, tw, th, true);
  const vals = []; for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) if (mask[(y0 + j) * w + x0 + i]) vals.push((a[j * cw + i] + b[j * cw + i]) / 2);
  vals.sort((p, q) => p - q); const lo = vals[Math.floor(vals.length * 0.02)], hi = vals[Math.floor(vals.length * 0.995)];
  const d = new Float32Array(w * h);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) { const k = (y0 + j) * w + x0 + i; if (mask[k]) d[k] = ((a[j * cw + i] + b[j * cw + i]) / 2 - lo) / (hi - lo + 1e-9); }
  S.focus.set(msg.id, { mask, depth: d });
  post('focusDone', { id: msg.id });
}

function compose(msg) {
  if (!S.full) throw new Error('ยังไม่ได้วิเคราะห์ความลึก');
  if (msg.detailRgba) { const a = msg.detailRgba, n = S.w * S.h; S.detail = new Float32Array(n);
    for (let i = 0; i < n; i++) S.detail[i] = 1 - (0.299 * a[i * 4] + 0.587 * a[i * 4 + 1] + 0.114 * a[i * 4 + 2]) / 255; }
  if (msg.clearDetail) S.detail = null;
  const keep = new Set(msg.focusIds || []);
  for (const k of [...S.focus.keys()]) if (!keep.has(k)) S.focus.delete(k);
  const t0 = performance.now();
  const Z = Relief.compose({ w: S.w, h: S.h, res: S.res, gray: S.gray, detail: S.detail, full: S.full, coarse: S.coarse, fine: S.fine,
    focus: [...S.focus.values()] }, msg.params, s => prog('compose', 0, s));
  const shade = new Uint8ClampedArray(S.w * S.h); Relief.hillshade(Z, S.w, S.h, S.res, shade);
  post('composed', { Z, shade, w: S.w, h: S.h, ms: performance.now() - t0 }, [Z.buffer, shade.buffer]);
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') await init(m);
    else if (m.type === 'depth') await depth(m);
    else if (m.type === 'focus') await focus(m);
    else if (m.type === 'compose') compose(m);
    else if (m.type === 'cutout') await cutout(m);
    else if (m.type === 'upscale') await upscale(m);
    else if (m.type === 'cutsim') cutsim(m);
    else if (m.type === 'getState') getState();
    else if (m.type === 'setState') setState(m);
  } catch (err) { post('error', { message: (err && err.message) || String(err), during: m.type }); }
};
