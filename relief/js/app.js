import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildSTL, buildPNG16, buildSolid } from './export.js';
const Relief = window.Relief;

// ---------------- config ----------------
const HF = 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/';
const qs = new URLSearchParams(location.search);
const MODEL_GPU = qs.get('model') || HF + 'model_fp16.onnx';
const MODEL_CPU = qs.get('modelcpu') || qs.get('model') || HF + 'model.onnx';

const DEFAULTS = {
  photo: 0.6, detailFine: 2.0, alpha: 3.0, lam: 1.2, wFull: 2.2, wFine: 1.0, grooveDepth: 1.3, grooveSens: 0.07,
  smooth: 0.45, finalSmooth: 0.5, envelope: 0.85, zeroPlane: 0, shape: 1.0, focusHeight: 9, focusSharp: 2.0
};
const SLIDERS = [
  ['photo', 'รายละเอียดจากภาพ', 0, 1.5, 0.05, ''],
  ['detailFine', 'ขนาดรายละเอียด', 1, 4, 0.1, 'mm'],
  ['wFine', 'รายละเอียดจาก AI ซูม', 0, 2, 0.05, ''],
  ['wFull', 'ความเด่นของตัวหลัก', 0, 4, 0.1, ''],
  ['alpha', 'บีบระดับสูง–ต่ำ', 0.5, 8, 0.1, ''],
  ['lam', 'เน้นทรงรอง', 0, 3, 0.05, ''],
  ['grooveDepth', 'ความลึกร่อง V', 0, 3, 0.05, 'mm'],
  ['grooveSens', 'ความไวร่อง (น้อย = ร่องมาก)', 0.03, 0.15, 0.005, ''],
  ['smooth', 'ความเนียนผิว', 0, 1.5, 0.05, 'mm'],
  ['finalSmooth', 'เกลี่ยสุดท้าย', 0, 1.5, 0.05, 'mm'],
  ['envelope', 'ยกบริเวณที่ต่ำ', 0, 1, 0.05, ''],
  ['zeroPlane', 'Zero plane (ตัดพื้น)', 0, 0.6, 0.01, ''],
  ['shape', 'Shape (มน ↔ คม)', 0.5, 2, 0.05, ''],
  ['focusHeight', 'ความสูงบริเวณปั้น', 0, 15, 0.5, 'mm'],
  ['focusSharp', 'ความคมบริเวณปั้น', 0, 4, 0.1, ''],
];
const PRESETS = {
  'ไม้แกะสลักไทย': {},
  'นูนต่ำ เรียบ': { alpha: 5, photo: 0.4, grooveDepth: 0.8, smooth: 0.8, finalSmooth: 0.8, wFull: 1.6 },
  'คมชัดสูง': { photo: 0.9, grooveDepth: 1.8, lam: 1.6, smooth: 0.3, finalSmooth: 0.35, detailFine: 1.6 },
  'พื้นเรียบ (ตัดพื้น)': { zeroPlane: 0.18, envelope: 0.6 },
  'ปั้นนุ่ม (ประติมากรรม)': { photo: 0.3, grooveDepth: 0.4, lam: 0.8, smooth: 1.0, finalSmooth: 0.9, alpha: 2.2 },
};
const COLORS = ['#e4572e', '#29a3a3', '#f3a712', '#7b2cbf', '#2e86de', '#2f9e44'];

