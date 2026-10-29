import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildPNG16, buildSolid, buildOBJ, watermark } from './export.js';
import { zipFiles, unzip } from './zip.js';
import { verifyKey } from './license.js';
const Relief = window.Relief, Ops = window.ReliefOps;

// ================= config =================
const HF = 'https://huggingface.co/';
const MODELS = {
  small: { gpu: HF + 'onnx-community/depth-anything-v2-small/resolve/main/onnx/model_fp16.onnx', cpu: HF + 'onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx' },
  base: { gpu: HF + 'onnx-community/depth-anything-v2-base/resolve/main/onnx/model_fp16.onnx', cpu: HF + 'onnx-community/depth-anything-v2-base/resolve/main/onnx/model_quantized.onnx' },
};
const CUTOUT = { gpu: HF + 'onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model_fp16.onnx', cpu: HF + 'onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model_fp16.onnx' };  // fp16 also on CPU: fp32 exceeds WASM memory
const UPSCALE = { gpu: HF + 'Xenova/swin2SR-classical-sr-x2-64/resolve/main/onnx/model.onnx', cpu: HF + 'Xenova/swin2SR-classical-sr-x2-64/resolve/main/onnx/model.onnx' };
const qs = new URLSearchParams(location.search);
if (qs.get('model')) MODELS.custom = { gpu: qs.get('model'), cpu: qs.get('modelcpu') || qs.get('model') };
if (qs.get('cutout')) CUTOUT.gpu = CUTOUT.cpu = qs.get('cutout');
if (qs.get('upscale')) UPSCALE.gpu = UPSCALE.cpu = qs.get('upscale');

const DEFAULTS = {
  photo: 0.6, detailFine: 2.0, alpha: 3.0, lam: 1.2, wFull: 2.2, wFine: 1.0, grooveDepth: 1.3, grooveSens: 0.07,
  smooth: 0.45, finalSmooth: 0.5, envelope: 0.85, zeroPlane: 0, shape: 1.0, focusHeight: 9, focusSharp: 2.0
};
const SLIDERS = [
  ['photo', 'รายละเอียดจากภาพ', 0, 1.5, 0.05, ''], ['detailFine', 'ขนาดรายละเอียด', 1, 4, 0.1, 'mm'],
  ['wFine', 'รายละเอียดจาก AI ซูม', 0, 2, 0.05, ''], ['wFull', 'ความเด่นของตัวหลัก', 0, 4, 0.1, ''],
  ['alpha', 'บีบระดับสูง–ต่ำ', 0.5, 8, 0.1, ''], ['lam', 'เน้นทรงรอง', 0, 3, 0.05, ''],
  ['grooveDepth', 'ความลึกร่อง V', 0, 3, 0.05, 'mm'], ['grooveSens', 'ความไวร่อง (น้อย = ร่องมาก)', 0.03, 0.15, 0.005, ''],
  ['smooth', 'ความเนียนผิว', 0, 1.5, 0.05, 'mm'], ['finalSmooth', 'เกลี่ยสุดท้าย', 0, 1.5, 0.05, 'mm'],
  ['envelope', 'ยกบริเวณที่ต่ำ', 0, 1, 0.05, ''], ['zeroPlane', 'Zero plane (ตัดพื้น)', 0, 0.6, 0.01, ''],
  ['shape', 'Shape (มน ↔ คม)', 0.5, 2, 0.05, ''], ['focusHeight', 'ความสูงบริเวณปั้น', 0, 15, 0.5, 'mm'],
  ['focusSharp', 'ความคมบริเวณปั้น', 0, 4, 0.1, ''],
];
const PRESETS = {
  'ไม้แกะสลักไทย': {},
  'นูนต่ำ เรียบ': { alpha: 5, photo: 0.4, grooveDepth: 0.8, smooth: 0.8, finalSmooth: 0.8, wFull: 1.6 },
  'คมชัดสูง': { photo: 0.9, grooveDepth: 1.8, lam: 1.6, smooth: 0.3, finalSmooth: 0.35, detailFine: 1.6 },
  'พื้นเรียบ (ตัดพื้น)': { zeroPlane: 0.18, envelope: 0.6 },
  'ปั้นนุ่ม (ประติมากรรม)': { photo: 0.3, grooveDepth: 0.4, lam: 0.8, smooth: 1.0, finalSmooth: 0.9, alpha: 2.2 },
  'เหรียญ/ตรา': { alpha: 6, photo: 0.7, grooveDepth: 0.6, lam: 1.5, wFull: 1.4, smooth: 0.35 },
  'ป้ายไม้ ตัวนูน': { zeroPlane: 0.3, shape: 0.8, grooveDepth: 0.3, photo: 0.3, smooth: 0.6 },
};
const OPS_DEF = { curve: [0, 0.25, 0.5, 0.75, 1], fade: { amt: 0, dir: 'top' }, tilt: { x: 0, y: 0 }, dome: { amt: 0, type: 'dome' },
  tex: { type: 'wood', amt: 0, scale: 3, angle: 0, where: 'bg', thr: 4 }, flatten: { on: false, level: 0 } };
const FRAME_DEF = { shape: 'rect', radius: 30, molding: 'flat', moldDepth: 4, moldW: 0, edge: 'vertical', edgeW: 3, outerRound: 0 };
const CNC_DEF = { finDia: 3, finStep: 10, feed: 3000, roughDia: 6, roughStep: 40, stepDown: 3, simDia: 3, tileLen: 1200, tileOv: 0 };
const COLORS = ['#e4572e', '#29a3a3', '#f3a712', '#7b2cbf', '#2e86de', '#2f9e44'];

