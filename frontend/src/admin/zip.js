// ==========================================================
// Pembaca & penulis ZIP minimal (tanpa library tambahan).
//  - Baca : metode 0 (store) dan 8 (deflate) lewat DecompressionStream bawaan browser; CRC diperiksa.
//  - Tulis: store saja (PNG sudah terkompresi, XML kecil), nama file UTF-8.
// Pengaman untuk file yang tidak dipercaya: batas jumlah file & ukuran (anti zip-bomb), tidak mendukung ZIP64/enkripsi.
// ==========================================================

const MAX_ENTRIES = 500;
const MAX_FILE_BYTES = 80 * 1024 * 1024;
const MAX_TOTAL_BYTES = 250 * 1024 * 1024;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function inflateRaw(bytes, expectedSize) {
  if (typeof DecompressionStream === "undefined") throw new Error("Browser ini terlalu lama untuk membaca ZIP (butuh Chrome/Edge terbaru).");
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > expectedSize + 1 || total > MAX_FILE_BYTES) { reader.cancel(); throw new Error("Isi ZIP tidak wajar (ukuran melebihi yang tercatat)."); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** @returns {Promise<Map<string, Uint8Array>>} nama file (pemisah "/") -> isi. Folder dilewati. */
export async function readZip(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Bukan file ZIP yang valid.");
  const count = v.getUint16(eocd + 10, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error("ZIP64 tidak didukung.");
  if (count > MAX_ENTRIES) throw new Error("Terlalu banyak file di dalam ZIP.");

  const dec = new TextDecoder("utf-8");
  const files = new Map();
  let p = cdOffset;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > u8.length || v.getUint32(p, true) !== 0x02014b50) throw new Error("Struktur ZIP rusak.");
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true);
    const usize = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const localOffset = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, "/");
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue;                       // entri folder
    if (flags & 1) throw new Error("ZIP terenkripsi tidak didukung.");
    if (usize > MAX_FILE_BYTES) throw new Error(`File "${name}" terlalu besar.`);
    total += usize;
    if (total > MAX_TOTAL_BYTES) throw new Error("Total isi ZIP terlalu besar.");

    if (v.getUint32(localOffset, true) !== 0x04034b50) throw new Error("Struktur ZIP rusak (header lokal).");
    const start = localOffset + 30 + v.getUint16(localOffset + 26, true) + v.getUint16(localOffset + 28, true);
    const raw = u8.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflateRaw(raw, usize);
    else throw new Error(`Metode kompresi ZIP ${method} tidak didukung.`);
    if (data.length !== usize || crc32(data) !== crc) throw new Error(`File "${name}" di dalam ZIP rusak (CRC tidak cocok).`);
    files.set(name, data);
  }
  return files;
}

/** @param {{name: string, data: Uint8Array}[]} entries  @returns {Blob} application/zip */
export function writeZip(entries) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true); local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nameBytes.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime, true); cd.setUint16(14, dosDate, true); cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }

  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}