// ---------------- state ----------------
const $ = id => document.getElementById(id);
const st = {
  img: null, detailImg: null, crop: null, polys: [], params: load('rs_params', { ...DEFAULTS }),
  w: 0, h: 0, res: 0.5, Z: null, shade: null, depthKey: null, busy: false, workerReady: false, mode: 'crop',
  drawing: null, focusDone: new Set(), pendingCompose: false
};
function load(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ? Object.assign(d, v) : d; } catch (e) { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

// ---------------- worker ----------------
const worker = new Worker(new URL('./worker.js', import.meta.url));
let waiters = {};
function wcall(type, data, transfer, done) {
  return new Promise((res, rej) => { waiters[done] = { res, rej }; worker.postMessage(Object.assign({ type }, data), transfer || []); });
}
worker.onmessage = e => {
  const m = e.data;
  if (m.type === 'progress') { setProg(m.frac, m.text); return; }
  if (m.type === 'error') { const w = Object.values(waiters)[0]; waiters = {}; setProg(0, 'ผิดพลาด: ' + m.message, true); if (w) w.rej(new Error(m.message)); return; }
  const w = waiters[m.type]; if (w) { delete waiters[m.type]; w.res(m); }
};
function setProg(f, t, err) { $('pbar').style.width = Math.round((f || 0) * 100) + '%'; $('ptext').textContent = t || ''; $('ptext').style.color = err ? 'var(--err)' : ''; }

// ---------------- UI: sliders & presets ----------------
function buildSliders() {
  const box = $('sliders'); box.innerHTML = '';
  for (const [k, lab, mn, mx, stp, unit] of SLIDERS) {
    const d = document.createElement('div'); d.className = 'sl';
    d.innerHTML = `<div class="lab"><span>${lab}</span><b id="v_${k}"></b></div><input type="range" id="s_${k}" min="${mn}" max="${mx}" step="${stp}">`;
    box.appendChild(d);
    const inp = d.querySelector('input'); inp.value = st.params[k];
    const show = () => $('v_' + k).textContent = (+inp.value).toFixed(stp < 0.01 ? 3 : stp < 0.1 ? 2 : 1) + (unit ? ' ' + unit : '');
    show();
    inp.addEventListener('input', () => { st.params[k] = +inp.value; show(); save('rs_params', st.params); scheduleCompose(); });
  }
  const pb = $('presets'); pb.innerHTML = '';
  for (const name of Object.keys(PRESETS)) {
    const b = document.createElement('button'); b.textContent = name; b.className = 'ghost';
    b.onclick = () => { st.params = Object.assign({ ...DEFAULTS }, PRESETS[name]); save('rs_params', st.params); buildSliders(); scheduleCompose(true); };
    pb.appendChild(b);
  }
}
$('btnReset').onclick = () => { st.params = { ...DEFAULTS }; save('rs_params', st.params); buildSliders(); scheduleCompose(true); };

// ---------------- size inputs ----------------
const sizeIds = ['W', 'H', 'T', 'depth', 'F', 'res', 'quality', 'device', 'backMode', 'backDepth', 'core', 'cutThr'];
const savedSize = load('rs_size', {});
for (const id of sizeIds) if (savedSize[id] !== undefined) $(id).value = savedSize[id];
if (savedSize.lock !== undefined) $('lock').checked = savedSize.lock;
if (savedSize.mirror !== undefined) $('mirror').checked = savedSize.mirror;
if (savedSize.cutout !== undefined) $('cutout').checked = savedSize.cutout;
$('backOpts').hidden = $('backMode').value === 'flat';
function saveSize() { const o = {}; for (const id of sizeIds) o[id] = $(id).value; o.lock = $('lock').checked; o.mirror = $('mirror').checked; o.cutout = $('cutout').checked; save('rs_size', o); }
function sizes() {
  const W = +$('W').value, H = +$('H').value, F = +$('F').value, res = +$('res').value;
  const rw = Math.max(10, W - 2 * F), rh = Math.max(10, H - 2 * F);
  return { W, H, F, res, T: +$('T').value, depth: +$('depth').value, rw, rh, w: Math.round(rw / res) + 1, h: Math.round(rh / res) + 1 };
}
function updateInfo() {
  const s = sizes();
  $('gridInfo').textContent = `พื้นที่ลาย ${s.rw.toFixed(0)} × ${s.rh.toFixed(0)} mm · กริด ${s.w} × ${s.h} จุด (${(s.w * s.h / 1e6).toFixed(2)} ล้าน)`;
  const tri = 2 * (s.w - 1) * (s.h - 1); $('expInfo').textContent = `STL ประมาณ ${(tri * 50 / 1e6).toFixed(0)} MB · ${(tri / 1e6).toFixed(1)} ล้านสามเหลี่ยม`;
}
function syncAspect(from) {
  if (!$('lock').checked || !st.crop) return;
  const F = +$('F').value, a = st.crop.h / st.crop.w;
  if (from === 'H') $('W').value = Math.round((+$('H').value - 2 * F) / a + 2 * F);
  else $('H').value = Math.round((+$('W').value - 2 * F) * a + 2 * F);
}
for (const id of sizeIds) $(id).addEventListener('change', () => {
  if (id === 'W' || id === 'F') syncAspect('W'); if (id === 'H') syncAspect('H');
  saveSize(); updateInfo();
  if (['depth', 'T', 'F'].includes(id)) { if (st.Z) scheduleCompose(true); } // geometry only
});
$('lock').onchange = () => { syncAspect('W'); saveSize(); updateInfo(); };
$('mirror').onchange = () => { saveSize(); if (st.Z) { drawHm(); build3D(); } };

// ---------------- image loading ----------------
async function loadFile(file, isDetail) {
  // decode; very large images are downscaled on load to keep memory sane (~60 MP)
  let bmp;
  try {
    const url = URL.createObjectURL(file), im = new Image(); im.src = url; await im.decode();
    const mp = im.naturalWidth * im.naturalHeight / 1e6, k = mp > 60 ? Math.sqrt(60 / mp) : 1;
    bmp = k < 1 ? await createImageBitmap(im, { resizeWidth: Math.round(im.naturalWidth * k), resizeHeight: Math.round(im.naturalHeight * k), resizeQuality: 'high' }) : await createImageBitmap(im);
    URL.revokeObjectURL(url);
    if (k < 1) setTimeout(() => setProg(0, `รูปใหญ่มาก (${mp.toFixed(0)} MP) ย่อเหลือ ${bmp.width}×${bmp.height} px อัตโนมัติ`), 50);
  } catch (e) { bmp = await createImageBitmap(file); }
  if (isDetail) { st.detailImg = bmp; $('detailInfo').textContent = `ภาพเสริม ${bmp.width}×${bmp.height} px` + (st.img && Math.abs(bmp.width / bmp.height - st.img.width / st.img.height) > 0.02 ? ' — สัดส่วนไม่ตรงกับรูปหลัก!' : ''); if (st.Z) scheduleCompose(true, true); return; }
  st.img = bmp; st.crop = { x: 0, y: 0, w: bmp.width, h: bmp.height }; st.polys = []; st.Z = null; st.depthKey = null;
  $('drop').classList.add('hide'); renderPolys(); syncAspect('W'); updateInfo(); showTab('img'); drawImg();
  setProg(0, `โหลดรูป ${bmp.width}×${bmp.height} px — ลากเลือกพื้นที่ลาย แล้วกดวิเคราะห์`);
}
$('fileMain').onchange = e => e.target.files[0] && loadFile(e.target.files[0], false);
$('fileDetail').onchange = e => e.target.files[0] && loadFile(e.target.files[0], true);
const stage = document.querySelector('.stage');
stage.addEventListener('dragover', e => { e.preventDefault(); $('drop').classList.add('over'); });
stage.addEventListener('dragleave', () => $('drop').classList.remove('over'));
stage.addEventListener('drop', e => { e.preventDefault(); $('drop').classList.remove('over'); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) loadFile(f, false); });