// ================= state =================
const $ = id => document.getElementById(id);
const clone = o => JSON.parse(JSON.stringify(o));
function load(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ? Object.assign(d, v) : d; } catch (e) { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
const st = {
  img: null, detailImg: null, crop: null, polys: [], params: load('rs_params', { ...DEFAULTS }),
  ops: load('rs_ops', clone(OPS_DEF)), frame: load('rs_frame', { ...FRAME_DEF }), cnc: load('rs_cnc', { ...CNC_DEF }),
  layers: [], cutMask: null, w: 0, h: 0, res: 0.5, Zc: null, Zo: null, E: null, Mk: null, Z: null, plate: null, shade: null, sim: null,
  depthKey: null, busy: false, workerReady: false, mode: 'crop', drawing: null, focusDone: new Set(), undo: [], redo: [], lic: null, backend: null
};
for (const k of Object.keys(OPS_DEF)) if (st.ops[k] === undefined) st.ops[k] = clone(OPS_DEF[k]);

// ================= worker =================
let worker, waiters = {};
function newWorker() { if (worker) worker.terminate(); worker = new Worker(new URL('./worker.js', import.meta.url)); worker.onmessage = onWorker; st.workerReady = false; waiters = {}; }
function wcall(type, data, transfer, done) { return new Promise((res, rej) => { waiters[done] = { res, rej }; worker.postMessage(Object.assign({ type }, data), transfer || []); }); }
function onWorker(e) {
  const m = e.data;
  if (m.type === 'progress') { setProg(m.frac, m.text); return; }
  if (m.type === 'error') { const ws = Object.values(waiters); waiters = {}; setProg(0, 'ผิดพลาด: ' + m.message, true); ws.forEach(w => w.rej(new Error(m.message))); return; }
  const w = waiters[m.type]; if (w) { delete waiters[m.type]; w.res(m); }
}
newWorker();
function setProg(f, t, err) { $('pbar').style.width = Math.round((f || 0) * 100) + '%'; $('ptext').textContent = t || ''; $('ptext').style.color = err ? 'var(--err)' : ''; }
async function ensureWorker() {
  if (st.workerReady) return;
  const m = MODELS.custom || MODELS[$('model').value];
  setProg(0.01, 'เริ่มโมเดล AI…');
  const r = await wcall('init', { modelGpu: m.gpu, modelCpu: m.cpu, device: $('device').value }, null, 'ready');
  st.workerReady = true; st.backend = r.backend;
}
$('model').onchange = () => { st.depthKey = null; newWorker(); saveSize();
  $('aiInfo').textContent = $('model').value === 'base' ? 'Base ละเอียดกว่า แต่ใบอนุญาต CC-BY-NC ห้ามใช้ทำงานขาย/เชิงพาณิชย์' : 'ครั้งแรกจะดาวน์โหลดโมเดล AI แล้วเก็บไว้ในเครื่อง'; };
$('device').onchange = () => { st.depthKey = null; newWorker(); saveSize(); };

// ================= generic controls =================
function controls(box, spec, obj, onChange) {
  box.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className = 'ctl'; box.appendChild(wrap);
  for (const c of spec) {
    if (c.sub) { const d = document.createElement('div'); d.className = 'sub full'; d.textContent = c.sub; wrap.appendChild(d); continue; }
    const [path, label, type, a, b, stp, unit] = c; const keys = path.split('.');
    const get = () => keys.reduce((o, k) => o[k], obj), set = v => { let o = obj; for (const k of keys.slice(0, -1)) o = o[k]; o[keys[keys.length - 1]] = v; };
    if (type === 'range') {
      const d = document.createElement('div'); d.className = 'sl full';
      d.innerHTML = `<div class="lab"><span>${label}</span><b></b></div><input type="range" min="${a}" max="${b}" step="${stp}">`;
      const inp = d.querySelector('input'), show = () => d.querySelector('b').textContent = (+inp.value).toFixed(stp < 0.1 ? 2 : stp < 1 ? 1 : 0) + (unit ? ' ' + unit : '');
      inp.value = get(); show(); inp.oninput = () => { set(+inp.value); show(); onChange(); }; wrap.appendChild(d);
    } else if (type === 'select') {
      const l = document.createElement('label'); l.innerHTML = `${label}<select></select>`; const sel = l.querySelector('select');
      for (const [v, t] of Object.entries(a)) sel.add(new Option(t, v)); sel.value = get(); sel.onchange = () => { set(sel.value); onChange(); }; wrap.appendChild(l);
    } else if (type === 'number') {
      const l = document.createElement('label'); l.innerHTML = `${label}<input type="number" min="${a}" max="${b}" step="${stp}">`; const inp = l.querySelector('input');
      inp.value = get(); inp.onchange = () => { set(+inp.value); onChange(); }; wrap.appendChild(l);
    } else if (type === 'check') {
      const l = document.createElement('label'); l.className = 'chk full'; l.innerHTML = `<input type="checkbox"> ${label}`; const inp = l.querySelector('input');
      inp.checked = !!get(); inp.onchange = () => { set(inp.checked); onChange(); }; wrap.appendChild(l);
    }
  }
}
const FX_SPEC = [
  { sub: 'ไล่ระดับ (Fade)' }, ['fade.amt', 'ความแรงไล่ระดับ', 'range', 0, 1, 0.01, ''], ['fade.dir', 'ทิศ', 'select', { top: 'จางลงด้านล่าง', bottom: 'จางลงด้านบน', left: 'จางลงด้านขวา', right: 'จางลงด้านซ้าย', center: 'จางเข้ากลาง', edge: 'จางออกขอบ' }],
  { sub: 'เอียง & โค้งทั้งแผ่น' }, ['tilt.x', 'เอียงซ้าย–ขวา', 'range', -10, 10, 0.1, 'mm'], ['tilt.y', 'เอียงบน–ล่าง', 'range', -10, 10, 0.1, 'mm'],
  ['dome.amt', 'ความโค้ง', 'range', -10, 10, 0.1, 'mm'], ['dome.type', 'แบบโค้ง', 'select', { dome: 'โดม', cylX: 'ทรงกระบอก (แนวตั้ง)', cylY: 'ทรงกระบอก (แนวนอน)', saddle: 'อานม้า' }],
  { sub: 'พื้นผิว (Texture)' }, ['tex.type', 'ลาย', 'select', Ops.TEXTURES], ['tex.where', 'ใส่ที่', 'select', { bg: 'เฉพาะพื้นหลัง', all: 'ทั้งชิ้น', mask: 'ตามมาสก์ที่ทา' }],
  ['tex.amt', 'ความลึกพื้นผิว', 'range', 0, 2, 0.05, 'mm'], ['tex.scale', 'ขนาดลาย', 'range', 0.5, 20, 0.1, 'mm'],
  ['tex.angle', 'มุมลาย', 'range', -90, 90, 1, '°'], ['tex.thr', 'ระดับนับเป็นพื้นหลัง', 'range', 0.5, 15, 0.1, 'mm'],
  { sub: 'พื้นหลังจาก AI แยกตัวลาย' }, ['flatten.on', 'ทำพื้นหลังเรียบตามขอบ AI', 'check'], ['flatten.level', 'ระดับพื้น', 'range', 0, 10, 0.1, 'mm'],
];
const FRAME_SPEC = [
  ['shape', 'รูปทรงช่องลาย', 'select', Ops.SHAPES], ['radius', 'รัศมีมุม', 'number', 0, 500, 1],
  ['molding', 'คิ้วบัวกรอบ', 'select', Ops.MOLDINGS], ['moldDepth', 'ความลึกคิ้ว (mm)', 'number', 0, 30, 0.5],
  ['moldW', 'ความกว้างคิ้ว (0 = เท่ากรอบ)', 'number', 0, 200, 1], ['edge', 'ขอบช่องลาย', 'select', Ops.EDGES],
  ['edgeW', 'ความกว้างขอบ (mm)', 'number', 0, 40, 0.5], ['outerRound', 'ลบมุมขอบนอก (mm)', 'number', 0, 20, 0.5],
];
const CNC_SPEC = [
  { sub: 'จำลองดอก' }, ['simDia', 'ดอกบอล Ø (mm)', 'number', 0.2, 25, 0.1],
  { sub: 'ประเมินเวลา' }, ['finDia', 'ดอกเก็บละเอียด Ø', 'number', 0.2, 25, 0.1], ['finStep', 'Stepover (%)', 'number', 1, 60, 1],
  ['roughDia', 'ดอกหยาบ Ø', 'number', 1, 50, 0.5], ['roughStep', 'Stepover หยาบ (%)', 'number', 5, 90, 1],
  ['stepDown', 'กินลึกต่อชั้น (mm)', 'number', 0.2, 30, 0.1], ['feed', 'ฟีด (mm/min)', 'number', 100, 30000, 50],
  { sub: 'แบ่งท่อนตามโต๊ะเครื่อง' }, ['tileLen', 'ยาวสูงสุดต่อท่อน (mm)', 'number', 50, 5000, 10], ['tileOv', 'ซ้อนกัน (mm)', 'number', 0, 50, 1],
];
function buildPanels() {
  controls($('fxCtl'), FX_SPEC, st.ops, () => { save('rs_ops', st.ops); scheduleRecompute(); });
  controls($('frameCtl'), FRAME_SPEC, st.frame, () => { save('rs_frame', st.frame); scheduleRecompute(); });
  controls($('cncCtl'), CNC_SPEC, st.cnc, () => save('rs_cnc', st.cnc));
}

// ---- compose sliders & presets ----
function buildSliders() {
  const box = $('sliders'); box.innerHTML = '';
  for (const [k, lab, mn, mx, stp, unit] of SLIDERS) {
    const d = document.createElement('div'); d.className = 'sl';
    d.innerHTML = `<div class="lab"><span>${lab}</span><b id="v_${k}"></b></div><input type="range" id="s_${k}" min="${mn}" max="${mx}" step="${stp}">`;
    box.appendChild(d); const inp = d.querySelector('input'); inp.value = st.params[k];
    const show = () => $('v_' + k).textContent = (+inp.value).toFixed(stp < 0.01 ? 3 : stp < 0.1 ? 2 : 1) + (unit ? ' ' + unit : ''); show();
    inp.addEventListener('input', () => { st.params[k] = +inp.value; show(); save('rs_params', st.params); scheduleCompose(); });
  }
  const pb = $('presets'); pb.innerHTML = '';
  for (const name of Object.keys(PRESETS)) { const b = document.createElement('button'); b.textContent = name; b.className = 'ghost';
    b.onclick = () => { st.params = Object.assign({ ...DEFAULTS }, PRESETS[name]); save('rs_params', st.params); buildSliders(); scheduleCompose(true); }; pb.appendChild(b); }
}
$('btnReset').onclick = () => { st.params = { ...DEFAULTS }; save('rs_params', st.params); buildSliders(); scheduleCompose(true); };

// ---- curve editor ----
const cvC = $('curve'), cc = cvC.getContext('2d');
function drawCurve() {
  const W = cvC.width, H = cvC.height, pad = 10, ys = st.ops.curve, lut = Ops.curveLUT(ys), css = getComputedStyle(document.body);
  cc.clearRect(0, 0, W, H); cc.strokeStyle = css.getPropertyValue('--line'); cc.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const x = pad + i * (W - 2 * pad) / 4, y = pad + i * (H - 2 * pad) / 4; cc.beginPath(); cc.moveTo(x, pad); cc.lineTo(x, H - pad); cc.moveTo(pad, y); cc.lineTo(W - pad, y); cc.stroke(); }
  cc.strokeStyle = css.getPropertyValue('--acc'); cc.lineWidth = 2; cc.beginPath();
  for (let k = 0; k <= 200; k++) { const t = k / 200, x = pad + t * (W - 2 * pad), y = H - pad - lut[Math.round(t * 1024)] * (H - 2 * pad); k ? cc.lineTo(x, y) : cc.moveTo(x, y); } cc.stroke();
  cc.fillStyle = css.getPropertyValue('--acc2');
  ys.forEach((v, i) => { cc.beginPath(); cc.arc(pad + i / 4 * (W - 2 * pad), H - pad - v * (H - 2 * pad), 5, 0, 7); cc.fill(); });
  cc.fillStyle = css.getPropertyValue('--mut'); cc.font = '10px sans-serif'; cc.fillText('ต่ำ', pad + 2, H - 2); cc.fillText('สูง', W - pad - 16, H - 2);
}
let cdrag = -1;
cvC.addEventListener('pointerdown', e => { const r = cvC.getBoundingClientRect(), x = (e.clientX - r.left) / r.width; cdrag = Math.max(0, Math.min(4, Math.round(x * 4))); cvC.setPointerCapture(e.pointerId); cmove(e); });
cvC.addEventListener('pointermove', e => { if (cdrag >= 0) cmove(e); });
cvC.addEventListener('pointerup', () => { cdrag = -1; save('rs_ops', st.ops); });
function cmove(e) { const r = cvC.getBoundingClientRect(), y = 1 - (e.clientY - r.top) / r.height; st.ops.curve[cdrag] = Math.max(0, Math.min(1, (y * cvC.height - 10) / (cvC.height - 20))); drawCurve(); scheduleRecompute(); }
$('curveReset').onclick = () => { st.ops.curve = [0, 0.25, 0.5, 0.75, 1]; drawCurve(); save('rs_ops', st.ops); scheduleRecompute(); };
$('curvePreset').onchange = e => { const p = { soft: [0, 0.32, 0.6, 0.82, 0.95], punch: [0, 0.18, 0.55, 0.85, 1], low: [0.08, 0.3, 0.52, 0.76, 1], s: [0, 0.15, 0.5, 0.85, 1] }[e.target.value];
  if (p) { st.ops.curve = p.slice(); drawCurve(); save('rs_ops', st.ops); scheduleRecompute(); } e.target.value = ''; };

