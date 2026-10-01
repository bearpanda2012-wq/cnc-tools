/* CNC Tools — Service Worker */
const VER   = 'cnc-tools-v1';
const SHELL = VER + '-shell';
const RUN   = VER + '-run';
const CDN   = VER + '-cdn';

/* ไฟล์หลักที่ต้องมีไว้ให้ใช้ออฟไลน์ */
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

/* หน้าเครื่องมือ — ถ้าโฟลเดอร์ไหนยังไม่มี จะข้ามไป ไม่ทำให้ติดตั้งล้มทั้งชุด */
const TOOLS = [
  './sheetcnc/',
  './sheetcnc/index.html',
  './pattern-generator/',
  './pattern-generator/index.html',
  './line-tracer/',
  './line-tracer/index.html'
];

async function addAll(cache, list){
  for(const url of list){
    try{ await cache.add(new Request(url, {cache:'reload'})); }
    catch(e){ /* ข้ามไฟล์ที่ไม่มี */ }
  }
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await addAll(c, CORE);
    await addAll(c, TOOLS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(VER)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if(e.data === 'skipWaiting') self.skipWaiting();
  if(e.data === 'version' && e.source) e.source.postMessage({version: VER});
});

const CDN_HOSTS = ['cdn.jsdelivr.net','unpkg.com','cdnjs.cloudflare.com','esm.sh','esm.run'];

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;

  let url;
  try{ url = new URL(req.url); }catch(_){ return; }
  if(url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* ไลบรารีจาก CDN — cache first แล้วใช้ออฟไลน์ได้ */
  if(CDN_HOSTS.includes(url.hostname)){
    e.respondWith((async () => {
      const c = await caches.open(CDN);
      const hit = await c.match(req);
      if(hit) return hit;
      try{
        const res = await fetch(req);
        if(res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
        return res;
      }catch(err){
        return hit || Response.error();
      }
    })());
    return;
  }

  if(url.origin !== location.origin) return;

  /* การเปิดหน้า — ลองเน็ตก่อน ถ้าไม่มีเน็ตใช้ของที่เก็บไว้ */
  if(req.mode === 'navigate'){
    e.respondWith((async () => {
      try{
        const res = await fetch(req);
        const c = await caches.open(RUN);
        c.put(req, res.clone());
        return res;
      }catch(err){
        return (await caches.match(req)) ||
               (await caches.match('./index.html')) ||
               (await caches.match('./')) ||
               new Response('ออฟไลน์ และยังไม่มีหน้านี้เก็บไว้', {status:503, headers:{'Content-Type':'text/plain; charset=utf-8'}});
      }
    })());
    return;
  }

  /* ไฟล์อื่นในเว็บเดียวกัน — ใช้ของเก่าทันที แล้วอัปเดตเบื้องหลัง */
  e.respondWith((async () => {
    const hit = await caches.match(req);
    const net = fetch(req).then(async res => {
      if(res && res.ok){ const c = await caches.open(RUN); c.put(req, res.clone()); }
      return res;
    }).catch(() => null);
    if(hit){ e.waitUntil(net); return hit; }
    const res = await net;
    return res || new Response('', {status:504});
  })());
});
