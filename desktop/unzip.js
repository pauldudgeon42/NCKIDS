/*
 * Unpack the videos and pictures from a .zip (ProContent sells motion backgrounds
 * as packs). Plain Node, no packages. Streams each file to disk, so multi-gigabyte
 * 4K packs don't have to fit in memory. Handles normal and ZIP64 archives, and
 * "stored" and "deflated" entries, which is what zip tools on a Mac produce.
 *
 *   await extractMedia('/path/pack.zip', '/out/folder', ['.mp4', '.mov', '.jpg'])
 *     -> [{ path, name, size }]   (only files with those extensions; folders flattened)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');

async function readAt(fh, pos, len) {
  const buf = Buffer.alloc(len);
  const { bytesRead } = await fh.read(buf, 0, len, pos);
  return buf.subarray(0, bytesRead);
}

/** List the entries in the zip's central directory. */
async function listEntries(fh, size) {
  // End of central directory: in the last 64 KB + 22 bytes.
  const tailLen = Math.min(size, 65557);
  const tail = await readAt(fh, size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This isn’t a zip file, or it is damaged.');
  let count = tail.readUInt16LE(eocd + 10);
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  // ZIP64: a locator sits just before the end record.
  if (eocd >= 20 && tail.readUInt32LE(eocd - 20) === 0x07064b50) {
    const z64pos = Number(tail.readBigUInt64LE(eocd - 20 + 8));
    const z = await readAt(fh, z64pos, 56);
    if (z.readUInt32LE(0) === 0x06064b50) {
      count = Number(z.readBigUInt64LE(32));
      cdSize = Number(z.readBigUInt64LE(40));
      cdOffset = Number(z.readBigUInt64LE(48));
    }
  }
  const cd = await readAt(fh, cdOffset, cdSize);
  const entries = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= cd.length; n++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('The zip file is damaged.');
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    let csize = cd.readUInt32LE(p + 20);
    let usize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
    let local = cd.readUInt32LE(p + 42);
    const nameBuf = cd.subarray(p + 46, p + 46 + nameLen);
    const name = (flags & 0x800) ? nameBuf.toString('utf8') : nameBuf.toString('latin1');
    // ZIP64 sizes/offset live in extra field 0x0001, in this order, only for the values that are 0xFFFFFFFF.
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = cd.readUInt16LE(e), len = cd.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (local === 0xffffffff) { local = Number(cd.readBigUInt64LE(q)); q += 8; }
      }
      e += 4 + len;
    }
    entries.push({ name, method, csize, usize, local, encrypted: !!(flags & 1) });
    p = eEnd + commentLen;
  }
  return entries;
}

function safeName(entryName, used) {
  let base = path.basename(entryName.replace(/\\/g, '/')).replace(/[\x00-\x1f/:]/g, '_').trim() || 'file';
  const ext = path.extname(base), stem = base.slice(0, base.length - ext.length);
  let n = 2;
  while (used.has(base.toLowerCase())) base = `${stem} ${n++}${ext}`;
  used.add(base.toLowerCase());
  return base;
}

async function extractMedia(zipPath, outDir, exts) {
  const want = new Set(exts.map((x) => x.toLowerCase()));
  const fh = await fs.promises.open(zipPath, 'r');
  const out = [];
  try {
    const { size } = await fh.stat();
    const entries = await listEntries(fh, size);
    await fs.promises.mkdir(outDir, { recursive: true });
    const used = new Set();
    for (const en of entries) {
      const parts = en.name.replace(/\\/g, '/').split('/');
      const base = parts[parts.length - 1];
      if (!base || en.name.endsWith('/')) continue;                         // a folder
      if (parts.includes('__MACOSX') || base.startsWith('._') || base.startsWith('.')) continue; // Mac leftovers
      if (!want.has(path.extname(base).toLowerCase())) continue;
      if (en.encrypted) throw new Error('This zip file has a password, so it can’t be unpacked here.');
      if (en.method !== 0 && en.method !== 8) throw new Error(`${base} is packed in a way this app can’t unpack. Unzip it in Finder and import it instead.`);
      const lh = await readAt(fh, en.local, 30);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error('The zip file is damaged.');
      const dataStart = en.local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const dest = path.join(outDir, safeName(base, used));
      const src = fs.createReadStream(null, { fd: fh.fd, autoClose: false, start: dataStart, end: dataStart + en.csize - 1 });
      if (en.csize === 0) await fs.promises.writeFile(dest, '');
      else if (en.method === 0) await pipeline(src, fs.createWriteStream(dest));
      else await pipeline(src, zlib.createInflateRaw(), fs.createWriteStream(dest));
      const st = await fs.promises.stat(dest);
      if (st.size !== en.usize) throw new Error(`${base} didn’t unpack completely.`);
      out.push({ path: dest, name: path.basename(dest), size: st.size });
    }
  } finally {
    await fh.close();
  }
  return out;
}

module.exports = { extractMedia, listEntries };