// ---- layers ----
$('fileLayer').onchange = async e => { const f = e.target.files[0]; if (!f) return; const bmp = await createImageBitmap(f);
  st.layers.push({ id: 'L' + Date.now(), name: f.name, bmp, mode: 'add', height: 3, invert: false, enabled: true, data: null }); e.target.value = ''; renderLayers(); scheduleRecompute(); };
function layerData(L) {
  if (L.data && L.data.length === st.w * st.h) return L.data;
  const c = new OffscreenCanvas(st.w, st.h), g = c.getContext('2d'); g.drawImage(L.bmp, 0, 0, st.w, st.h);
  const a = g.getImageData(0, 0, st.w, st.h).data, d = new Float32Array(st.w * st.h); for (let i = 0; i < d.length; i++) d[i] = (a[i * 4] * 0.299 + a[i * 4 + 1] * 0.587 + a[i * 4 + 2] * 0.114) / 255;
  return (L.data = d);
}
function renderLayers() {
  const ul = $('layerList'); ul.innerHTML = '';
  st.layers.forEach((L, i) => { const li = document.createElement('li'); li.className = 'layer';
    li.innerHTML = `<input type="checkbox" ${L.enabled ? 'checked' : ''}><span title="${L.name}">${L.name.slice(0, 16)}</span>
      <select><option value="add">บวก</option><option value="sub">ลบ</option><option value="max">สูงสุด</option><option value="min">ต่ำสุด</option><option value="replace">แทนที่</option></select>
      <input type="number" step="0.5" value="${L.height}" style="width:56px"> mm <label class="chk mini"><input type="checkbox" ${L.invert ? 'checked' : ''}>กลับ</label><button class="ghost">ลบ</button>`;
    const [en, , hgt, inv] = li.querySelectorAll('input'), sel = li.querySelector('select'); sel.value = L.mode;
    en.onchange = () => { L.enabled = en.checked; scheduleRecompute(); }; sel.onchange = () => { L.mode = sel.value; scheduleRecompute(); };
    hgt.onchange = () => { L.height = +hgt.value; scheduleRecompute(); }; inv.onchange = () => { L.invert = inv.checked; scheduleRecompute(); };
    li.querySelector('button').onclick = () => { st.layers.splice(i, 1); renderLayers(); scheduleRecompute(); }; ul.appendChild(li); });
}

// ================= size inputs =================
const sizeIds = ['W', 'H', 'T', 'depth', 'F', 'res', 'quality', 'device', 'model', 'backMode', 'backDepth', 'core', 'cutThr'];
const savedSize = load('rs_size', {});
for (const id of sizeIds) if (savedSize[id] !== undefined) $(id).value = savedSize[id];
for (const id of ['lock', 'mirror', 'cutout', 'cutAI']) if (savedSize[id] !== undefined) $(id).checked = savedSize[id];
$('backOpts').hidden = $('backMode').value === 'flat';
function saveSize() { const o = {}; for (const id of sizeIds) o[id] = $(id).value; for (const id of ['lock', 'mirror', 'cutout', 'cutAI']) o[id] = $(id).checked; save('rs_size', o); }
function sizes() {
  const W = +$('W').value, H = +$('H').value, F = +$('F').value, res = +$('res').value, fo = Math.round(F / res);
  const rw = Math.max(10, W - 2 * fo * res), rh = Math.max(10, H - 2 * fo * res);
  return { W, H, F: fo * res, res, T: +$('T').value, depth: Math.min(+$('depth').value, +$('T').value - 0.5), rw, rh, w: Math.round(rw / res) + 1, h: Math.round(rh / res) + 1 };
}
function updateInfo() {
  const s = sizes();
  $('gridInfo').textContent = `พื้นที่ลาย ${s.rw.toFixed(0)} × ${s.rh.toFixed(0)} mm · กริด ${s.w} × ${s.h} จุด (${(s.w * s.h / 1e6).toFixed(2)} ล้าน)`;
  const pw = s.w + 2 * Math.round(s.F / s.res), ph = s.h + 2 * Math.round(s.F / s.res), tri = 2 * (pw - 1) * (ph - 1);
  $('expInfo').textContent = `STL ประมาณ ${(tri * 50 / 1e6).toFixed(0)} MB · ${(tri / 1e6).toFixed(1)} ล้านสามเหลี่ยม`;
}
function syncAspect(from) {
  if (!$('lock').checked || !st.crop) return; const F = +$('F').value, a = st.crop.h / st.crop.w;
  if (from === 'H') $('W').value = Math.round((+$('H').value - 2 * F) / a + 2 * F); else $('H').value = Math.round((+$('W').value - 2 * F) * a + 2 * F);
}
for (const id of sizeIds) $(id).addEventListener('change', () => {
  if (id === 'W' || id === 'F') syncAspect('W'); if (id === 'H') syncAspect('H'); saveSize(); updateInfo();
  if (['depth', 'T', 'F'].includes(id) && st.Zc) scheduleCompose(true);
});
$('lock').onchange = () => { syncAspect('W'); saveSize(); updateInfo(); };
$('mirror').onchange = () => { saveSize(); refreshViews(); };

// ================= image loading =================
async function decode(file) {
  const url = URL.createObjectURL(file), im = new Image(); im.src = url; await im.decode();
  const mp = im.naturalWidth * im.naturalHeight / 1e6, k = mp > 60 ? Math.sqrt(60 / mp) : 1;
  const bmp = k < 1 ? await createImageBitmap(im, { resizeWidth: Math.round(im.naturalWidth * k), resizeHeight: Math.round(im.naturalHeight * k), resizeQuality: 'high' }) : await createImageBitmap(im);
  URL.revokeObjectURL(url); return { bmp, mp, k };
}
async function loadFile(file, isDetail) {
  let r; try { r = await decode(file); } catch (e) { r = { bmp: await createImageBitmap(file), k: 1 }; }
  const bmp = r.bmp;
  if (isDetail) { st.detailImg = bmp; $('detailInfo').textContent = `ภาพเสริม ${bmp.width}×${bmp.height} px` + (st.img && Math.abs(bmp.width / bmp.height - st.img.width / st.img.height) > 0.02 ? ' — สัดส่วนไม่ตรงกับรูปหลัก!' : ''); if (st.Zc) scheduleCompose(true, true); return; }
  setImage(bmp, true);
  setProg(0, r.k < 1 ? `รูปใหญ่มาก (${r.mp.toFixed(0)} MP) ย่อเหลือ ${bmp.width}×${bmp.height} px อัตโนมัติ` : `โหลดรูป ${bmp.width}×${bmp.height} px — ลากเลือกพื้นที่ลาย แล้วกดวิเคราะห์`);
}
function setImage(bmp, reset) {
  st.img = bmp; st.crop = { x: 0, y: 0, w: bmp.width, h: bmp.height };
  if (reset) { st.polys = []; st.Zc = null; st.E = null; st.Mk = null; st.cutMask = null; st.sim = null; }
  st.depthKey = null; $('drop').classList.add('hide'); renderPolys(); syncAspect('W'); updateInfo(); showTab('img'); drawImg();
}
$('fileMain').onchange = e => e.target.files[0] && loadFile(e.target.files[0], false);
$('fileDetail').onchange = e => e.target.files[0] && loadFile(e.target.files[0], true);
const stage = document.querySelector('.stage');
stage.addEventListener('dragover', e => { e.preventDefault(); $('drop').classList.add('over'); });
stage.addEventListener('dragleave', () => $('drop').classList.remove('over'));
stage.addEventListener('drop', e => { e.preventDefault(); $('drop').classList.remove('over'); const f = e.dataTransfer.files[0];
  if (f && /\.(rsproj|zip)$/i.test(f.name)) openProject(f); else if (f && f.type.startsWith('image/')) loadFile(f, false); });
$('btnRot').onclick = async () => { if (!st.img) return; const c = new OffscreenCanvas(st.img.height, st.img.width), g = c.getContext('2d');
  g.translate(c.width, 0); g.rotate(Math.PI / 2); g.drawImage(st.img, 0, 0); setImage(c.transferToImageBitmap(), true); };
$('btnUpscale').onclick = async () => {
  if (!st.img || st.busy) return; const mp = st.crop.w * st.crop.h / 1e6;
  if (mp > 4) { setProg(0, `พื้นที่ที่เลือกใหญ่แล้ว (${mp.toFixed(1)} MP) ไม่จำเป็นต้องขยาย`, true); return; }
  st.busy = true; lockUI(true);
  try { const crop = await createImageBitmap(st.img, Math.round(st.crop.x), Math.round(st.crop.y), Math.round(st.crop.w), Math.round(st.crop.h));
    const r = await wcall('upscale', { bitmap: crop, urlGpu: UPSCALE.gpu, urlCpu: UPSCALE.cpu, device: $('device').value }, [crop], 'upscaleDone');
    const polys = st.polys; setImage(r.bitmap, false); st.polys = polys; renderPolys(); drawImg(); setProg(1, `ขยายรูปแล้ว ${r.bitmap.width}×${r.bitmap.height} px`);
  } catch (e) { setProg(0, 'ขยายรูปไม่สำเร็จ: ' + e.message, true); }
  st.busy = false; lockUI(false);
};