// ---------------- image canvas: crop + polygons ----------------
const cv = $('cvImg'), cx = cv.getContext('2d');
let view = { s: 1, ox: 0, oy: 0 };
function fitCanvas(c) { const r = c.getBoundingClientRect(), d = devicePixelRatio || 1; if (c.width !== Math.round(r.width * d) || c.height !== Math.round(r.height * d)) { c.width = Math.round(r.width * d); c.height = Math.round(r.height * d); } return d; }
function drawImg() {
  const d = fitCanvas(cv); cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, cv.width, cv.height);
  if (!st.img) return;
  const s = Math.min(cv.width / st.img.width, cv.height / st.img.height) * 0.96;
  view = { s, ox: (cv.width - st.img.width * s) / 2, oy: (cv.height - st.img.height * s) / 2, d };
  cx.setTransform(s, 0, 0, s, view.ox, view.oy); cx.drawImage(st.img, 0, 0);
  const c = st.crop; cx.fillStyle = 'rgba(0,0,0,.45)';
  cx.beginPath(); cx.rect(0, 0, st.img.width, st.img.height); cx.rect(c.x, c.y, c.w, c.h); cx.fill('evenodd');
  cx.lineWidth = 2 / s; cx.setLineDash([8 / s, 5 / s]); cx.strokeStyle = '#fff'; cx.strokeRect(c.x, c.y, c.w, c.h); cx.setLineDash([]);
  st.polys.forEach((p, i) => drawPoly(p.pts.map(q => toImg(q)), COLORS[i % COLORS.length], true));
  if (st.drawing) drawPoly(st.drawing.map(q => toImg(q)), '#fff', false);
}
function drawPoly(pts, col, closed) {
  if (!pts.length) return; const s = view.s;
  cx.beginPath(); cx.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) cx.lineTo(p[0], p[1]); if (closed) cx.closePath();
  cx.lineWidth = 2.5 / s; cx.strokeStyle = col; if (closed) { cx.fillStyle = col + '33'; cx.fill(); } cx.stroke();
  for (const p of pts) { cx.beginPath(); cx.arc(p[0], p[1], 3 / s, 0, 7); cx.fillStyle = col; cx.fill(); }
}
const toImg = q => [st.crop.x + q[0] * st.crop.w, st.crop.y + q[1] * st.crop.h];
const fromImg = p => [(p[0] - st.crop.x) / st.crop.w, (p[1] - st.crop.y) / st.crop.h];
function evtImg(e) { const r = cv.getBoundingClientRect(), d = view.d || 1; return [((e.clientX - r.left) * d - view.ox) / view.s, ((e.clientY - r.top) * d - view.oy) / view.s]; }
let drag = null;
cv.addEventListener('pointerdown', e => {
  if (!st.img) return; const p = evtImg(e);
  if (st.mode === 'poly') { const q = fromImg(p); if (q[0] < 0 || q[1] < 0 || q[0] > 1 || q[1] > 1) return; (st.drawing = st.drawing || []).push(q); drawImg(); return; }
  drag = { x0: p[0], y0: p[1] }; cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', e => {
  if (!drag) return; const p = evtImg(e), W = st.img.width, H = st.img.height;
  const x0 = Math.max(0, Math.min(drag.x0, p[0])), y0 = Math.max(0, Math.min(drag.y0, p[1])), x1 = Math.min(W, Math.max(drag.x0, p[0])), y1 = Math.min(H, Math.max(drag.y0, p[1]));
  if (x1 - x0 > 8 && y1 - y0 > 8) { st.crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; drawImg(); }
});
cv.addEventListener('pointerup', () => { if (drag) { drag = null; st.polys = []; renderPolys(); syncAspect('W'); updateInfo(); st.depthKey = null; } });
cv.addEventListener('dblclick', e => { if (st.mode === 'poly') finishPoly(); });
window.addEventListener('keydown', e => { if (st.mode === 'poly' && e.key === 'Enter') finishPoly(); if (e.key === 'Escape') { st.drawing = null; setMode('crop'); drawImg(); } });
function finishPoly() {
  if (st.drawing && st.drawing.length >= 3) { const pts = st.drawing.slice(0, st.drawing.length); st.polys.push({ id: 'p' + Date.now(), pts }); }
  st.drawing = null; setMode('crop'); renderPolys(); drawImg(); if (st.depthKey) runFocusAndCompose();
}
function setMode(m) { st.mode = m; $('btnPoly').classList.toggle('on', m === 'poly'); $('btnCrop').classList.toggle('on', m === 'crop'); cv.style.cursor = m === 'poly' ? 'copy' : 'crosshair'; }
$('btnCrop').onclick = () => { setMode('crop'); showTab('img'); };
$('btnFull').onclick = () => { if (!st.img) return; st.crop = { x: 0, y: 0, w: st.img.width, h: st.img.height }; st.polys = []; st.depthKey = null; renderPolys(); syncAspect('W'); updateInfo(); drawImg(); };
$('btnPoly').onclick = () => { if (!st.img) return; showTab('img'); st.drawing = []; setMode('poly'); setProg(0, 'คลิกรอบบริเวณทีละจุด · ดับเบิลคลิก หรือ Enter เพื่อจบ · Esc ยกเลิก'); };
function renderPolys() {
  const ul = $('polyList'); ul.innerHTML = '';
  st.polys.forEach((p, i) => { const li = document.createElement('li');
    li.innerHTML = `<i class="sw" style="background:${COLORS[i % COLORS.length]}"></i><span>บริเวณ ${i + 1} (${p.pts.length} จุด)</span><button class="ghost">ลบ</button>`;
    li.querySelector('button').onclick = () => { st.polys.splice(i, 1); st.focusDone.delete(p.id); renderPolys(); drawImg(); if (st.depthKey) scheduleCompose(true); };
    ul.appendChild(li); });
}

