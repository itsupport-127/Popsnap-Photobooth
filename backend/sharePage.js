// ==========================================================
// Halaman unduh sesi (/s/<token>) + ZIP semua file.
// QR sesi foto membuka SATU halaman berisi foto template, GIF, video template, semua foto mentah,
// dan (template animasi) klip mentah per foto — tamu bisa mengunduh satu per satu atau "Unduh semua (ZIP)".
// ==========================================================
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const extOf = (p) => (path.extname(String(p || "")).slice(1) || "bin").toLowerCase();

/** Daftar file milik satu sesi, urut tampil. */
function listFiles(db, session) {
  const out = [];
  const add = (label, p, name, group) => { if (p) out.push({ label, path: p, ext: extOf(p), name: `${name}.${extOf(p)}`, group }); };
  add("Foto template", session.final_image_path, "popsnap-foto", "main");
  add("Video Live (momen bergerak)", session.video_path, "popsnap-live", "main");
  const liveRow = db.prepare("SELECT path FROM session_files WHERE session_id = ? AND kind = 'live' LIMIT 1").get(session.id);
  if (liveRow && !session.video_path) add("Video Live (momen bergerak)", liveRow.path, "popsnap-live", "main");
  add("GIF foto", session.gif_path, "popsnap-gif", "main");
  const plainRow = db.prepare("SELECT path FROM session_files WHERE session_id = ? AND kind = 'gifplain' LIMIT 1").get(session.id);
  if (plainRow) add("GIF foto polos", plainRow.path, "popsnap-gif-polos", "main");
  const raws = db.prepare("SELECT idx, path FROM session_files WHERE session_id = ? AND kind = 'raw' ORDER BY idx").all(session.id);
  for (const r of raws) add(`Foto mentah ${r.idx}`, r.path, `popsnap-mentah-${r.idx}`, "raw");
  const clips = db.prepare("SELECT idx, path FROM session_files WHERE session_id = ? AND kind = 'clip' ORDER BY idx").all(session.id);
  for (const c of clips) add(`Klip foto ${c.idx}`, c.path, `popsnap-klip-${c.idx}`, "clips");
  return out;
}

const isVideo = (f) => f.ext === "mp4" || f.ext === "webm";