// ================= image canvas: crop + polygons =================
const cv = $('cvImg'), cx = cv.getContext('2d');
let view = { s: 1, ox: 0, oy: 0 };
function fitCanvas(c) { const r = c.getBoundingClientRect(), d = devicePixelRatio || 1; if (c.width !== Math.round(r.width * d) || c.height !== Math.round(r.height * d)) { c.width = Math.round(r.width * d); c.height = Math.round(r.height * d); } return d; }
function drawImg() {
  const d = fitCanvas(cv); cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, cv.width, cv.height); if (!st.img) return;
  const s = Math.min(cv.width / st.img.width, cv.height / st.img.height) * 0.96;
  view = { s, ox: (cv.width - st.img.width * s) / 2, oy: (cv.height - st.img.height * s) / 2, d };
  cx.setTransform(s, 0, 0, s, view.ox, view.oy); cx.drawImage(st.img, 0, 0);
  const c = st.crop; cx.fillStyle = 'rgba(0,0,0,.45)'; cx.beginPath(); cx.rect(0, 0, st.img.width, st.img.height); cx.rect(c.x, c.y, c.w, c.h); cx.fill('evenodd');
  cx.lineWidth = 2 / s; cx.setLineDash([8 / s, 5 / s]); cx.strokeStyle = '#fff'; cx.strokeRect(c.x, c.y, c.w, c.h); cx.setLineDash([]);
  st.polys.forEach((p, i) => drawPoly(p.pts.map(toImg), COLORS[i % COLORS.length], true)); if (st.drawing) drawPoly(st.drawing.map(toImg), '#fff', false);
}
function drawPoly(pts, col, closed) {
  if (!pts.length) return; const s = view.s; cx.beginPath(); cx.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) cx.lineTo(p[0], p[1]); if (closed) cx.closePath();
  cx.lineWidth = 2.5 / s; cx.strokeStyle = col; if (closed) { cx.fillStyle = col + '33'; cx.fill(); } cx.stroke();
  for (const p of pts) { cx.beginPath(); cx.arc(p[0], p[1], 3 / s, 0, 7); cx.fillStyle = col; cx.fill(); }
}
const toImg = q => [st.crop.x + q[0] * st.crop.w, st.crop.y + q[1] * st.crop.h];
const fromImg = p => [(p[0] - st.crop.x) / st.crop.w, (p[1] - st.crop.y) / st.crop.h];
function evtImg(e) { const r = cv.getBoundingClientRect(), d = view.d || 1; return [((e.clientX - r.left) * d - view.ox) / view.s, ((e.clientY - r.top) * d - view.oy) / view.s]; }
let drag = null;
cv.addEventListener('pointerdown', e => { if (!st.img) return; const p = evtImg(e);
  if (st.mode === 'poly') { const q = fromImg(p); if (q[0] < 0 || q[1] < 0 || q[0] > 1 || q[1] > 1) return; (st.drawing = st.drawing || []).push(q); drawImg(); return; }
  drag = { x0: p[0], y0: p[1] }; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', e => { if (!drag) return; const p = evtImg(e), W = st.img.width, H = st.img.height;
  const x0 = Math.max(0, Math.min(drag.x0, p[0])), y0 = Math.max(0, Math.min(drag.y0, p[1])), x1 = Math.min(W, Math.max(drag.x0, p[0])), y1 = Math.min(H, Math.max(drag.y0, p[1]));
  if (x1 - x0 > 8 && y1 - y0 > 8) { st.crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; drawImg(); } });
cv.addEventListener('pointerup', () => { if (drag) { drag = null; st.polys = []; renderPolys(); syncAspect('W'); updateInfo(); st.depthKey = null; } });
cv.addEventListener('dblclick', () => { if (st.mode === 'poly') finishPoly(); });
function finishPoly() { if (st.drawing && st.drawing.length >= 3) st.polys.push({ id: 'p' + Date.now(), pts: st.drawing.slice() });
  st.drawing = null; setMode('crop'); renderPolys(); drawImg(); if (st.depthKey) runFocusAndCompose(); }
function setMode(m) { st.mode = m; $('btnPoly').classList.toggle('on', m === 'poly'); $('btnCrop').classList.toggle('on', m === 'crop'); cv.style.cursor = m === 'poly' ? 'copy' : 'crosshair'; }
$('btnCrop').onclick = () => { setMode('crop'); showTab('img'); };
$('btnFull').onclick = () => { if (!st.img) return; st.crop = { x: 0, y: 0, w: st.img.width, h: st.img.height }; st.polys = []; st.depthKey = null; renderPolys(); syncAspect('W'); updateInfo(); drawImg(); };
$('btnPoly').onclick = () => { if (!st.img) return; showTab('img'); st.drawing = []; setMode('poly'); setProg(0, 'คลิกรอบบริเวณทีละจุด · ดับเบิลคลิก หรือ Enter เพื่อจบ · Esc ยกเลิก'); };
function renderPolys() { const ul = $('polyList'); ul.innerHTML = '';
  st.polys.forEach((p, i) => { const li = document.createElement('li');
    li.innerHTML = `<i class="sw" style="background:${COLORS[i % COLORS.length]}"></i><span>บริเวณ ${i + 1} (${p.pts.length} จุด)</span><button class="ghost">ลบ</button>`;
    li.querySelector('button').onclick = () => { st.polys.splice(i, 1); st.focusDone.delete(p.id); renderPolys(); drawImg(); if (st.depthKey) scheduleCompose(true); }; ul.appendChild(li); }); }