// ---------------- pipeline ----------------
function gridRGBA(img, s, isDetail) {
  const c = new OffscreenCanvas(s.w, s.h), g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  let cr = st.crop; if (isDetail) { const kx = img.width / st.img.width, ky = img.height / st.img.height; cr = { x: cr.x * kx, y: cr.y * ky, w: cr.w * kx, h: cr.h * ky }; }
  g.drawImage(img, cr.x, cr.y, cr.w, cr.h, 0, 0, s.w, s.h);
  return g.getImageData(0, 0, s.w, s.h).data;
}
function polyMask(p, s) {
  const c = new OffscreenCanvas(s.w, s.h), g = c.getContext('2d'); g.fillStyle = '#fff'; g.beginPath();
  p.pts.forEach((q, i) => { const x = q[0] * (s.w - 1), y = q[1] * (s.h - 1); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.fill();
  const a = g.getImageData(0, 0, s.w, s.h).data, m = new Uint8Array(s.w * s.h); for (let i = 0; i < m.length; i++) m[i] = a[i * 4 + 3] > 127 ? 1 : 0; return m;
}
async function ensureWorker() {
  if (st.workerReady) return;
  setProg(0.01, 'เริ่มโมเดล AI…');
  const r = await wcall('init', { modelGpu: MODEL_GPU, modelCpu: MODEL_CPU, device: $('device').value }, null, 'ready');
  st.workerReady = true; st.backend = r.backend;
}
$('btnRun').onclick = async () => {
  if (!st.img) { setProg(0, 'กรุณาเลือกรูปก่อน', true); return; }
  if (st.busy) return; st.busy = true; lockUI(true);
  try {
    await ensureWorker();
    const s = sizes(); const key = JSON.stringify([st.crop, s.w, s.h, s.res, $('quality').value]);
    if (st.depthKey !== key) {
      const t0 = performance.now(); const rgba = gridRGBA(st.img, s);
      // hi-res copy of the crop for the AI tiles (up to 3x the grid) so sharp photos keep their detail
      const k = Math.max(1, Math.min(3, st.crop.w / s.w, st.crop.h / s.h));
      let hires = null;
      if (k > 1.2) hires = await createImageBitmap(st.img, st.crop.x, st.crop.y, st.crop.w, st.crop.h, { resizeWidth: Math.round(s.w * k), resizeHeight: Math.round(s.h * k), resizeQuality: 'high' });
      const dr = await wcall('depth', { rgba: rgba.buffer, w: s.w, h: s.h, res: s.res, quality: $('quality').value, hires, k }, hires ? [rgba.buffer, hires] : [rgba.buffer], 'depthDone'); console.log('depth nan', JSON.stringify(dr.nan));
      st.depthKey = key; st.focusDone.clear(); st.w = s.w; st.h = s.h; st.res = s.res;
      console.log('depth', ((performance.now() - t0) / 1000).toFixed(1) + 's', st.backend);
    }
    await focusAll(); await composeNow(true);
  } catch (e) { console.error(e); setProg(0, 'ผิดพลาด: ' + e.message, true); }
  st.busy = false; lockUI(false);
};
async function focusAll() {
  const s = sizes();
  for (const p of st.polys) if (!st.focusDone.has(p.id)) {
    const m = polyMask(p, s); await wcall('focus', { id: p.id, mask: m.buffer }, [m.buffer], 'focusDone'); st.focusDone.add(p.id);
  }
}
async function runFocusAndCompose() { if (st.busy) return; st.busy = true; try { await focusAll(); await composeNow(true); } catch (e) { setProg(0, 'ผิดพลาด: ' + e.message, true); } st.busy = false; }
async function composeNow(sendDetail) {
  const s = sizes(); const msg = { params: Object.assign({}, st.params, { depth: s.depth }), focusIds: st.polys.map(p => p.id) };
  const tr = [];
  if (sendDetail) { if (st.detailImg) { const d = gridRGBA(st.detailImg, { w: st.w, h: st.h }, true); msg.detailRgba = d; tr.push(d.buffer); } else msg.clearDetail = true; }
  setProg(0.5, 'สร้างลายนูน…');
  const r = await wcall('compose', msg, tr, 'composed');
  st.Zc = r.Z; st.w = r.w; st.h = r.h;
  if (!st.E || st.E.length !== r.Z.length) { st.E = new Float32Array(r.Z.length); st.undo = []; }
  finalize();
  setProg(1, `เสร็จ (${(r.ms / 1000).toFixed(1)} วินาที${st.backend ? ' · ' + (st.backend === 'webgpu' ? 'GPU' : 'CPU') : ''}) — ปรับแถบเลื่อนได้ทันที`);
  $('btnSTL').disabled = $('btnPNG').disabled = false;
  if (curTab === 'img') showTab('hm'); else { drawHm(); if (curTab === '3d') build3D(); }
}
let ctimer = null, cdetail = false;
function scheduleCompose(now, detail) {
  if (!st.depthKey) return; cdetail = cdetail || !!detail; clearTimeout(ctimer);
  ctimer = setTimeout(async () => { if (st.busy) { scheduleCompose(false, cdetail); return; } st.busy = true; const d = cdetail; cdetail = false;
    try { await composeNow(d); } catch (e) { setProg(0, 'ผิดพลาด: ' + e.message, true); } st.busy = false; }, now ? 30 : 450);
}
function lockUI(on) { for (const id of ['btnRun', 'fileMain']) $(id).disabled = on; }

// final Z = composed relief + sculpt edits
function finalize() {
  const n = st.Zc.length, dep = sizes().depth; if (!st.Z || st.Z.length !== n) st.Z = new Float32Array(n);
  for (let i = 0; i < n; i++) st.Z[i] = Math.min(Math.max(st.Zc[i] + st.E[i], 0), dep);
  if (!st.shade || st.shade.length !== n) st.shade = new Uint8ClampedArray(n);
  Relief.hillshade(st.Z, st.w, st.h, st.res, st.shade);
}

// ---------------- back side (optional) ----------------
function backOn() { return $('backMode').value !== 'flat'; }
function solidFields() {
  const s = sizes(), w = st.w, h = st.h, res = st.res, n = w * h, Z = st.Z, mode = $('backMode').value;
  const bd = +$('backDepth').value, core = +$('core').value, cut = $('cutout').checked, thr = +$('cutThr').value;
  const inc = cut ? new Uint8Array(n) : null; if (cut) for (let i = 0; i < n; i++) inc[i] = Z[i] > thr ? 1 : 0;
  let B;
  if (mode === 'mirror') { B = new Float32Array(n); const k = bd / s.depth; for (let i = 0; i < n; i++) B[i] = Z[i] * k; }
  else {
    // rounded back: silhouette inflation (balloon) + broad forms of the front, no fine detail
    const M = inc || new Uint8Array(n).fill(1), inv = new Uint8Array(n);
    for (let i = 0; i < n; i++) inv[i] = M[i] ? 0 : 1;
    let dt;
    if (cut) dt = Relief.edt(inv, w, h);
    else { dt = new Float32Array(n); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) dt[j * w + i] = Math.min(i, j, w - 1 - i, h - 1 - j); }
    const R = Math.max(bd * 1.4, 4) / res, big = Relief.gauss(Z, w, h, 8 / res), mx = Relief.percentile(big, 99.5) || 1;
    B = new Float32Array(n);
    for (let i = 0; i < n; i++) { const pr = Math.sqrt(Math.min(dt[i] / R, 1)); B[i] = bd * (0.55 * pr + 0.45 * Math.min(big[i] / mx, 1) * pr); }
    B = Relief.gauss(B, w, h, 1.5 / res);
  }
  const top = new Float32Array(n), bot = new Float32Array(n), mid = bd + core / 2;
  for (let i = 0; i < n; i++) { top[i] = mid + core / 2 + Z[i]; bot[i] = mid - core / 2 - B[i]; }
  if (cut) for (let i = 0; i < n; i++) if (!inc[i]) { top[i] = bot[i] = mid; }
  return { top, bot, inc, total: bd + core + s.depth };
}
$('backMode').onchange = () => { $('backOpts').hidden = !backOn(); saveSize(); if (st.Z && curTab === '3d') build3D(); };
for (const id of ['backDepth', 'core', 'cutout']) $(id).addEventListener('change', () => { saveSize(); if (st.Z && curTab === '3d') build3D(); });
{ const c = $('cutThr'), v = () => $('v_cutThr').textContent = (+c.value).toFixed(1) + ' mm'; v(); c.oninput = v; c.onchange = () => { saveSize(); if (st.Z && curTab === '3d') build3D(); }; }

// ---------------- heightmap view ----------------
const ch = $('cvHm'), chx = ch.getContext('2d');
function drawHm() {
  fitCanvas(ch); chx.setTransform(1, 0, 0, 1, 0, 0); chx.clearRect(0, 0, ch.width, ch.height);
  if (!st.Z) return; const w = st.w, h = st.h, im = new ImageData(w, h), mir = $('mirror').checked, gray = $('hmGray').checked, dep = sizes().depth;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = j * w + (mir ? w - 1 - i : i), o = (j * w + i) * 4;
    const v = gray ? Math.min(255, st.Z[k] / dep * 255) : st.shade[k]; im.data[o] = im.data[o + 1] = im.data[o + 2] = v; im.data[o + 3] = 255; }
  const tmp = new OffscreenCanvas(w, h); tmp.getContext('2d').putImageData(im, 0, 0);
  const s = Math.min(ch.width / w, ch.height / h) * 0.96; chx.imageSmoothingQuality = 'high';
  chx.drawImage(tmp, (ch.width - w * s) / 2, (ch.height - h * s) / 2, w * s, h * s);
}
$('hmGray').onchange = drawHm;