function renderPage({ files, storeName, token, preparing }) {
  const main = files.filter((f) => f.group === "main");
  const clips = files.filter((f) => f.group === "clips");
  const raws = files.filter((f) => f.group === "raw");
  const media = (f, big) => {
    if (isVideo(f)) return `<video src="${esc(f.path)}" ${big ? "autoplay muted loop" : ""} controls playsinline preload="metadata"></video>`;
    return `<img src="${esc(f.path)}" alt="${esc(f.label)}" loading="lazy">`;
  };
  const card = (f, big) => `<section class="card${big ? " big" : ""}">
  <div class="media">${media(f, big)}</div>
  <div class="row"><b>${esc(f.label)}</b><a class="btn" href="${esc(f.path)}" download="${esc(f.name)}">Unduh</a></div>
</section>`;
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(storeName)} — File kamu</title>
<style>
:root{--bg:#4082AE;--ink:#181B23;--red:#E02843;--yellow:#FDB533}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink)}
header{padding:22px 16px 6px;text-align:center;color:#fff}header h1{margin:0;font-size:22px}header p{margin:6px 0 0;opacity:.92;font-size:14px}
main{max-width:640px;margin:0 auto;padding:12px 16px 40px;display:grid;gap:14px}
.card{background:#fff;border:2px solid #000;border-radius:18px;overflow:hidden}
.media{background:#f2f2f2;display:flex;justify-content:center}.media img,.media video{display:block;max-width:100%;max-height:70vh}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px}
.btn{background:var(--red);color:#fff;text-decoration:none;font-weight:700;padding:9px 18px;border-radius:999px;border:2px solid #000;white-space:nowrap}
.all{display:block;text-align:center;background:var(--yellow);color:#3A2E00;font-weight:800;font-size:17px;text-decoration:none;padding:14px;border-radius:999px;border:2px solid #000}
h2{margin:8px 0 0;color:#fff;font-size:16px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.grid .card .row{padding:8px 10px;flex-direction:column;align-items:stretch;text-align:center}.grid .btn{text-align:center;padding:7px}
.note{color:#fff;text-align:center;font-size:13px;opacity:.95}
footer{text-align:center;color:#fff;opacity:.8;font-size:12px;padding-bottom:24px}
</style></head><body>
<header><h1>${esc(storeName)}</h1><p>File sesi foto kamu sudah siap 🎉</p></header>
<main>
${files.length ? `<a class="all" href="/s/${esc(token)}/all.zip">⬇ Unduh semua (ZIP)</a>` : ""}
${main.map((f, i) => card(f, i === 0 || f.ext === "gif")).join("\n")}
${raws.length ? `<h2>Foto mentah (belum masuk template)</h2><div class="grid">${raws.map((f) => card(f, false)).join("\n")}</div>` : ""}
${clips.length ? `<h2>Klip mentah per foto</h2><div class="grid">${clips.map((f) => card(f, false)).join("\n")}</div>` : ""}
${preparing ? `<p class="note" id="prep">Beberapa file masih disiapkan — halaman ini memperbarui sendiri.</p>` : ""}
${!files.length ? `<p class="note">File belum tersedia. Coba muat ulang sebentar lagi.</p>` : ""}
</main>
<footer>Link ini berlaku sementara. Simpan filenya ke galeri kamu.</footer>
<script>
(function(){var n=${files.length},tries=0,t=setInterval(function(){
 if(++tries>25){clearInterval(t);var p=document.getElementById('prep');if(p)p.remove();return}
 fetch('/s/${esc(token)}/files.json',{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){if(d.files.length!==n){clearInterval(t);location.reload()}}).catch(function(){})},4000)})();
</script></body></html>`;
}

const notFoundPage = (storeName) => `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link tidak ditemukan</title></head>
<body style="font-family:system-ui;background:#4082AE;color:#fff;text-align:center;padding:48px 20px"><h2>Link tidak ditemukan atau sudah kedaluwarsa</h2><p>${esc(storeName)}</p></body></html>`;

// ---------- ZIP tanpa kompresi (STORE): foto/video/GIF sudah terkompresi, jadi tidak perlu dependensi tambahan ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function buildZip(entries) {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8"), data = e.data, crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

/** Pasang rute /s/:token di aplikasi Express. */
function mount(app, { db, backendDir, getStoreName }) {
  const find = (token) => (/^[A-Za-z0-9_-]{10,40}$/.test(String(token)) ? db.prepare("SELECT * FROM sessions WHERE share_token = ?").get(String(token)) : null);
  const fresh = (s) => Date.now() - Date.parse(`${String(s.created_at).replace(" ", "T")}Z`) < 2 * 60 * 1000;
  const noStore = (res) => res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });

  app.get("/s/:token", (req, res) => {
    noStore(res);
    const s = find(req.params.token);
    if (!s) return res.status(404).type("html").send(notFoundPage(getStoreName()));
    res.type("html").send(renderPage({ files: listFiles(db, s), storeName: getStoreName(), token: req.params.token, preparing: fresh(s) }));
  });
  app.get("/s/:token/files.json", (req, res) => {
    noStore(res);
    const s = find(req.params.token);
    if (!s) return res.status(404).json({ files: [] });
    res.json({ files: listFiles(db, s).map((f) => ({ label: f.label, url: f.path, name: f.name })) });
  });
  app.get("/s/:token/all.zip", (req, res) => {
    noStore(res);
    const s = find(req.params.token);
    if (!s) return res.status(404).type("html").send(notFoundPage(getStoreName()));
    const entries = [];
    for (const f of listFiles(db, s)) {
      const abs = path.join(backendDir, f.path);
      if (!abs.startsWith(path.join(backendDir, "uploads") + path.sep)) continue; // hanya file di folder uploads
      try { entries.push({ name: f.group === "clips" ? `klip/${f.name}` : f.group === "raw" ? `foto-mentah/${f.name}` : f.name, data: fs.readFileSync(abs) }); } catch { /* file sudah terhapus: lewati */ }
    }
    if (!entries.length) return res.status(404).type("html").send(notFoundPage(getStoreName()));
    const zip = buildZip(entries);
    res.set({ "Content-Type": "application/zip", "Content-Length": zip.length, "Content-Disposition": 'attachment; filename="popsnap-sesi.zip"' }).send(zip);
  });
}

module.exports = { mount, listFiles, buildZip, crc32 };