// ================= pipeline =================
function gridRGBA(img, s, isDetail) {
  const c = new OffscreenCanvas(s.w, s.h), g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  let cr = st.crop; if (isDetail) { const kx = img.width / st.img.width, ky = img.height / st.img.height; cr = { x: cr.x * kx, y: cr.y * ky, w: cr.w * kx, h: cr.h * ky }; }
  g.drawImage(img, cr.x, cr.y, cr.w, cr.h, 0, 0, s.w, s.h); return g.getImageData(0, 0, s.w, s.h).data;
}
function polyMask(p, s) { const c = new OffscreenCanvas(s.w, s.h), g = c.getContext('2d'); g.fillStyle = '#fff'; g.beginPath();
  p.pts.forEach((q, i) => { const x = q[0] * (s.w - 1), y = q[1] * (s.h - 1); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.fill();
  const a = g.getImageData(0, 0, s.w, s.h).data, m = new Uint8Array(s.w * s.h); for (let i = 0; i < m.length; i++) m[i] = a[i * 4 + 3] > 127 ? 1 : 0; return m; }
$('btnRun').onclick = async () => {
  if (!st.img) { setProg(0, 'กรุณาเลือกรูปก่อน', true); return; } if (st.busy) return; st.busy = true; lockUI(true);
  try {
    await ensureWorker();
    const s = sizes(), key = JSON.stringify([st.crop, s.w, s.h, s.res, $('quality').value, $('model').value]);
    if (st.depthKey !== key) {
      const rgba = gridRGBA(st.img, s), k = Math.max(1, Math.min(3, st.crop.w / s.w, st.crop.h / s.h)); let hires = null;
      if (k > 1.2) hires = await createImageBitmap(st.img, st.crop.x, st.crop.y, st.crop.w, st.crop.h, { resizeWidth: Math.round(s.w * k), resizeHeight: Math.round(s.h * k), resizeQuality: 'high' });
      st.rgba = new Uint8Array(rgba);  // kept for project save
      await wcall('depth', { rgba: rgba.buffer, w: s.w, h: s.h, res: s.res, quality: $('quality').value, hires, k }, hires ? [rgba.buffer, hires] : [rgba.buffer], 'depthDone');
      st.depthKey = key; st.focusDone.clear(); st.w = s.w; st.h = s.h; st.res = s.res; st.E = null; st.Mk = null; st.cutMask = null; st.sim = null;
      st.layers.forEach(L => L.data = null);
    }
    await focusAll(); await composeNow(true);
  } catch (e) { console.error(e); setProg(0, 'ผิดพลาด: ' + e.message, true); }
  st.busy = false; lockUI(false);
};
async function focusAll() { const s = sizes(); for (const p of st.polys) if (!st.focusDone.has(p.id)) { const m = polyMask(p, s); await wcall('focus', { id: p.id, mask: m.buffer }, [m.buffer], 'focusDone'); st.focusDone.add(p.id); } }
async function runFocusAndCompose() { if (st.busy) return; st.busy = true; try { await focusAll(); await composeNow(true); } catch (e) { setProg(0, 'ผิดพลาด: ' + e.message, true); } st.busy = false; }
async function composeNow(sendDetail) {
  const s = sizes(), msg = { params: Object.assign({}, st.params, { depth: s.depth }), focusIds: st.polys.map(p => p.id) }, tr = [];
  if (sendDetail) { if (st.detailImg) { const d = gridRGBA(st.detailImg, { w: st.w, h: st.h }, true); msg.detailRgba = d; tr.push(d.buffer); } else msg.clearDetail = true; }
  setProg(0.5, 'สร้างลายนูน…'); const r = await wcall('compose', msg, tr, 'composed');
  st.Zc = r.Z; st.w = r.w; st.h = r.h;
  if (!st.E || st.E.length !== r.Z.length) { st.E = new Float32Array(r.Z.length); st.Mk = new Float32Array(r.Z.length); st.undo = []; st.redo = []; }
  recompute(true);
  setProg(1, `เสร็จ (${(r.ms / 1000).toFixed(1)} วินาที${st.backend ? ' · ' + (st.backend === 'webgpu' ? 'GPU' : 'CPU') : ''}) — ปรับแถบเลื่อนได้ทันที`);
  for (const id of ['btnSTL', 'btnOBJ', 'btnPNG', 'btnPNGr', 'btnTiles', 'btnSaveProj', 'btnSim', 'btnTime', 'btnCutout']) $(id).disabled = false;
  if (curTab === 'img') showTab('hm');
}
let ctimer = null, cdetail = false;
function scheduleCompose(now, detail) { if (!st.depthKey) return; cdetail = cdetail || !!detail; clearTimeout(ctimer);
  ctimer = setTimeout(async () => { if (st.busy) { scheduleCompose(false, cdetail); return; } st.busy = true; const d = cdetail; cdetail = false;
    try { await composeNow(d); } catch (e) { setProg(0, 'ผิดพลาด: ' + e.message, true); } st.busy = false; }, now ? 30 : 450); }
function lockUI(on) { for (const id of ['btnRun', 'fileMain', 'btnUpscale']) $(id).disabled = on; }

// composed → effects → + edits → plate (frame)
let texCache = null;
function texFor(o) { const key = [o.type, o.scale, o.angle, st.w, st.h, st.res].join(); if (!texCache || texCache.key !== key) texCache = { key, t: Ops.texture(o.type, st.w, st.h, st.res, o.scale, o.angle) }; return texCache.t; }
function recompute(full) {
  if (!st.Zc) return; const s = sizes(), n = st.Zc.length;
  const ops = { curve: st.ops.curve, fade: st.ops.fade, tilt: st.ops.tilt, dome: st.ops.dome, tex: Object.assign({}, st.ops.tex),
    layers: st.layers.filter(L => L.enabled).map(L => ({ data: layerData(L), mode: L.mode, height: L.height, invert: L.invert })),
    flattenBg: st.ops.flatten.on && st.cutMask ? { on: true, mask: st.cutMask, level: st.ops.flatten.level } : null };
  st.Zo = Ops.applyOps(st.Zc, st.w, st.h, st.res, s.depth, ops, st.Mk);
  finalize(); if (full) refreshViews();
}
let rtimer = null; function scheduleRecompute() { clearTimeout(rtimer); rtimer = setTimeout(() => recompute(true), 220); }
function finalize() {
  const n = st.Zo.length, dep = sizes().depth; if (!st.Z || st.Z.length !== n) st.Z = new Float32Array(n);
  for (let i = 0; i < n; i++) st.Z[i] = Math.min(Math.max(st.Zo[i] + st.E[i], 0), dep);
  buildPlate();
}
function buildPlate() { const s = sizes(); st.plate = Ops.assemble(st.Z, st.w, st.h, st.res, Object.assign({}, st.frame, { F: s.F, T: s.T, depth: s.depth }));
  if (!st.shade || st.shade.length !== st.plate.P.length) st.shade = new Uint8ClampedArray(st.plate.P.length);
  Relief.hillshade(st.plate.P, st.plate.pw, st.plate.ph, st.res, st.shade); st.sim = null; }
function refreshViews() { if (curTab === 'hm') drawHm(); if (curTab === '3d') build3D(); }

// ================= AI cutout =================
$('btnCutout').onclick = async () => { if (st.busy || !st.depthKey) return; st.busy = true;
  try { const r = await wcall('cutout', { urlGpu: CUTOUT.gpu, urlCpu: CUTOUT.cpu, device: $('device').value }, null, 'cutoutDone');
    st.cutMask = new Uint8Array(r.mask.length); let c = 0; for (let i = 0; i < r.mask.length; i++) { st.cutMask[i] = r.mask[i] > 0.5 ? 1 : 0; c += st.cutMask[i]; }
    setProg(1, `แยกตัวลายแล้ว (${(c / r.mask.length * 100).toFixed(0)}% เป็นตัวลาย) — เปิดใช้ได้ในหัวข้อ 6 และ 8`); $('hmMask').checked = true; recompute(true); showTab('hm');
  } catch (e) {
    // fallback (no GPU / not enough memory): separate by relief height + cleanup
    const Z = st.Zc, n = Z.length, thr = Relief.percentile(Z, 30), m = new Uint8Array(n); for (let i = 0; i < n; i++) m[i] = Z[i] > thr ? 1 : 0;
    st.cutMask = Relief.removeSmall(m, st.w, st.h, Math.round(25 / (st.res * st.res)));
    setProg(1, 'ใช้วิธีแยกจากความสูงแทน (เครื่องนี้หน่วยความจำ/GPU ไม่พอสำหรับ AI แยกพื้นหลัง)'); $('hmMask').checked = true; recompute(true); showTab('hm');
  } st.busy = false; };

// ================= back side =================
function backOn() { return $('backMode').value !== 'flat'; }
function solidFields() {
  const s = sizes(), w = st.w, h = st.h, res = st.res, n = w * h, Z = st.Z, mode = $('backMode').value;
  const bd = +$('backDepth').value, core = +$('core').value, cut = $('cutout').checked, thr = +$('cutThr').value, useAI = $('cutAI').checked && st.cutMask;
  const inc = cut ? new Uint8Array(n) : null; if (cut) for (let i = 0; i < n; i++) inc[i] = useAI ? st.cutMask[i] : Z[i] > thr ? 1 : 0;
  let B;
  if (mode === 'mirror') { B = new Float32Array(n); const k = bd / s.depth; for (let i = 0; i < n; i++) B[i] = Z[i] * k; }
  else { const M = inc || new Uint8Array(n).fill(1), inv = new Uint8Array(n); for (let i = 0; i < n; i++) inv[i] = M[i] ? 0 : 1;
    let dt; if (cut) dt = Relief.edt(inv, w, h); else { dt = new Float32Array(n); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) dt[j * w + i] = Math.min(i, j, w - 1 - i, h - 1 - j); }
    const R = Math.max(bd * 1.4, 4) / res, big = Relief.gauss(Z, w, h, 8 / res), mx = Relief.percentile(big, 99.5) || 1; B = new Float32Array(n);
    for (let i = 0; i < n; i++) { const pr = Math.sqrt(Math.min(dt[i] / R, 1)); B[i] = bd * (0.55 * pr + 0.45 * Math.min(big[i] / mx, 1) * pr); }
    B = Relief.gauss(B, w, h, 1.5 / res); }
  const top = new Float32Array(n), bot = new Float32Array(n), mid = bd + core / 2;
  for (let i = 0; i < n; i++) { top[i] = mid + core / 2 + Z[i]; bot[i] = mid - core / 2 - B[i]; }
  if (cut) for (let i = 0; i < n; i++) if (!inc[i]) top[i] = bot[i] = mid;
  return { top, bot, inc, total: bd + core + s.depth };
}
$('backMode').onchange = () => { $('backOpts').hidden = !backOn(); saveSize(); refreshViews(); };
for (const id of ['backDepth', 'core', 'cutout', 'cutAI']) $(id).addEventListener('change', () => { saveSize(); refreshViews(); });
{ const c = $('cutThr'), v = () => $('v_cutThr').textContent = (+c.value).toFixed(1) + ' mm'; v(); c.oninput = v; c.onchange = () => { saveSize(); refreshViews(); }; }

// ================= heightmap view =================
const ch = $('cvHm'), chx = ch.getContext('2d');
function drawHm() {
  fitCanvas(ch); chx.setTransform(1, 0, 0, 1, 0, 0); chx.clearRect(0, 0, ch.width, ch.height); if (!st.plate) return;
  const { P, pw, ph, fo } = st.plate, im = new ImageData(pw, ph), mir = $('mirror').checked, gray = $('hmGray').checked, T = sizes().T;
  const sim = $('hmSim').checked && st.sim, msk = $('hmMask').checked && st.cutMask;
  for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) { const si = mir ? pw - 1 - i : i, k = j * pw + si, o = (j * pw + i) * 4;
    let v = gray ? Math.min(255, P[k] / T * 255) : st.shade[k], r = v, g = v, b = v;
    if (sim && st.sim.D[k] > 0.1) { const t = Math.min(1, st.sim.D[k] / 2); r = 255; g = v * (1 - t); b = v * (1 - t); }
    const ii = si - fo, jj = j - fo;
    if (ii >= 0 && jj >= 0 && ii < st.w && jj < st.h) { const q = jj * st.w + ii;
      if (msk && !st.cutMask[q]) { b = Math.min(255, b * 0.6 + 100); r *= 0.7; g *= 0.8; }
      if (st.Mk && st.Mk[q] > 0) { const t = st.Mk[q] * 0.5; r = r * (1 - t) + 230 * t; g *= 1 - t * 0.6; b *= 1 - t * 0.2; } }
    im.data[o] = r; im.data[o + 1] = g; im.data[o + 2] = b; im.data[o + 3] = 255; }
  const tmp = new OffscreenCanvas(pw, ph); tmp.getContext('2d').putImageData(im, 0, 0);
  const s = Math.min(ch.width / pw, ch.height / ph) * 0.96; chx.imageSmoothingQuality = 'high'; chx.drawImage(tmp, (ch.width - pw * s) / 2, (ch.height - ph * s) / 2, pw * s, ph * s);
}
for (const id of ['hmGray', 'hmSim', 'hmMask']) $(id).onchange = drawHm;