// ---------------- 3D view + sculpt brushes ----------------
let R3 = null;
const sc = { tool: 'orbit', active: false, start: 0, last: null };
function init3D() {
  const el = $('v3d'), renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); el.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(getComputedStyle(document.body).getPropertyValue('--stage').trim() || '#e9e5de');
  const cam = new THREE.PerspectiveCamera(35, 1, 1, 50000); cam.up.set(0, 0, 1);
  const ctl = new OrbitControls(cam, renderer.domElement); ctl.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7); scene.add(sun); scene.add(sun.target);
  const cursor = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicMaterial({ color: 0xff6a00, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 }));
  cursor.visible = false; cursor.renderOrder = 10; scene.add(cursor);
  R3 = { renderer, scene, cam, ctl, sun, group: null, front: null, cursor, ray: new THREE.Raycaster() };
  const loop = () => { requestAnimationFrame(loop); if (curTab !== '3d') return; const r = el.getBoundingClientRect();
    if (renderer.domElement.width !== Math.round(r.width * renderer.getPixelRatio())) { renderer.setSize(r.width, r.height, false); cam.aspect = r.width / r.height; cam.updateProjectionMatrix(); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'; }
    ctl.update(); renderer.render(scene, cam); };
  loop();
  const dom = renderer.domElement;
  dom.addEventListener('contextmenu', e => e.preventDefault());
  dom.addEventListener('pointerdown', e => {
    if (sc.tool === 'orbit' || e.button !== 0) return;
    const hit = pick(e); if (!hit) return;
    e.stopImmediatePropagation(); ctl.enabled = false; dom.setPointerCapture(e.pointerId);
    st.undo.push(Float32Array.from(st.E)); if (st.undo.length > 15) st.undo.shift();
    const g = gridOf(hit); sc.active = true; sc.start = st.Z[g.k]; sc.last = g; dab(g);
  }, true);
  dom.addEventListener('pointermove', e => {
    const hit = sc.tool !== 'orbit' ? pick(e) : null; showCursor(hit);
    if (!sc.active || !hit) return; const g = gridOf(hit);
    const d = Math.hypot(g.i - sc.last.i, g.j - sc.last.j), spacing = Math.max(1, (+$('brushR').value / st.res) * 0.25);
    const steps = Math.max(1, Math.floor(d / spacing));
    for (let s = 1; s <= steps; s++) { const t = s / steps; dab({ i: sc.last.i + (g.i - sc.last.i) * t, j: sc.last.j + (g.j - sc.last.j) * t }); }
    sc.last = g;
  });
  const end = () => { if (!sc.active) return; sc.active = false; ctl.enabled = true; refreshAfterSculpt(true); };
  dom.addEventListener('pointerup', end); dom.addEventListener('pointerleave', () => { showCursor(null); end(); });
}
function pick(e) {
  if (!R3.front) return null; const r = R3.renderer.domElement.getBoundingClientRect();
  const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  R3.ray.setFromCamera(v, R3.cam); const h = R3.ray.intersectObject(R3.front, false); return h.length ? h[0] : null;
}
function gridOf(hit) {
  const s = sizes(), F = backOn() ? 0 : s.F, Hm = (st.h - 1) * st.res;
  let i = (hit.point.x - F) / st.res, j = (F + Hm - hit.point.y) / st.res;
  if ($('mirror').checked) i = st.w - 1 - i;
  i = Math.min(Math.max(i, 0), st.w - 1); j = Math.min(Math.max(j, 0), st.h - 1);
  return { i, j, k: Math.round(j) * st.w + Math.round(i) };
}
function showCursor(hit) {
  const c = R3.cursor; if (!hit) { c.visible = false; return; }
  const r = +$('brushR').value; c.visible = true; c.scale.set(r, r, r);
  c.position.copy(hit.point).add(new THREE.Vector3(0, 0, 0.3));
  if (hit.face) { const n = hit.face.normal.clone(); c.lookAt(c.position.clone().add(n)); }
}
// one brush dab at grid coords (i,j)
function dab(g) {
  const w = st.w, h = st.h, res = st.res, R = +$('brushR').value / res, S = +$('brushS').value, dep = sizes().depth;
  const i0 = Math.max(0, Math.floor(g.i - R)), i1 = Math.min(w - 1, Math.ceil(g.i + R)), j0 = Math.max(0, Math.floor(g.j - R)), j1 = Math.min(h - 1, Math.ceil(g.j + R));
  const amt = S * 0.6, tool = sc.tool;
  let avg = 0;
  if (tool === 'smooth') { // local mean of final surface (small kernel) per pixel
    const pw = i1 - i0 + 1, ph = j1 - j0 + 1, src = new Float32Array(pw * ph);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) src[(j - j0) * pw + i - i0] = st.Z[j * w + i];
    const bl = Relief.gauss(src, pw, ph, Math.max(1, R * 0.25));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i - g.i, j - g.j) / R; if (d >= 1) continue; const f = 0.5 + 0.5 * Math.cos(Math.PI * d), k = j * w + i;
      st.E[k] += (bl[(j - j0) * pw + i - i0] - st.Z[k]) * Math.min(1, S * 1.5) * f;
      st.Z[k] = Math.min(Math.max(st.Zc[k] + st.E[k], 0), dep);
    }
  } else {
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i - g.i, j - g.j) / R; if (d >= 1) continue; const f = 0.5 + 0.5 * Math.cos(Math.PI * d), k = j * w + i;
      if (tool === 'raise') st.E[k] += amt * f;
      else if (tool === 'lower') st.E[k] -= amt * f;
      else if (tool === 'flatten') st.E[k] += (sc.start - st.Z[k]) * Math.min(1, S * 1.5) * f;
      else if (tool === 'erase') st.E[k] *= 1 - Math.min(1, S * 1.5) * f;
      st.Z[k] = Math.min(Math.max(st.Zc[k] + st.E[k], 0), dep);
    }
  }
  updateFrontRegion(i0, i1, j0, j1);
}
let normTimer = null;
function updateFrontRegion(i0, i1, j0, j1) {
  if (!R3.front || backOn()) return; const m = R3.meta, pos = R3.front.geometry.attributes.position, s = sizes();
  const base = Math.max(0.5, s.T - s.depth), mir = $('mirror').checked;
  for (let jj = Math.floor(j0 / m.step); jj <= Math.ceil(j1 / m.step) && jj < m.gh; jj++) for (let ii = 0; ii < m.gw; ii++) {
    const si = Math.min(ii * m.step, st.w - 1), src = mir ? st.w - 1 - si : si; if (src < i0 - m.step || src > i1 + m.step) continue;
    const sj = Math.min(jj * m.step, st.h - 1); pos.setZ(jj * m.gw + ii, base + st.Z[sj * st.w + src]);
  }
  pos.needsUpdate = true; clearTimeout(normTimer); normTimer = setTimeout(() => R3.front.geometry.computeVertexNormals(), 60);
}
function refreshAfterSculpt(full) {
  Relief.hillshade(st.Z, st.w, st.h, st.res, st.shade);
  if (R3 && R3.front) R3.front.geometry.computeVertexNormals();
  if (full && backOn()) build3D();
}
document.querySelectorAll('#sculptBar [data-tool]').forEach(b => b.onclick = () => {
  sc.tool = b.dataset.tool; document.querySelectorAll('#sculptBar [data-tool]').forEach(x => x.classList.toggle('on', x === b));
  if (R3) R3.cursor.visible = false;
});
for (const [id, u] of [['brushR', ' mm'], ['brushS', '']]) { const el = $(id), v = () => $('v_' + id).textContent = (+el.value).toFixed(id === 'brushS' ? 2 : 1) + u; v(); el.oninput = v; }
$('btnUndo').onclick = () => { if (!st.undo || !st.undo.length) return; st.E = st.undo.pop(); finalize(); build3D(); };
$('btnClearEd').onclick = () => { if (!st.E) return; st.undo.push(Float32Array.from(st.E)); st.E.fill(0); finalize(); build3D(); };

