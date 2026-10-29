/* Minimal ZIP (store, no compression) writer/reader for project files and tiled exports. */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const enc = new TextEncoder();
export async function zipFiles(files) {           // files: [{name, data: Uint8Array|Blob|string}]
  const parts = [], central = []; let off = 0;
  for (const f of files) {
    let d = f.data; if (typeof d === 'string') d = enc.encode(d); else if (d instanceof Blob) d = new Uint8Array(await d.arrayBuffer()); else if (!(d instanceof Uint8Array)) d = new Uint8Array(d.buffer || d);
    const name = enc.encode(f.name), crc = crc32(d), h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, d);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name); off += 30 + name.length + d.length;
  }
  const cs = central.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
}
export async function unzip(blob) {                // returns Map name -> Uint8Array (stored entries only)
  const b = new Uint8Array(await blob.arrayBuffer()), dv = new DataView(b.buffer), out = new Map(), dec = new TextDecoder();
  let e = b.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--; if (e < 0) throw new Error('ไม่ใช่ไฟล์โปรเจกต์');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  for (let i = 0; i < n; i++) {
    const size = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nl)), lnl = dv.getUint16(lo + 26, true), lxl = dv.getUint16(lo + 28, true);
    if (dv.getUint16(p + 10, true) !== 0) throw new Error('รองรับเฉพาะไฟล์ที่ไม่บีบอัด');
    out.set(name, b.slice(lo + 30 + lnl + lxl, lo + 30 + lnl + lxl + size)); p += 46 + nl + xl + cl;
  }
  return out;
}