// ================= 3D view + sculpt =================
let R3 = null;
const sc = { tool: 'orbit', active: false, start: 0, last: null };
function init3D() {
  const el = $('v3d'), renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); el.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(getComputedStyle(document.body).getPropertyValue('--stage').trim() || '#e9e5de');
  const cam = new THREE.PerspectiveCamera(35, 1, 1, 50000); cam.up.set(0, 0, 1);
  const ctl = new OrbitControls(cam, renderer.domElement); ctl.enableDamping = true; ctl.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 0.85)); const sun = new THREE.DirectionalLight(0xffffff, 1.7); scene.add(sun); scene.add(sun.target);
  const cursor = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicMaterial({ color: 0xff6a00, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 }));
  cursor.visible = false; cursor.renderOrder = 10; scene.add(cursor);
  R3 = { renderer, scene, cam, ctl, sun, group: null, front: null, cursor, ray: new THREE.Raycaster() };
  const loop = () => { requestAnimationFrame(loop); if (curTab !== '3d') return; const r = el.getBoundingClientRect();
    if (renderer.domElement.width !== Math.round(r.width * renderer.getPixelRatio())) { renderer.setSize(r.width, r.height, false); cam.aspect = r.width / r.height; cam.updateProjectionMatrix(); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'; }
    ctl.update(); renderer.render(scene, cam); };
  loop();
  const dom = renderer.domElement; dom.addEventListener('contextmenu', e => e.preventDefault());
  dom.addEventListener('pointerdown', e => {
    if (sc.tool === 'orbit' || e.button !== 0) return; const hit = pick(e); if (!hit) return;
    e.stopImmediatePropagation(); ctl.enabled = false; dom.setPointerCapture(e.pointerId); pushUndo();
    const g = gridOf(hit); sc.active = true; sc.start = st.Z[g.k]; sc.last = g; dab(g, null);
  }, true);
  dom.addEventListener('pointermove', e => {
    const hit = sc.tool !== 'orbit' ? pick(e) : null; showCursor(hit); if (!sc.active || !hit) return; const g = gridOf(hit);
    const d = Math.hypot(g.i - sc.last.i, g.j - sc.last.j), spacing = Math.max(1, (+$('brushR').value / st.res) * 0.25), steps = Math.max(1, Math.floor(d / spacing));
    for (let s = 1; s <= steps; s++) { const t = s / steps, p = { i: sc.last.i + (g.i - sc.last.i) * t, j: sc.last.j + (g.j - sc.last.j) * t };
      dab(p, { di: (g.i - sc.last.i) / steps, dj: (g.j - sc.last.j) / steps }); }
    sc.last = g;
  });
  const end = () => { if (!sc.active) return; sc.active = false; ctl.enabled = true; afterSculpt(); };
  dom.addEventListener('pointerup', end); dom.addEventListener('pointerleave', () => { showCursor(null); end(); });
}
function pushUndo() { st.undo.push([Float32Array.from(st.E), Float32Array.from(st.Mk)]); if (st.undo.length > 25) st.undo.shift(); st.redo = []; }
function pick(e) { if (!R3.front) return null; const r = R3.renderer.domElement.getBoundingClientRect();
  const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  R3.ray.setFromCamera(v, R3.cam); const h = R3.ray.intersectObject(R3.front, false); return h.length ? h[0] : null; }
function gridOf(hit) {
  const fo = backOn() ? 0 : st.plate.fo, ph = backOn() ? st.h : st.plate.ph, pw = backOn() ? st.w : st.plate.pw;
  let i = hit.point.x / st.res, j = (ph - 1) - hit.point.y / st.res; if ($('mirror').checked) i = pw - 1 - i;
  i = Math.min(Math.max(i - fo, 0), st.w - 1); j = Math.min(Math.max(j - fo, 0), st.h - 1); return { i, j, k: Math.round(j) * st.w + Math.round(i) };
}
function showCursor(hit) { const c = R3.cursor; if (!hit) { c.visible = false; return; } const r = +$('brushR').value; c.visible = true; c.scale.set(r, r, r);
  c.position.copy(hit.point).add(new THREE.Vector3(0, 0, 0.3)); if (hit.face) c.lookAt(c.position.clone().add(hit.face.normal)); }
function dab(g, dir) { dab1(g, dir); if ($('symX').checked) dab1({ i: st.w - 1 - g.i, j: g.j }, dir ? { di: -dir.di, dj: dir.dj } : null); }
function dab1(g, dir) {
  const w = st.w, h = st.h, res = st.res, R = +$('brushR').value / res, S = +$('brushS').value, dep = sizes().depth, tool = sc.tool;
  const i0 = Math.max(0, Math.floor(g.i - R)), i1 = Math.min(w - 1, Math.ceil(g.i + R)), j0 = Math.max(0, Math.floor(g.j - R)), j1 = Math.min(h - 1, Math.ceil(g.j + R));
  let bl = null, pw = i1 - i0 + 1;
  if (tool === 'smooth') { const src = new Float32Array(pw * (j1 - j0 + 1)); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) src[(j - j0) * pw + i - i0] = st.Z[j * w + i]; bl = Relief.gauss(src, pw, j1 - j0 + 1, Math.max(1, R * 0.25)); }
  let snap = null; if (tool === 'smudge' && dir) { snap = new Float32Array(pw * (j1 - j0 + 1)); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) snap[(j - j0) * pw + i - i0] = st.Z[j * w + i]; }
  const tex = tool === 'texture' ? texFor(st.ops.tex) : null;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(i - g.i, j - g.j) / R; if (d >= 1) continue; const f = 0.5 + 0.5 * Math.cos(Math.PI * d), k = j * w + i;
    if (tool === 'mask') { st.Mk[k] = Math.min(1, st.Mk[k] + S * f * 1.5); continue; }
    if (tool === 'unmask') { st.Mk[k] = Math.max(0, st.Mk[k] - S * f * 1.5); continue; }
    const pm = 1 - st.Mk[k]; if (pm <= 0) continue; let dE = 0;
    switch (tool) {
      case 'raise': dE = S * 0.6 * f; break;
      case 'lower': dE = -S * 0.6 * f; break;
      case 'sharp': dE = S * 0.9 * Math.pow(1 - d, 3); break;
      case 'crease': dE = -S * 1.2 * Math.pow(1 - d, 1.5); break;
      case 'smooth': dE = (bl[(j - j0) * pw + i - i0] - st.Z[k]) * Math.min(1, S * 1.5) * f; break;
      case 'flatten': dE = (sc.start - st.Z[k]) * Math.min(1, S * 1.5) * f; break;
      case 'erase': dE = -st.E[k] * Math.min(1, S * 1.5) * f; break;
      case 'texture': dE = (tex[k] - 0.5) * S * 0.25 * f; break;
      case 'smudge': if (snap) { const si = Math.round(i - dir.di * 2), sj = Math.round(j - dir.dj * 2);
        if (si >= i0 && si <= i1 && sj >= j0 && sj <= j1) dE = (snap[(sj - j0) * pw + si - i0] - st.Z[k]) * Math.min(1, S * 1.2) * f; } break;
    }
    st.E[k] += dE * pm; st.Z[k] = Math.min(Math.max(st.Zo[k] + st.E[k], 0), dep);
  }
  updateFrontRegion(i0, i1, j0, j1, tool === 'mask' || tool === 'unmask');
}
let normTimer = null;
function updateFrontRegion(i0, i1, j0, j1, colorsOnly) {
  if (!R3 || !R3.front) return; const m = R3.meta, geo = R3.front.geometry, pos = geo.attributes.position, colA = geo.attributes.color;
  const mir = $('mirror').checked, fo = m.fo, pl = st.plate;
  for (let jj = Math.max(0, Math.floor((j0 + fo) / m.step) - 1); jj <= Math.min(m.gh - 1, Math.ceil((j1 + fo) / m.step) + 1); jj++)
    for (let ii = 0; ii < m.gw; ii++) {
      const sx = Math.min(ii * m.step, m.fw - 1), src = mir ? m.fw - 1 - sx : sx, si = src - fo; if (si < i0 - m.step || si > i1 + m.step) continue;
      const sy = Math.min(jj * m.step, m.fh - 1), sj = sy - fo, v = jj * m.gw + ii;
      if (si < 0 || sj < 0 || si >= st.w || sj >= st.h) continue; const q = sj * st.w + si;
      if (!colorsOnly) { let z;
        if (backOn()) z = m.mid + m.core / 2 + st.Z[q];
        else { const k = sy * pl.pw + src; if (!pl.inner[k]) continue; z = pl.base + st.Z[q]; if (pl.wall[k] > 0) z = Math.max(z, pl.wall[k]); pl.P[k] = z; }
        pos.setZ(v, z); }
      if (colA) { const t = st.Mk[q] * 0.6; colA.setXYZ(v, 0.91 * (1 - t) + 0.95 * t, 0.86 * (1 - t) + 0.35 * t, 0.78 * (1 - t) + 0.3 * t); }
    }
  pos.needsUpdate = true; if (colA) colA.needsUpdate = true; clearTimeout(normTimer); normTimer = setTimeout(() => geo.computeVertexNormals(), 60);
}
function afterSculpt() { Relief.hillshade(st.plate.P, st.plate.pw, st.plate.ph, st.res, st.shade); st.sim = null; if (R3 && R3.front) R3.front.geometry.computeVertexNormals(); if (backOn()) build3D(); }
document.querySelectorAll('#sculptBar [data-tool]').forEach(b => b.onclick = () => { sc.tool = b.dataset.tool;
  document.querySelectorAll('#sculptBar [data-tool]').forEach(x => x.classList.toggle('on', x === b)); if (R3) R3.cursor.visible = false; });
for (const [id, u] of [['brushR', ' mm'], ['brushS', '']]) { const el = $(id), v = () => $('v_' + id).textContent = (+el.value).toFixed(id === 'brushS' ? 2 : 1) + u; v(); el.oninput = v; }
function undo() { if (!st.undo.length) return; st.redo.push([Float32Array.from(st.E), Float32Array.from(st.Mk)]); [st.E, st.Mk] = st.undo.pop(); finalize(); build3D(); }
function redo() { if (!st.redo.length) return; st.undo.push([Float32Array.from(st.E), Float32Array.from(st.Mk)]); [st.E, st.Mk] = st.redo.pop(); finalize(); build3D(); }
$('btnUndo').onclick = undo; $('btnRedo').onclick = redo;
$('btnClearEd').onclick = () => { if (!st.E) return; pushUndo(); st.E.fill(0); finalize(); build3D(); };
$('btnClearMask').onclick = () => { if (!st.Mk) return; pushUndo(); st.Mk.fill(0); build3D(); };
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  if (st.mode === 'poly' && e.key === 'Enter') finishPoly();
  if (e.key === 'Escape') { st.drawing = null; setMode('crop'); drawImg(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  if (curTab === '3d' && (e.key === '[' || e.key === ']')) { const b = $('brushR'); b.value = Math.max(1, Math.min(60, +b.value * (e.key === ']' ? 1.2 : 1 / 1.2))); b.oninput(); }
});

