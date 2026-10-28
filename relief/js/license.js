/* Offline license check (ECDSA P-256). The private signing key is NOT in this repo. */
const PUB = {"kty":"EC","x":"FxFWSmOHJ1fmle2r51cMToVl1aGjdQPmi4Wi8f4CAD8","y":"967T7qmyYWp97jXfEBeYUPUolEQTPvjJqZ3CCER6Wts","crv":"P-256"};
const b64d = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
export async function verifyKey(key) {
  try {
    key = (key || '').trim(); if (!key.startsWith('RS1-')) return null;
    const [body, sig] = key.slice(4).split('.'); if (!body || !sig) return null;
    const k = await crypto.subtle.importKey('jwk', PUB, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, b64d(sig), new TextEncoder().encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(b64d(body)));
    if (p.e && Date.now() / 1000 > p.e) return Object.assign(p, { expired: true });
    return p;
  } catch (e) { return null; }
}
