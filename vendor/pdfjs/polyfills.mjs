// Small fill-ins for very new JavaScript features that PDF.js 6 uses but the
// Mac app's built-in Chromium may not have yet. Each one is only added if it's
// missing, so newer versions use the real thing. Loaded before PDF.js in the
// page (js/media.js) and in its worker (worker.mjs). Not part of PDF.js.
const def = (obj, name, fn) => {
  if (obj && typeof obj[name] !== 'function') {
    Object.defineProperty(obj, name, { value: fn, writable: true, configurable: true });
  }
};

for (const M of [Map, WeakMap]) {
  def(M.prototype, 'getOrInsert', function (key, value) {
    if (!this.has(key)) this.set(key, value);
    return this.get(key);
  });
  def(M.prototype, 'getOrInsertComputed', function (key, compute) {
    if (!this.has(key)) this.set(key, compute(key));
    return this.get(key);
  });
}

def(Math, 'sumPrecise', function (items) {
  // Neumaier summation: accurate enough for drawing pages.
  let sum = 0, c = 0, any = false;
  for (const x of items) {
    if (typeof x !== 'number') throw new TypeError('Math.sumPrecise needs numbers');
    any = true;
    const t = sum + x;
    c += Math.abs(sum) >= Math.abs(x) ? (sum - t) + x : (x - t) + sum;
    sum = t;
  }
  return any ? sum + c : -0;
});

def(Promise, 'try', function (fn, ...args) {
  return new Promise((resolve) => resolve(fn(...args)));
});

def(Uint8Array.prototype, 'toHex', function () {
  let s = '';
  for (let i = 0; i < this.length; i++) s += this[i].toString(16).padStart(2, '0');
  return s;
});
def(Uint8Array, 'fromHex', function (hex) {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
});
def(Uint8Array.prototype, 'toBase64', function (opts) {
  let bin = '';
  for (let i = 0; i < this.length; i += 0x8000) bin += String.fromCharCode.apply(null, this.subarray(i, i + 0x8000));
  let s = btoa(bin);
  if (opts && opts.alphabet === 'base64url') s = s.replace(/\+/g, '-').replace(/\//g, '_');
  if (opts && opts.omitPadding) s = s.replace(/=+$/, '');
  return s;
});
def(Uint8Array, 'fromBase64', function (str, opts) {
  let s = String(str).replace(/\s+/g, '');
  if (opts && opts.alphabet === 'base64url') s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
});