function surfaceGeom(field, fw, fh, step, gw, gh, flipNormal, withColor) {
  const res = st.res, mir = $('mirror').checked, pos = new Float32Array(gw * gh * 3);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const si = Math.min(i * step, fw - 1), sj = Math.min(j * step, fh - 1), k = (j * gw + i) * 3;
    pos[k] = si * res; pos[k + 1] = (fh - 1 - sj) * res; pos[k + 2] = field(sj * fw + (mir ? fw - 1 - si : si), mir ? fw - 1 - si : si, sj); }
  const idx = new Uint32Array((gw - 1) * (gh - 1) * 6); let t = 0;
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) { const a = j * gw + i, b = a + 1, c = a + gw, d = c + 1;
    if (flipNormal) { idx[t++] = a; idx[t++] = b; idx[t++] = c; idx[t++] = b; idx[t++] = d; idx[t++] = c; } else { idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d; } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  if (withColor) { const col = new Float32Array(gw * gh * 3); for (let i = 0; i < gw * gh; i++) { col[i * 3] = 0.91; col[i * 3 + 1] = 0.86; col[i * 3 + 2] = 0.78; } g.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
  g.computeVertexNormals(); return g;
}
function build3D() {
  if (!st.plate) return; if (!R3) init3D(); $('sculptBar').hidden = false;
  const s = sizes(), mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  const matB = new THREE.MeshStandardMaterial({ color: 0xe8dcc8, roughness: 0.8, side: THREE.DoubleSide });
  if (R3.group) { R3.scene.remove(R3.group); R3.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  const grp = new THREE.Group(); let PW, PH, PT, fw, fh, fo;
  if (!backOn()) { const pl = st.plate; fw = pl.pw; fh = pl.ph; fo = pl.fo; PW = (fw - 1) * st.res; PH = (fh - 1) * st.res; PT = s.T; }
  else { fw = st.w; fh = st.h; fo = 0; PW = (fw - 1) * st.res; PH = (fh - 1) * st.res; }
  const step = Math.max(1, Math.ceil(Math.sqrt(fw * fh / 900000))), gw = Math.floor((fw - 1) / step) + 1, gh = Math.floor((fh - 1) / step) + 1;
  const sim = $('hmSim').checked && st.sim;
  if (!backOn()) {
    const P = sim ? st.sim.C : st.plate.P; R3.front = new THREE.Mesh(surfaceGeom(k => P[k], fw, fh, step, gw, gh, false, true), mat); grp.add(R3.front);
    const bottom = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), matB); bottom.position.set(PW / 2, PH / 2, 0); grp.add(bottom);
    const sides = new THREE.Mesh(new THREE.BoxGeometry(PW, PH, 0.01), matB); sides.visible = false; grp.add(sides);
    for (const [ax, fixed] of [['y', 0], ['y', fh - 1], ['x', 0], ['x', fw - 1]]) {  // skirt walls
      const n = ax === 'y' ? fw : fh, pos = new Float32Array(n * 6), idx = [];
      for (let t = 0; t < n; t++) { const i = ax === 'y' ? t : fixed, j = ax === 'y' ? fixed : t, mi = $('mirror').checked ? fw - 1 - i : i;
        const x = i * st.res, y = (fh - 1 - j) * st.res, z = st.plate.P[j * fw + mi]; pos.set([x, y, 0, x, y, z], t * 6); if (t) idx.push((t - 1) * 2, t * 2, (t - 1) * 2 + 1, t * 2, t * 2 + 1, (t - 1) * 2 + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); grp.add(new THREE.Mesh(g, matB)); }
  } else {
    const sf = solidFields(); PT = sf.total; const cut = sf.inc;
    const topF = k => cut && !cut[k] ? NaN : sf.top[k], botF = k => cut && !cut[k] ? NaN : sf.bot[k];
    const gT = surfaceGeom(topF, fw, fh, step, gw, gh, false, true), gB = surfaceGeom(botF, fw, fh, step, gw, gh, true, false);
    if (cut) for (const g of [gT, gB]) dropNaN(g);
    R3.front = new THREE.Mesh(gT, mat); grp.add(R3.front); grp.add(new THREE.Mesh(gB, matB));
    R3.meta = { mid: +$('backDepth').value + +$('core').value / 2, core: +$('core').value };
  }
  R3.meta = Object.assign(R3.meta || {}, { step, gw, gh, fw, fh, fo });
  R3.scene.add(grp); R3.group = grp;
  updateFrontRegion(0, st.w - 1, 0, st.h - 1, true);
  const ctr = new THREE.Vector3(PW / 2, PH / 2, PT / 2), span = Math.max(PW, PH), key = PW.toFixed(0) + 'x' + PH.toFixed(0);
  if (R3.fitted !== key) { R3.cam.position.set(PW / 2 - span * 0.3, PH / 2 - span * 1.05, span * 1.25); R3.ctl.target.copy(ctr); R3.fitted = key; }
  R3.sun.position.set(-span * 0.4, PH + span * 0.5, span * 0.8); R3.sun.target.position.copy(ctr);
}
function dropNaN(g) { const p = g.attributes.position.array, idx = g.index.array, keep = [];
  for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; if (!isNaN(p[a * 3 + 2]) && !isNaN(p[b * 3 + 2]) && !isNaN(p[c * 3 + 2])) keep.push(a, b, c); }
  for (let i = 2; i < p.length; i += 3) if (isNaN(p[i])) p[i] = 0; g.setIndex(new THREE.BufferAttribute(new Uint32Array(keep), 1)); g.computeVertexNormals(); }

// ================= tabs =================
let curTab = 'img';
function showTab(t) {
  curTab = t; document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('cvImg').classList.toggle('on', t === 'img'); $('cvHm').classList.toggle('on', t === 'hm'); $('v3d').classList.toggle('on', t === '3d');
  $('hmMode').hidden = t === 'img'; $('sculptBar').hidden = t !== '3d' || !st.plate;
  if (t === 'img') drawImg(); if (t === 'hm') drawHm(); if (t === '3d') build3D();
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
window.addEventListener('resize', () => { if (curTab === 'img') drawImg(); if (curTab === 'hm') drawHm(); });

// ================= production =================
$('btnSim').onclick = async () => { if (!st.plate || st.busy) return; st.busy = true; setProg(0.3, 'จำลองดอกบอล…');
  try { const P = Float32Array.from(st.plate.P), r = await wcall('cutsim', { P: P.buffer, pw: st.plate.pw, ph: st.plate.ph, res: st.res, radius: st.cnc.simDia / 2 }, [P.buffer], 'cutsimDone');
    st.sim = { C: r.C, D: r.D }; $('simInfo').textContent = `ดอกบอล Ø${st.cnc.simDia} mm: กัดไม่ถึง ${r.missPct.toFixed(1)}% ของพื้นที่ (ลึกสุด ${r.maxd.toFixed(2)} mm) — สีแดงในแท็บ Heightmap/3D`;
    $('hmSim').checked = true; setProg(1, 'จำลองเสร็จ'); refreshViews(); if (curTab === 'img') showTab('hm');
  } catch (e) { setProg(0, 'จำลองไม่สำเร็จ: ' + e.message, true); } st.busy = false; };
$('btnTime').onclick = () => { if (!st.plate) return; const s = sizes(), r = Ops.estimateTime(st.plate.P, st.plate.pw, st.plate.ph, st.res, s.T, st.cnc);
  const hm = m => `${Math.floor(m / 60)} ชม. ${Math.round(m % 60)} นาที`;
  $('timeInfo').innerHTML = `เนื้อที่ต้องกัดออก ${r.volume_cm3.toFixed(0)} cm³ · กัดหยาบ ${r.layers} ชั้น ≈ ${hm(r.roughMin)}<br>เก็บละเอียด (raster) ${r.finishLenM.toFixed(0)} m ≈ ${hm(r.finishMin)}<br><b>รวมประมาณ ${hm(r.totalMin)}</b> (ไม่รวมเปลี่ยนดอก/ตั้งเครื่อง)`; };

// ================= license =================
async function checkLicense() {
  let k = ''; try { k = localStorage.getItem('rs_license') || ''; } catch (e) {}
  st.lic = k ? await verifyKey(k) : null; const b = $('licBadge');
  if (st.lic && !st.lic.expired) { b.textContent = 'Pro'; b.className = 'badge ok'; $('licInfo').textContent = `ใบอนุญาต: ${st.lic.n} · ${st.lic.e ? 'หมดอายุ ' + new Date(st.lic.e * 1000).toLocaleDateString('th-TH') : 'ไม่มีวันหมดอายุ'}`; }
  else { b.textContent = 'ทดลองใช้'; b.className = 'badge'; $('licInfo').textContent = st.lic && st.lic.expired ? 'รหัสหมดอายุแล้ว — ไฟล์ส่งออกจะมีลายน้ำ' : 'โหมดทดลอง: ไฟล์ที่ส่งออกจะมีลายน้ำ'; st.lic = null; }
}
$('btnLic').onclick = async () => { const k = $('licKey').value.trim(), p = await verifyKey(k);
  if (!p) { setProg(0, 'รหัสไม่ถูกต้อง', true); return; } try { localStorage.setItem('rs_license', k); } catch (e) {} $('licKey').value = ''; await checkLicense(); setProg(1, 'เปิดใช้งานแล้ว ขอบคุณครับ'); };
$('btnLicOff').onclick = async () => { try { localStorage.removeItem('rs_license'); } catch (e) {} await checkLicense(); };
const licensed = () => !!st.lic;

// ================= export =================
function dl(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }
const baseName = () => { const s = sizes(); return `relief_${s.W}x${s.H}x${s.T}`; };
const tick = () => new Promise(r => setTimeout(r, 30));
function plateForExport() { const s = sizes(), pl = st.plate; let P = pl.P; if (!licensed()) P = watermark(P, pl.pw, pl.ph, st.res, 0.6, s.T); return { P, pw: pl.pw, ph: pl.ph }; }
$('btnSTL').onclick = async () => { if (!st.plate) return; setProg(0.3, 'กำลังสร้าง STL…'); await tick(); let blob;
  if (backOn()) { const sf = solidFields(); let top = sf.top; if (!licensed()) top = watermark(top, st.w, st.h, st.res, 0.6, 1e9); blob = buildSolid(top, sf.bot, st.w, st.h, st.res, sf.inc, $('mirror').checked); }
  else { const e = plateForExport(); blob = buildSolid(e.P, new Float32Array(e.P.length), e.pw, e.ph, st.res, null, $('mirror').checked); }
  dl(blob, baseName() + '.stl'); setProg(1, `ส่งออก STL แล้ว (${(blob.size / 1e6).toFixed(0)} MB)${licensed() ? '' : ' · มีลายน้ำทดลอง'}`); };
$('btnOBJ').onclick = async () => { if (!st.plate) return; setProg(0.3, 'กำลังสร้าง OBJ…'); await tick(); const e = plateForExport();
  const blob = buildOBJ(e.P, e.pw, e.ph, st.res, $('mirror').checked); dl(blob, baseName() + '.obj'); setProg(1, `ส่งออก OBJ แล้ว (${(blob.size / 1e6).toFixed(0)} MB)`); };
$('btnPNG').onclick = async () => { if (!st.plate) return; setProg(0.3, 'กำลังสร้าง heightmap…'); const e = plateForExport(), T = sizes().T;
  dl(await buildPNG16(e.P, e.pw, e.ph, T, $('mirror').checked), baseName() + `_plate_0-${T}mm_16bit.png`); setProg(1, `ส่งออก heightmap ทั้งแผ่นแล้ว (ดำ = 0, ขาว = ${T} mm)`); };
$('btnPNGr').onclick = async () => { if (!st.Z) return; const d = sizes().depth; let Z = st.Z; if (!licensed()) Z = watermark(Z, st.w, st.h, st.res, 0.6, d);
  dl(await buildPNG16(Z, st.w, st.h, d, $('mirror').checked), baseName() + `_relief_0-${d}mm_16bit.png`); setProg(1, `ส่งออก heightmap ลายแล้ว (ขาว = ${d} mm)`); };
$('btnTiles').onclick = async () => { if (!st.plate || backOn()) { setProg(0, 'แบ่งท่อนใช้ได้กับโหมดหลังเรียบ', true); return; }
  const e = plateForExport(), tiles = Ops.tiles(e.pw, e.ph, st.res, st.cnc.tileLen, st.cnc.tileOv), files = [], mir = $('mirror').checked;
  for (let t = 0; t < tiles.length; t++) { const b = tiles[t], tw = b.x1 - b.x0 + 1, th = b.y1 - b.y0 + 1, sub = new Float32Array(tw * th);
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) { const gi = mir ? e.pw - 1 - (b.x0 + i) : b.x0 + i; sub[j * tw + i] = e.P[(b.y0 + j) * e.pw + gi]; }
    setProg((t + 0.5) / tiles.length, `สร้างท่อน ${t + 1}/${tiles.length}`); await tick();
    files.push({ name: `${baseName()}_part${t + 1}of${tiles.length}.stl`, data: buildSolid(sub, new Float32Array(sub.length), tw, th, st.res, null, false) }); }
  dl(await zipFiles(files), baseName() + `_${tiles.length}parts.zip`); setProg(1, `แบ่ง ${tiles.length} ท่อน (ยาวไม่เกิน ${st.cnc.tileLen} mm) แล้ว`); };
