/**
 * Relief Studio — รับคำสั่งซื้อจากหน้าขาย แล้วบันทึกลง Google Sheet
 *
 * วิธีติดตั้ง (ทำครั้งเดียว)
 *  1. เปิดชีต "Relief Studio – คำสั่งซื้อ" → เมนู ส่วนขยาย → Apps Script
 *  2. ลบโค้ดเดิมทั้งหมด วางไฟล์นี้แทน แล้วกดบันทึก
 *  3. ทำให้ใช้งานได้ → การทำให้ใช้งานได้รายการใหม่ → ประเภท: เว็บแอป
 *       เรียกใช้ในฐานะ: ฉัน   ·   ผู้มีสิทธิ์เข้าถึง: ทุกคน
 *  4. กดอนุญาตสิทธิ์ แล้วคัดลอก URL ที่ลงท้ายด้วย /exec
 *  5. เอา URL ไปใส่ orderEndpoint ใน relief/shop-config.js
 *
 * ทุกครั้งที่แก้โค้ดนี้ ต้อง "จัดการการทำให้ใช้งานได้" → แก้ไข → เวอร์ชันใหม่ ไม่งั้น URL เดิมยังรันโค้ดเก่า
 */

const SLIP_FOLDER_ID = '1tCTmdyLmfEkX6G6r2CIVzBUHbWZerjJZ';   // โฟลเดอร์ "สลิปลูกค้า" ใน Drive
const ORDER_SHEET = 'คำสั่งซื้อ';
const PRICE_SHEET = 'ราคา';
const APP_URL = 'https://bearpanda2012-wq.github.io/cnc-tools/relief/app/';
const MAX_SLIP_BYTES = 5 * 1024 * 1024;

// คอลัมน์ในชีตคำสั่งซื้อ (เริ่มที่ 1)
const COL = { time: 1, id: 2, name: 3, email: 4, contact: 5, plan: 6, amount: 7, slip: 8, note: 9, status: 10, expiry: 11, key: 12, channel: 13 };