function surfaceGeom(field, step, gw, gh, F, flipNormal) {
  const w = st.w, h = st.h, res = st.res, Hm = (h - 1) * res, mir = $('mirror').checked;
  const pos = new Float32Array(gw * gh * 3);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const si = Math.min(i * step, w - 1), sj = Math.min(j * step, h - 1), k = (j * gw + i) * 3;
    pos[k] = F + si * res; pos[k + 1] = F + Hm - sj * res; pos[k + 2] = field(sj * w + (mir ? w - 1 - si : si)); }
  const idx = new Uint32Array((gw - 1) * (gh - 1) * 6); let t = 0;
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) { const a = j * gw + i, b = a + 1, c = a + gw, d = c + 1;
    if (flipNormal) { idx[t++] = a; idx[t++] = b; idx[t++] = c; idx[t++] = b; idx[t++] = d; idx[t++] = c; }
    else { idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d; } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
  return g;
}
function build3D() {
  if (!st.Z) return; if (!R3) init3D();
  $('sculptBar').hidden = false;
  const s = sizes(), w = st.w, h = st.h, res = st.res, Hm = (h - 1) * res;
  const step = Math.max(1, Math.ceil(Math.sqrt(w * h / 900000))), gw = Math.floor((w - 1) / step) + 1, gh = Math.floor((h - 1) / step) + 1;
  const mat = new THREE.MeshStandardMaterial({ color: 0xe8dcc8, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  if (R3.group) { R3.scene.remove(R3.group); R3.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  const grp = new THREE.Group(); let PW, PH, PT;
  if (!backOn()) {
    const F = s.F, base = Math.max(0.5, s.T - s.depth);
    R3.front = new THREE.Mesh(surfaceGeom(k => base + st.Z[k], step, gw, gh, F, false), mat); grp.add(R3.front);
    PW = (w - 1) * res + 2 * F; PH = Hm + 2 * F; PT = s.T;
    if (F > 0) for (const [x, y, bw, bh] of [[F / 2, PH / 2, F, PH], [PW - F / 2, PH / 2, F, PH], [PW / 2, F / 2, PW - 2 * F, F], [PW / 2, PH - F / 2, PW - 2 * F, F]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, s.T), mat); m.position.set(x, y, s.T / 2); grp.add(m); }
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(PW, PH, base), mat); bottom.position.set(PW / 2, PH / 2, base / 2); grp.add(bottom);
  } else {
    const sf = solidFields(); PW = (w - 1) * res; PH = Hm; PT = sf.total;
    const cutVal = sf.inc ? (k => sf.inc[k]) : null;
    const topF = k => cutVal && !cutVal(k) ? NaN : sf.top[k], botF = k => cutVal && !cutVal(k) ? NaN : sf.bot[k];
    const gT = surfaceGeom(topF, step, gw, gh, 0, false), gB = surfaceGeom(botF, step, gw, gh, 0, true);
    if (cutVal) for (const g of [gT, gB]) dropNaN(g);
    R3.front = new THREE.Mesh(gT, mat); grp.add(R3.front); grp.add(new THREE.Mesh(gB, mat));
  }
  R3.meta = { step, gw, gh };
  R3.scene.add(grp); R3.group = grp;
  const ctr = new THREE.Vector3(PW / 2, PH / 2, PT / 2), span = Math.max(PW, PH);
  const key = PW.toFixed(0) + 'x' + PH.toFixed(0);
  if (R3.fitted !== key) { R3.cam.position.set(PW / 2 - span * 0.3, PH / 2 - span * 1.05, span * 1.25); R3.ctl.target.copy(ctr); R3.fitted = key; }
  R3.sun.position.set(-span * 0.4, PH + span * 0.5, span * 0.8); R3.sun.target.position.copy(ctr);
}
function dropNaN(g) {  // remove triangles touching cut-away vertices
  const p = g.attributes.position.array, idx = g.index.array, keep = [];
  for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (!isNaN(p[a * 3 + 2]) && !isNaN(p[b * 3 + 2]) && !isNaN(p[c * 3 + 2])) keep.push(a, b, c); }
  for (let i = 2; i < p.length; i += 3) if (isNaN(p[i])) p[i] = 0;
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(keep), 1)); g.computeVertexNormals();
}