$('btnSaveP').onclick = () => { const o = { params: st.params, ops: st.ops, frame: st.frame, cnc: st.cnc, size: {} }; for (const id of sizeIds) o.size[id] = $(id).value; dl(new Blob([JSON.stringify(o, null, 2)], { type: 'application/json' }), 'relief_settings.json'); };
$('fileP').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { applySettings(JSON.parse(await f.text())); } catch (err) { setProg(0, 'ไฟล์ค่าไม่ถูกต้อง', true); } e.target.value = ''; };
function applySettings(o) {
  if (o.params) st.params = Object.assign({ ...DEFAULTS }, o.params); if (o.ops) st.ops = Object.assign(clone(OPS_DEF), o.ops);
  if (o.frame) st.frame = Object.assign({ ...FRAME_DEF }, o.frame); if (o.cnc) st.cnc = Object.assign({ ...CNC_DEF }, o.cnc);
  if (o.size) for (const id of sizeIds) if (o.size[id] !== undefined) $(id).value = o.size[id];
  save('rs_params', st.params); save('rs_ops', st.ops); save('rs_frame', st.frame); save('rs_cnc', st.cnc); saveSize();
  buildSliders(); buildPanels(); drawCurve(); updateInfo(); $('backOpts').hidden = !backOn(); scheduleCompose(true);
}

// ================= project files =================
const f32 = a => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const asF32 = u => new Float32Array(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength));
async function bmpPNG(b) { const c = new OffscreenCanvas(b.width, b.height); c.getContext('2d').drawImage(b, 0, 0); return c.convertToBlob({ type: 'image/png' }); }
$('btnSaveProj').onclick = async () => {
  if (!st.depthKey || st.busy) return; st.busy = true; setProg(0.2, 'บันทึกโปรเจกต์…');
  try { const S = await wcall('getState', {}, null, 'state'), files = [];
    const meta = { v: 1, crop: st.crop, polys: st.polys, params: st.params, ops: st.ops, frame: st.frame, cnc: st.cnc, size: {}, w: S.w, h: S.h, res: S.res, depthKey: st.depthKey,
      layers: st.layers.map(L => ({ id: L.id, name: L.name, mode: L.mode, height: L.height, invert: L.invert, enabled: L.enabled })), focus: S.focus.map(f => f.id), hasCut: !!st.cutMask };
    for (const id of sizeIds) meta.size[id] = $(id).value; for (const id of ['lock', 'mirror', 'cutout', 'cutAI']) meta.size[id] = $(id).checked;
    files.push({ name: 'project.json', data: JSON.stringify(meta) }, { name: 'image.png', data: await bmpPNG(st.img) }, { name: 'grid.rgba', data: st.rgba });
    if (st.detailImg) files.push({ name: 'detail.png', data: await bmpPNG(st.detailImg) });
    for (const k of ['full', 'coarse', 'fine']) if (S[k]) files.push({ name: k + '.f32', data: f32(S[k]) });
    for (const f of S.focus) files.push({ name: `focus_${f.id}.mask`, data: f.mask }, { name: `focus_${f.id}.f32`, data: f32(f.depth) });
    files.push({ name: 'edits.f32', data: f32(st.E) }, { name: 'mask.f32', data: f32(st.Mk) }); if (st.cutMask) files.push({ name: 'cut.u8', data: st.cutMask });
    for (const L of st.layers) files.push({ name: `layer_${L.id}.png`, data: await bmpPNG(L.bmp) });
    dl(await zipFiles(files), baseName() + '.rsproj'); setProg(1, 'บันทึกโปรเจกต์แล้ว');
  } catch (e) { setProg(0, 'บันทึกไม่สำเร็จ: ' + e.message, true); } st.busy = false; };
$('fileProj').onchange = e => { const f = e.target.files[0]; if (f) openProject(f); e.target.value = ''; };
async function openProject(file) {
  if (st.busy) return; st.busy = true; setProg(0.1, 'เปิดโปรเจกต์…');
  try { const Z = await unzip(file), meta = JSON.parse(new TextDecoder().decode(Z.get('project.json')));
    const img = await createImageBitmap(new Blob([Z.get('image.png')])); setImage(img, true); st.crop = meta.crop; st.polys = meta.polys || [];
    if (Z.has('detail.png')) st.detailImg = await createImageBitmap(new Blob([Z.get('detail.png')]));
    applySettings({ params: meta.params, ops: meta.ops, frame: meta.frame, cnc: meta.cnc, size: meta.size }); clearTimeout(ctimer);
    for (const id of ['lock', 'mirror', 'cutout', 'cutAI']) if (meta.size[id] !== undefined) $(id).checked = meta.size[id];
    await ensureWorker(); st.rgba = Z.get('grid.rgba');
    const focus = (meta.focus || []).map(id => ({ id, mask: Z.get(`focus_${id}.mask`), depth: asF32(Z.get(`focus_${id}.f32`)) }));
    await wcall('setState', { w: meta.w, h: meta.h, res: meta.res, rgba: st.rgba.slice().buffer, full: asF32(Z.get('full.f32')), coarse: Z.has('coarse.f32') ? asF32(Z.get('coarse.f32')) : null, fine: Z.has('fine.f32') ? asF32(Z.get('fine.f32')) : null, focus }, null, 'stateSet');
    st.w = meta.w; st.h = meta.h; st.res = meta.res; st.depthKey = meta.depthKey; focus.forEach(f => st.focusDone.add(f.id));
    st.layers = []; for (const L of meta.layers || []) st.layers.push(Object.assign({}, L, { bmp: await createImageBitmap(new Blob([Z.get(`layer_${L.id}.png`)])), data: null }));
    st.cutMask = Z.has('cut.u8') ? Z.get('cut.u8') : null; renderPolys(); renderLayers(); drawImg();
    st.E = asF32(Z.get('edits.f32')); st.Mk = asF32(Z.get('mask.f32'));
    await composeNow(true); setProg(1, 'เปิดโปรเจกต์แล้ว — แก้ต่อได้ทันที');
  } catch (e) { console.error(e); setProg(0, 'เปิดโปรเจกต์ไม่สำเร็จ: ' + e.message, true); } st.busy = false;
}

$('btnHelp').onclick = () => $('help').showModal();
window.__rs = { st, sizes, showTab, build3D, recompute };
buildSliders(); buildPanels(); drawCurve(); updateInfo(); setMode('crop'); checkLicense();
if ($('model').value === 'base') $('model').onchange();
