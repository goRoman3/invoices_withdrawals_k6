// k6/lib/totp.js — RFC 4226/6238 TOTP (Base32 + HMAC-SHA1) без зависимостей.
// Совместим с tools/totp-node/totp.js (CryptoJS): одинаковые входы → одинаковые коды.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32ToBytes(b32) {
  const s = b32.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = '';
  for (let i = 0; i < s.length; i++) {
    const v = B32.indexOf(s[i]);
    if (v < 0) throw new Error(`Invalid Base32 char: ${s[i]}`);
    bits += v.toString(2).padStart(5, '0');
  }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return out;
}

// минимальная SHA1 + HMAC-SHA1
function rotl(n, s) { return ((n << s) | (n >>> (32 - s))) >>> 0; }
function sha1(bytes) {
  const ml = bytes.length * 8;
  const withOne = bytes.concat([0x80]);
  while ((withOne.length % 64) !== 56) withOne.push(0);
  const lenArr = new Array(8).fill(0);
  for (let i = 0; i < 8; i++) lenArr[7 - i] = (ml >>> (i * 8)) & 0xff;
  const m = withOne.concat(lenArr);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;

  function toWords(a) {
    const w = [];
    for (let i = 0; i < a.length; i += 4) {
      w.push(((a[i] << 24) | (a[i + 1] << 16) | (a[i + 2] << 8) | a[i + 3]) >>> 0);
    }
    return w;
  }

  for (let i = 0; i < m.length; i += 64) {
    const chunk = m.slice(i, i + 64);
    const words = toWords(chunk);
    const w = new Array(80);
    for (let t = 0; t < 16; t++) w[t] = words[t];
    for (let t = 16; t < 80; t++) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);

    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      let f, k;
      if (t < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (t < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const temp = (rotl(a, 5) + f + e + k + w[t]) >>> 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out = [];
  for (const h of [h0, h1, h2, h3, h4]) out.push((h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff, h & 0xff);
  return out;
}
function hmacSha1(keyBytes, msgBytes) {
  const block = 64;
  const k = keyBytes.slice();
  if (k.length > block) k.splice(0, k.length, ...sha1(k));
  while (k.length < block) k.push(0x00);
  const o = k.map((b) => b ^ 0x5c);
  const i = k.map((b) => b ^ 0x36);
  return sha1(o.concat(sha1(i.concat(msgBytes))));
}

export function generateTOTP(secretBase32, epochMs = Date.now(), stepSec = 30, digits = 6) {
  const key = base32ToBytes(secretBase32 || '');
  const counter = Math.floor(Math.floor(epochMs / 1000) / stepSec);
  const msg = [];
  for (let i = 7; i >= 0; i--) msg.push((counter >>> (i * 8)) & 0xff);
  const h = hmacSha1(key, msg);
  const offset = h[h.length - 1] & 0x0f;
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | (h[offset + 3]);
  return (bin % Math.pow(10, digits)).toString().padStart(digits, '0');
}