// ---------------- tabs ----------------
let curTab = 'img';
function showTab(t) {
  curTab = t; document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('cvImg').classList.toggle('on', t === 'img'); $('cvHm').classList.toggle('on', t === 'hm'); $('v3d').classList.toggle('on', t === '3d');
  $('hmMode').hidden = t !== 'hm'; $('sculptBar').hidden = t !== '3d' || !st.Z;
  if (t === 'img') drawImg(); if (t === 'hm') drawHm(); if (t === '3d') build3D();
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
window.addEventListener('resize', () => { if (curTab === 'img') drawImg(); if (curTab === 'hm') drawHm(); });

// ---------------- export ----------------
function dl(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }
const baseName = () => { const s = sizes(); return `relief_${s.W}x${s.H}x${s.T}`; };
$('btnSTL').onclick = async () => {
  if (!st.Z) return; setProg(0.3, 'กำลังสร้าง STL…'); await new Promise(r => setTimeout(r, 30));
  const s = sizes(); let blob;
  if (backOn()) { const sf = solidFields(); blob = buildSolid(sf.top, sf.bot, st.w, st.h, st.res, sf.inc, $('mirror').checked); }
  else blob = buildSTL(st.Z, st.w, st.h, st.res, { thickness: s.T, depth: s.depth, frame: s.F, mirror: $('mirror').checked });
  dl(blob, baseName() + '.stl'); setProg(1, `ส่งออก STL แล้ว (${(blob.size / 1e6).toFixed(0)} MB)`);
};
$('btnPNG').onclick = async () => {
  if (!st.Z) return; setProg(0.3, 'กำลังสร้าง heightmap…');
  const blob = await buildPNG16(st.Z, st.w, st.h, sizes().depth, $('mirror').checked);
  dl(blob, baseName() + `_relief${sizes().depth}mm_16bit.png`); setProg(1, 'ส่งออก heightmap 16-bit แล้ว (ขาว = สูงสุด ' + sizes().depth + ' mm)');
};
$('btnSaveP').onclick = () => { const o = { params: st.params, size: {} }; for (const id of sizeIds) o.size[id] = $(id).value; dl(new Blob([JSON.stringify(o, null, 2)], { type: 'application/json' }), 'relief_settings.json'); };
$('fileP').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const o = JSON.parse(await f.text());
  if (o.params) st.params = Object.assign({ ...DEFAULTS }, o.params); if (o.size) for (const id of sizeIds) if (o.size[id] !== undefined) $(id).value = o.size[id];
  save('rs_params', st.params); saveSize(); buildSliders(); updateInfo(); scheduleCompose(true); } catch (err) { setProg(0, 'ไฟล์ค่าไม่ถูกต้อง', true); } };
$('btnHelp').onclick = () => $('help').showModal();

// test hook
window.__rs = { st, sizes, showTab, build3D };
buildSliders(); updateInfo(); setMode('crop');