/* ---------------- รับคำสั่งซื้อ ---------------- */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const d = JSON.parse(e.postData.contents);

    const name = clean_(d.name, 120), email = clean_(d.email, 160).toLowerCase();
    const contact = clean_(d.contact, 80), note = clean_(d.note, 500);
    const orderId = /^RS-\d{6}-[A-Z0-9]{4}$/.test(d.orderId || '') ? d.orderId : 'RS-' + Utilities.getUuid().slice(0, 8).toUpperCase();
    if (!name) return json_({ ok: false, error: 'กรุณากรอกชื่อ' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json_({ ok: false, error: 'อีเมลไม่ถูกต้อง' });

    const plan = getPlans_()[d.plan];
    if (!plan) return json_({ ok: false, error: 'ไม่พบแพ็กเกจนี้' });

    const sh = SpreadsheetApp.getActive().getSheetByName(ORDER_SHEET);
    const ids = sh.getLastRow() > 1 ? sh.getRange(2, COL.id, sh.getLastRow() - 1, 1).getValues().flat() : [];
    if (ids.indexOf(orderId) >= 0) return json_({ ok: true, orderId, duplicate: true });

    // สลิป
    let slipUrl = '';
    const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(d.slip || '');
    if (!m) return json_({ ok: false, error: 'ไม่พบรูปสลิป' });
    const bytes = Utilities.base64Decode(m[2]);
    if (bytes.length > MAX_SLIP_BYTES) return json_({ ok: false, error: 'รูปสลิปใหญ่เกินไป' });
    const ext = m[1].split('/')[1].replace('jpeg', 'jpg');
    const file = DriveApp.getFolderById(SLIP_FOLDER_ID).createFile(Utilities.newBlob(bytes, m[1], `${orderId}.${ext}`));
    slipUrl = file.getUrl();

    let amountNote = '';
    if (Number(d.amount) !== Number(plan.price)) amountNote = ` [หน้าเว็บส่งยอด ${d.amount}]`;

    sh.appendRow([new Date(), orderId, name, email, contact, plan.name, plan.price, slipUrl, note + amountNote, 'รอตรวจ', '', '', 'ฟอร์มเว็บ']);

    // แจ้งเจ้าของร้าน
    try {
      MailApp.sendEmail({
        to: Session.getEffectiveUser().getEmail(),
        subject: `[Relief Studio] คำสั่งซื้อใหม่ ${orderId} · ${plan.name} ฿${plan.price}`,
        body: `ชื่อ: ${name}\nอีเมล: ${email}\nติดต่อ: ${contact}\nแพ็กเกจ: ${plan.name} (${plan.days} วัน) ฿${plan.price}\nสลิป: ${slipUrl}\nหมายเหตุ: ${note}${amountNote}\n\nเปิดชีต: ${SpreadsheetApp.getActive().getUrl()}`
      });
    } catch (err) { /* โควตาอีเมลเต็ม ไม่ให้คำสั่งซื้อล้ม */ }

    return json_({ ok: true, orderId });
  } catch (err) {
    return json_({ ok: false, error: 'ระบบขัดข้อง ลองใหม่อีกครั้ง' });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function doGet() { return json_({ ok: true, service: 'Relief Studio orders' }); }

/* ---------------- เมนูในชีต ---------------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Relief Studio')
    .addItem('1) ใส่วันหมดอายุ (แถวที่เลือก)', 'fillExpiry')
    .addItem('2) ส่งรหัสให้ลูกค้าทางอีเมล (แถวที่เลือก)', 'sendKey')
    .addToUi();
}

/** ใส่วันหมดอายุ = วันนี้ + จำนวนวันของแพ็กเกจ และเปลี่ยนสถานะเป็น "ยืนยันแล้ว" */
function fillExpiry() {
  const { sh, row, v } = selectedOrder_(); if (!row) return;
  const plan = Object.values(getPlans_()).find(p => p.name === v[COL.plan - 1]);
  if (!plan) return SpreadsheetApp.getUi().alert('ไม่พบแพ็กเกจของแถวนี้ในชีต "ราคา"');
  const exp = new Date(); exp.setDate(exp.getDate() + Number(plan.days));
  sh.getRange(row, COL.expiry).setValue(exp).setNumberFormat('dd/mm/yyyy');
  if (v[COL.status - 1] === 'รอตรวจ' || !v[COL.status - 1]) sh.getRange(row, COL.status).setValue('ยืนยันแล้ว');
  SpreadsheetApp.getUi().alert(`หมดอายุ ${Utilities.formatDate(exp, 'Asia/Bangkok', 'dd/MM/yyyy')}\n\nออกรหัสด้วย keygen.mjs โดยใช้ ${plan.days} วัน แล้ววางรหัสในคอลัมน์ "รหัสใบอนุญาต"`);
}

/** ส่งรหัสในคอลัมน์ L ไปที่อีเมลลูกค้า */
function sendKey() {
  const ui = SpreadsheetApp.getUi();
  const { sh, row, v } = selectedOrder_(); if (!row) return;
  const key = String(v[COL.key - 1] || '').trim(), email = v[COL.email - 1], name = v[COL.name - 1];
  if (!key.startsWith('RS1-')) return ui.alert('ยังไม่มีรหัสใบอนุญาต (RS1-…) ในคอลัมน์ "รหัสใบอนุญาต"');
  if (!email) return ui.alert('แถวนี้ไม่มีอีเมลลูกค้า');
  const exp = v[COL.expiry - 1] ? Utilities.formatDate(new Date(v[COL.expiry - 1]), 'Asia/Bangkok', 'dd/MM/yyyy') : '-';
  if (ui.alert(`ส่งรหัสให้ ${name} <${email}> ?`, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;

  MailApp.sendEmail({
    to: email,
    subject: `รหัสใบอนุญาต Relief Studio (${v[COL.id - 1]})`,
    body:
`สวัสดีครับคุณ ${name}

ขอบคุณที่สั่งซื้อ Relief Studio แพ็กเกจ${v[COL.plan - 1]}
ใช้งานได้ถึง: ${exp}

รหัสใบอนุญาตของคุณ:
${key}

วิธีเปิดใช้งาน
1. เปิด ${APP_URL}
2. ไปที่หัวข้อ 11 "ใบอนุญาต"
3. วางรหัสด้านบนทั้งบรรทัด แล้วกด "เปิดใช้งาน"

ถ้ามีปัญหา ตอบกลับอีเมลนี้ได้เลยครับ
Relief Studio`
  });
  sh.getRange(row, COL.status).setValue('ส่งรหัสแล้ว');
  ui.alert('ส่งรหัสแล้ว');
}

/* ---------------- helpers ---------------- */
function getPlans_() {
  const rows = SpreadsheetApp.getActive().getSheetByName(PRICE_SHEET).getDataRange().getValues().slice(1);
  const out = {};
  rows.forEach(r => { if (r[0]) out[String(r[0]).trim()] = { id: String(r[0]).trim(), name: String(r[1]), price: Number(r[2]), days: Number(r[3]) }; });
  return out;
}
function selectedOrder_() {
  const sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== ORDER_SHEET) { SpreadsheetApp.getUi().alert(`เลือกแถวในชีต "${ORDER_SHEET}" ก่อน`); return {}; }
  const row = sh.getActiveRange().getRow();
  if (row < 2) { SpreadsheetApp.getUi().alert('เลือกแถวคำสั่งซื้อก่อน (ไม่ใช่แถวหัวตาราง)'); return {}; }
  return { sh, row, v: sh.getRange(row, 1, 1, COL.channel).getValues()[0] };
}
function clean_(s, max) { return String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max).replace(/^[=+\-@]/, "'$&"); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
