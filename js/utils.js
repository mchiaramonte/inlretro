/**
 * utils.js — shared async helpers.
 */

/**
 * Returns a Promise that resolves after `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Compute MD5 of a Uint8Array and return a 32-char hex string (RFC 1321).
 * Browser's crypto.subtle does not support MD5, so this is a pure-JS implementation.
 *
 * @param {Uint8Array} data
 * @returns {string}  — 32 lowercase hex chars
 */
export function md5Hex(data) {
  const rotl = (x, n) => (x << n) | (x >>> (32 - n));

  // Pre-computed T[i] = floor(2^32 * |sin(i+1)|)
  const T = new Uint32Array(64);
  for (let i = 0; i < 64; i++) T[i] = Math.floor(4294967296 * Math.abs(Math.sin(i + 1)));

  // Per-round shift amounts
  const S = [
    7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
    5, 9,14,20, 5, 9,14,20, 5, 9,14,20, 5, 9,14,20,
    4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
    6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21,
  ];

  // Padding: append 0x80, then zeros, then 64-bit little-endian bit-length
  const n = data.length;
  const tail = (n + 1) % 64;
  const pad  = tail <= 56 ? 56 - tail : 56 + 64 - tail;
  const buf  = new Uint8Array(n + 1 + pad + 8);
  buf.set(data);
  buf[n] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 8, (n * 8) >>> 0, true);
  dv.setUint32(buf.length - 4, Math.floor(n / 0x20000000), true);

  // MD5 state
  let a0 = 0x67452301, b0 = 0xEFCDAB89, c0 = 0x98BADCFE, d0 = 0x10325476;

  for (let off = 0; off < buf.length; off += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true);
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if      (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d;           g = (3 * i + 5) % 16; }
      else             { f = c ^ (b | ~d);         g = (7 * i) % 16; }
      f = (f + a + T[i] + M[g]) >>> 0;
      a = d; d = c; c = b;
      b = (b + rotl(f, S[i])) >>> 0;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }

  // Output little-endian words as hex
  const le = x => [x, x >>> 8, x >>> 16, x >>> 24]
    .map(b => (b & 0xFF).toString(16).padStart(2, '0')).join('');
  return le(a0) + le(b0) + le(c0) + le(d0);
}
