/* Relief Studio — sales page logic. Settings live in shop-config.js */
(() => {
  const C = window.RS_SHOP || {};
  const plans = C.plans || [];
  const $ = id => document.getElementById(id);
  const baht = n => Number(n).toLocaleString('th-TH');
  let cur = plans[plans.length - 1] || null;   // default: yearly (last)

  /* ---------- PromptPay EMVCo payload ---------- */
  const tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;
  function crc16(s) {
    let c = 0xFFFF;
    for (let i = 0; i < s.length; i++) {
      c ^= s.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF;
    }
    return c.toString(16).toUpperCase().padStart(4, '0');
  }
  function promptpayPayload(target, amount) {
    const t = String(target).replace(/\D/g, '');
    let acc;
    if (t.length >= 15) acc = tlv('03', t);                                    // e-wallet
    else if (t.length >= 13) acc = tlv('02', t);                               // national / tax ID
    else acc = tlv('01', ('0000000000000' + t.replace(/^0/, '66')).slice(-13)); // mobile
    let s = tlv('00', '01') + tlv('01', amount ? '12' : '11') +
      tlv('29', tlv('00', 'A000000677010111') + acc) +
      tlv('58', 'TH') + tlv('53', '764') + (amount ? tlv('54', Number(amount).toFixed(2)) : '') + '6304';
    return s + crc16(s);
  }
  window.__promptpayPayload = promptpayPayload; // for testing

  /* ---------- plans ---------- */
  function renderPlans() {
    const box = $('plans'); box.innerHTML = '';
    plans.forEach(p => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'plan'; b.setAttribute('aria-pressed', p === cur);
      b.innerHTML = `<div class="pn"></div><div class="pp">฿${baht(p.price)} <small></small></div>${p.badge ? '<span class="pb"></span>' : ''}<div class="pick">${p === cur ? 'เลือกแล้ว' : 'เลือกแพ็กเกจนี้'}</div>`;
      b.querySelector('.pn').textContent = p.name;
      b.querySelector('small').textContent = p.unit || '';
      if (p.badge) b.querySelector('.pb').textContent = p.badge;
      b.onclick = () => { cur = p; renderPlans(); renderBuy(); };
      box.appendChild(b);
    });
    const sel = $('formPlan'); sel.innerHTML = '';
    plans.forEach(p => { const o = new Option(`${p.name} — ฿${baht(p.price)}`, p.id); o.selected = p === cur; sel.add(o); });
  }
  $('formPlan').onchange = e => { cur = plans.find(p => p.id === e.target.value) || cur; renderPlans(); renderBuy(); };

  /* ---------- payment tabs ---------- */
  const hasPP = !!C.promptpay;
  const hasCard = () => !!(C.cardCheckout && cur && C.cardCheckout[cur.id]);
  const anyCard = !!(C.cardCheckout && Object.values(C.cardCheckout).some(Boolean));
  let tab = hasPP ? 'pp' : 'card';

  function renderTabs() {
    const t = $('payTabs'); t.innerHTML = '';
    const items = [];
    if (hasPP) items.push(['pp', 'โอนเงิน / PromptPay']);
    if (anyCard) items.push(['card', 'บัตรเครดิต / เดบิต']);
    if (items.length < 2) { t.hidden = true; }
    items.forEach(([id, label]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.role = 'tab'; b.textContent = label; b.setAttribute('aria-selected', id === tab);
      b.onclick = () => { tab = id; renderTabs(); renderBuy(); };
      t.appendChild(b);
    });
    $('paySoon').hidden = items.length > 0;
  }

  function renderBuy() {
    if (!cur) return;
    $('buyPlan').textContent = `${cur.name} · ฿${baht(cur.price)}`;
    $('pane-pp').hidden = !(hasPP && tab === 'pp');
    $('pane-card').hidden = !(anyCard && tab === 'card');

    if (hasPP) {
      const qr = qrcode(0, 'M'); qr.addData(promptpayPayload(C.promptpay, cur.price)); qr.make();
      $('qr').innerHTML = '<div class="pplogo">PromptPay</div>' + qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      $('ppAmt').textContent = '฿' + Number(cur.price).toLocaleString('th-TH', { minimumFractionDigits: 2 });
      $('ppName').textContent = C.accountName ? 'ชื่อบัญชี: ' + C.accountName : '';
      $('ppBank').textContent = C.bank ? 'หรือโอนเข้าบัญชี ' + C.bank : '';
    }
    const line = $('btnLine');
    if (C.lineId) {
      const id = C.lineId.trim();
      line.href = id.startsWith('@') ? 'https://line.me/R/ti/p/' + encodeURIComponent(id) : 'https://line.me/ti/p/~' + encodeURIComponent(id);
      line.textContent = `ส่งสลิปทาง LINE (${id})`; line.hidden = false;
    }
    $('btnShowForm').hidden = !C.orderEndpoint;
    if (!C.lineId && !C.orderEndpoint) $('orderForm').hidden = true;

    document.querySelectorAll('.cardName').forEach(e => e.textContent = C.cardProvider || 'Gumroad');
    const card = $('btnCard');
    if (hasCard()) { card.href = C.cardCheckout[cur.id]; card.hidden = false; }
    else card.hidden = true;
  }

  $('btnShowForm').onclick = () => { const f = $('orderForm'); f.hidden = false; f.querySelector('input[name=name]').focus(); };

  /* ---------- order form ---------- */
  function shrinkImage(file, max = 1600) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('อ่านรูปสลิปไม่ได้')); };
      img.src = url;
    });
  }
  function orderId() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `RS-${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }

  $('orderForm').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, msg = $('formMsg'), btn = $('btnSubmit');
    if (f.website.value) return;                       // bot
    const file = f.slip.files[0];
    if (!file) { msg.className = 'formmsg err'; msg.textContent = 'กรุณาแนบสลิปการโอน'; return; }
    btn.disabled = true; msg.className = 'formmsg'; msg.textContent = 'กำลังส่ง…';
    try {
      const id = orderId();
      const body = {
        orderId: id, name: f.name.value.trim(), email: f.email.value.trim(), contact: f.contact.value.trim(),
        plan: cur.id, amount: cur.price, note: f.note.value.trim(), slip: await shrinkImage(file), page: location.href
      };
      let ok = false, text = '';
      try {
        const r = await fetch(C.orderEndpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
        const j = await r.json(); ok = !!j.ok; text = j.error || '';
      } catch (err) {
        // response unreadable (CORS) — retry blind so the order still lands
        await fetch(C.orderEndpoint, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
        ok = true;
      }
      if (!ok) throw new Error(text || 'ส่งไม่สำเร็จ');
      f.reset(); renderPlans();
      msg.className = 'formmsg ok';
      msg.textContent = `ได้รับคำสั่งซื้อแล้ว เลขที่ ${id} — เราจะส่งรหัสไปที่ ${body.email} ภายใน 24 ชั่วโมง`;
    } catch (err) {
      msg.className = 'formmsg err';
      msg.textContent = 'ส่งไม่สำเร็จ: ' + err.message + (C.lineId ? ` — ส่งสลิปทาง LINE ${C.lineId} แทนได้` : '');
    } finally { btn.disabled = false; }
  };

  /* ---------- footer ---------- */
  const fc = $('footContact'); const bits = [];
  if (C.lineId) bits.push('LINE ' + C.lineId);
  if (C.email) bits.push(C.email);
  fc.textContent = bits.length ? 'ติดต่อ: ' + bits.join(' · ') : '';

  if (!hasPP) tab = 'card';
  renderPlans(); renderTabs(); renderBuy();
})();
