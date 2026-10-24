// ==========================================================
// Galeri cloud: unggah hasil sesi ke layanan POPSNAP Galeri (popsnap-gallery, di VPS) supaya QR membuka halaman web
// (hasil template di atas, foto mentah & klip di bawah) yang bisa dibuka dari mana saja — bukan hanya satu WiFi dengan booth.
//
// - File TIDAK lewat VPS: booth minta URL unggah bertanda tangan ke galeri lalu mengunggah langsung ke bucket cloud (R2/S3).
// - Offline-first: sesi dicatat di tabel gallery_sync; unggahan berjalan di latar & diulang sampai berhasil. QR sudah memakai
//   alamat galeri sejak awal; halaman otomatis terisi begitu file tiba.
// - Token studio & kode studio = yang dipakai sinkron kasir (Pengaturan > Pembayaran). Alamat galeri: payment.cloud.galleryUrl.
// ==========================================================
const fs = require("fs");
const path = require("path");
const db = require("./db");
const config = require("./config");
const settingsStore = require("./settings");
const { nanoid } = require("nanoid");

db.exec(`
  CREATE TABLE IF NOT EXISTS gallery_sync (
    session_id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    mode TEXT,
    state TEXT NOT NULL DEFAULT 'active',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_try INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS gallery_files (
    session_id TEXT NOT NULL,
    fid TEXT NOT NULL,
    PRIMARY KEY (session_id, fid)
  );
`);

try { db.exec("ALTER TABLE gallery_sync ADD COLUMN folder TEXT"); } catch { /* sudah ada */ } // folder arsip (unggah manual dari admin)

const ACTIVE_MS = 30 * 60 * 1000;       // sesi masih diperiksa untuk file susulan (GIF/video/klip) selama 30 menit
const GIVE_UP_MS = 3 * 24 * 3600 * 1000; // lewat ini tidak dicoba lagi
const state = { lastOkAt: null, lastError: null, busy: false, timer: null };
const failedFid = new Map(); // session_id -> fid yang gagal diunggah (minta bucket lain)

function cfg() { return settingsStore.load().payment.cloud; }
function baseUrl() { return String(cfg().galleryUrl || "").trim().replace(/\/+$/, ""); }
function ready() { const c = cfg(); return !!(c.galleryEnabled && baseUrl() && c.token); }
const enabled = ready;

/** Alamat halaman untuk QR (dipakai sejak sesi dibuat, sebelum file selesai diunggah). */
function shareUrlFor(token) { return ready() ? `${baseUrl()}/s/${token}` : null; }

function enqueue(sessionId, token, mode) {
  if (!ready() || !token) return;
  db.prepare("INSERT OR IGNORE INTO gallery_sync (session_id, token, mode, created_at) VALUES (?, ?, ?, ?)").run(sessionId, token, mode || "photo", Date.now());
  nudge();
}

// ---------- daftar file sesi (dari database + folder uploads) ----------
const diskPath = (p) => (p ? path.join(config.dataDir, p) : null);
const extOf = (p) => (path.extname(String(p || "")).slice(1) || "").toLowerCase();
/** File di folder arsip permanen: final.png | boomerang.gif | session.gif | video.* | live.* | gifplain.* | raw/shot-N.jpg | clips/clip-N.* */
function listFolder(folder) {
  const out = [];
  const stat = (abs) => { try { const st = fs.statSync(abs); return st.isFile() && st.size > 0 ? st.size : 0; } catch { return 0; } };
  const add = (fid, kind, idx, abs) => { const size = stat(abs); if (size) out.push({ fid, kind, idx, ext: extOf(abs), abs, size }); };
  let names = []; try { names = fs.readdirSync(folder); } catch { return out; }
  for (const n of names) {
    const abs = path.join(folder, n), base = path.parse(n).name;
    if (base === "final") add("final", "final", 0, abs);
    else if (base === "boomerang") add("final", "boomerang", 0, abs);
    else if (base === "session") add("gif", "gif", 0, abs);
    else if (base === "video") add("video", "video", 0, abs);
    else if (base === "live") add("live", "live", 0, abs);
    else if (base === "gifplain") add("gifplain", "gifplain", 0, abs);
  }
  for (const [sub, re, kind] of [["raw", /^shot-(\d+)\./, "raw"], ["clips", /^clip-(\d+)\./, "clip"]]) {
    let list = []; try { list = fs.readdirSync(path.join(folder, sub)); } catch { continue; }
    for (const n of list) { const m = re.exec(n); if (m) add(`${kind}${m[1]}`, kind, Number(m[1]), path.join(folder, sub, n)); }
  }
  return out;
}

function listLocal(sessionId, mode, folder) {
  const fromDb = listLocalDb(sessionId, mode);
  if (!folder) return fromDb;
  const have = new Set(fromDb.map((f) => f.fid)); // unggah manual: arsip melengkapi file yang tidak ada di uploads (mis. sudah kedaluwarsa)
  return fromDb.concat(listFolder(folder).filter((f) => !have.has(f.fid)));
}
function listLocalDb(sessionId, mode) {
  const s = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
  if (!s) return [];
  const out = [];
  const add = (fid, kind, idx, rel) => {
    const abs = diskPath(rel); if (!abs) return;
    try { const st = fs.statSync(abs); if (st.isFile() && st.size > 0) out.push({ fid, kind, idx, ext: extOf(rel), abs, size: st.size }); } catch { /* belum ada / sudah terhapus */ }
  };
  add("final", mode === "boomerang" ? "boomerang" : "final", 0, s.final_image_path);
  add("gif", "gif", 0, s.gif_path);
  add("video", "video", 0, s.video_path);
  for (const r of db.prepare("SELECT kind, idx, path FROM session_files WHERE session_id = ? ORDER BY idx").all(sessionId)) {
    if (r.kind === "raw") add(`raw${r.idx}`, "raw", r.idx, r.path);
    else if (r.kind === "clip") add(`clip${r.idx}`, "clip", r.idx, r.path);
    else if (r.kind === "live") add("live", "live", 0, r.path);
    else if (r.kind === "gifplain") add("gifplain", "gifplain", 0, r.path);
  }
  return out;
}

// ---------- komunikasi ----------
async function api(method, p, body) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${baseUrl()}/api/v1${p}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg().token}` }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || `Galeri menjawab HTTP ${res.status}`); e.status = res.status; throw e; }
    return data;
  } finally { clearTimeout(t); }
}

async function putFile(url, f, contentType) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10 * 60 * 1000);
  try {
    const res = await fetch(url, { method: "PUT", body: fs.readFileSync(f.abs), headers: { "Content-Type": contentType || "application/octet-stream" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`Cloud menolak unggahan (HTTP ${res.status})`);
  } finally { clearTimeout(t); }
}

async function syncSession(row) {
  const done = new Set(db.prepare("SELECT fid FROM gallery_files WHERE session_id = ?").all(row.session_id).map((r) => r.fid));
  const all = listLocal(row.session_id, row.mode, row.folder);
  const todo = all.filter((f) => !done.has(f.fid));
  if (todo.length) {
    const body = { token: row.token, mode: row.mode, studioCode: cfg().studioCode || undefined, files: todo.map((f) => ({ fid: f.fid, kind: f.kind, idx: f.idx, ext: f.ext, size: f.size })) };
    if (failedFid.has(row.session_id) && row.attempts >= 2) body.retry = failedFid.get(row.session_id);
    const r = await api("POST", "/sessions", body);
    const byFid = new Map(todo.map((f) => [f.fid, f]));
    for (const u of r.uploads || []) {
      const f = byFid.get(u.fid); if (!f) continue;
      try {
        await putFile(u.url, f, u.contentType);
        await api("POST", `/sessions/${row.token}/done`, { fid: f.fid });
        db.prepare("INSERT OR IGNORE INTO gallery_files (session_id, fid) VALUES (?, ?)").run(row.session_id, f.fid);
      } catch (e) { failedFid.set(row.session_id, f.fid); throw e; }
    }
    for (const sk of r.skipped || []) db.prepare("INSERT OR IGNORE INTO gallery_files (session_id, fid) VALUES (?, ?)").run(row.session_id, String(sk.fid)); // ditolak galeri: jangan diulang terus
    failedFid.delete(row.session_id);
  }
  const old = Date.now() - row.created_at > ACTIVE_MS;
  const pending = listLocal(row.session_id, row.mode, row.folder).filter((f) => !db.prepare("SELECT 1 FROM gallery_files WHERE session_id = ? AND fid = ?").get(row.session_id, f.fid));
  if (old && pending.length === 0) db.prepare("UPDATE gallery_sync SET state = 'done', last_error = NULL WHERE session_id = ?").run(row.session_id);
  else db.prepare("UPDATE gallery_sync SET attempts = 0, last_error = NULL, next_try = ? WHERE session_id = ?").run(Date.now() + (old ? 0 : 15000), row.session_id);
}

async function run({ force = false } = {}) {
  if (!ready()) return { ok: false, error: "Galeri belum diaktifkan / alamat atau token belum diisi." };
  if (state.busy) return { ok: true, busy: true };
  state.busy = true;
  let sent = 0, errors = 0;
  try {
    const rows = db.prepare("SELECT * FROM gallery_sync WHERE state = 'active' AND created_at > ? AND (next_try <= ? OR ?) ORDER BY created_at LIMIT 20").all(Date.now() - GIVE_UP_MS, Date.now(), force ? 1 : 0);
    for (const row of rows) {
      try { await syncSession(row); sent++; state.lastOkAt = new Date().toISOString(); state.lastError = null; }
      catch (e) {
        errors++;
        const msg = e.name === "AbortError" ? "Galeri tidak menjawab (timeout)" : e.message;
        state.lastError = msg;
        const attempts = row.attempts + 1;
        db.prepare("UPDATE gallery_sync SET attempts = ?, last_error = ?, next_try = ? WHERE session_id = ?").run(attempts, String(msg).slice(0, 300), Date.now() + Math.min(5 * 60 * 1000, 5000 * 2 ** Math.min(attempts, 6)), row.session_id);
        if (e.status === 401 || e.status === 503) break; // token salah / galeri belum siap: semua sesi akan gagal sama
      }
    }
    return { ok: errors === 0, sent, errors, error: errors ? state.lastError : null };
  } finally { state.busy = false; }
}

let nudgeTimer = null;
function nudge() { if (!ready() || nudgeTimer) return; nudgeTimer = setTimeout(() => { nudgeTimer = null; run().catch(() => {}); }, 2500); }
function start() {
  if (state.timer) return;
  state.timer = setInterval(() => { run().catch(() => {}); }, 8000);
  state.timer.unref?.();
}

async function testConnection() {
  if (!baseUrl() || !cfg().token) return { ok: false, error: "Alamat galeri dan token studio (kartu Kasir Online) belum diisi." };
  try {
    const r = await api("GET", "/ping");
    if (!r.buckets) return { ok: true, studio: r.studio, retentionDays: r.retentionDays, warning: "Galeri terhubung tetapi belum ada bucket cloud aktif (atur di halaman admin galeri)." };
    return { ok: true, studio: r.studio, retentionDays: r.retentionDays, buckets: r.buckets };
  } catch (e) { return { ok: false, error: e.name === "AbortError" ? "Galeri tidak menjawab (timeout)" : e.message }; }
}

function status() {
  const c = cfg();
  const n = (sql) => db.prepare(sql).get().n;
  return {
    enabled: !!c.galleryEnabled, configured: !!(baseUrl() && c.token), url: baseUrl(),
    activeSessions: n("SELECT COUNT(*) n FROM gallery_sync WHERE state = 'active'"),
    sessionsWithErrors: n("SELECT COUNT(*) n FROM gallery_sync WHERE state = 'active' AND last_error IS NOT NULL"),
    filesUploaded: n("SELECT COUNT(*) n FROM gallery_files"),
    lastOkAt: state.lastOkAt, lastError: state.lastError,
  };
}

/** Tulis popsnap-share.json di folder arsip sesi: berisi token link galeri. Dipakai halaman "Unggah manual" di website galeri
 *  (dari PC CS lewat jaringan bersama) supaya file masuk ke link yang SAMA dengan QR yang sudah dilihat pelanggan. */
function writeShareFile(folder, token, mode) {
  if (!ready() || !token) return;
  try {
    fs.writeFileSync(path.join(folder, "popsnap-share.json"), JSON.stringify({ token, mode: mode || "photo", studioCode: cfg().studioCode || "", url: shareUrlFor(token), createdAt: new Date().toISOString() }, null, 2));
  } catch { /* arsip tidak bisa ditulis: abaikan */ }
}

// ---------- unggah manual dari Admin (cadangan bila internet booth bermasalah) ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function infoFor(sessionId, folder) {
  const files = listFolder(folder);
  const row = db.prepare("SELECT * FROM gallery_sync WHERE session_id = ?").get(sessionId);
  const sessTok = db.prepare("SELECT share_token FROM sessions WHERE id = ?").get(sessionId)?.share_token || null;
  const token = row?.token || sessTok;
  const done = new Set(db.prepare("SELECT fid FROM gallery_files WHERE session_id = ?").all(sessionId).map((r) => r.fid));
  const uploaded = files.filter((f) => done.has(f.fid)).length;
  return { files: files.length, uploaded, token, url: token && baseUrl() ? `${baseUrl()}/s/${token}` : null, state: !files.length ? "empty" : uploaded >= files.length ? "done" : row?.state === "active" ? "queued" : uploaded ? "partial" : "none", error: row?.last_error || null };
}
/** Daftar sesi di arsip (hari terbaru dulu). */
function listArchive(outDir, days = 14) {
  const out = [];
  let dates = []; try { dates = fs.readdirSync(outDir).filter((d) => DATE_RE.test(d)).sort().reverse().slice(0, Math.max(1, Math.min(120, days))); } catch { return out; }
  for (const date of dates) {
    let ids = []; try { ids = fs.readdirSync(path.join(outDir, date)); } catch { continue; }
    for (const id of ids) {
      if (!ID_RE.test(id)) continue;
      const folder = path.join(outDir, date, id);
      try { if (!fs.statSync(folder).isDirectory()) continue; } catch { continue; }
      const i = infoFor(id, folder);
      if (i.state === "empty") continue;
      let mtime = 0; try { mtime = fs.statSync(folder).mtimeMs; } catch { /* */ }
      out.push({ date, id, mtime, ...i });
      if (out.length >= 400) return out;
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}
function uploadArchive(outDir, date, id, redo = false) {
  if (!ready()) return { ok: false, error: "Galeri belum diaktifkan / alamat atau token belum diisi." };
  if (!DATE_RE.test(String(date)) || !ID_RE.test(String(id))) return { ok: false, error: "Sesi tidak valid." };
  const folder = path.join(outDir, date, id);
  if (!path.resolve(folder).startsWith(path.resolve(outDir) + path.sep)) return { ok: false, error: "Sesi tidak valid." };
  if (!listFolder(folder).length) return { ok: false, error: "Tidak ada file di folder sesi ini." };
  if (redo) db.prepare("DELETE FROM gallery_files WHERE session_id = ?").run(id); // unggah ulang semua (mis. galeri/bucket diganti); galeri melewati file yang sudah ada
  const row = db.prepare("SELECT * FROM gallery_sync WHERE session_id = ?").get(id);
  const token = row?.token || db.prepare("SELECT share_token FROM sessions WHERE id = ?").get(id)?.share_token || nanoid(16);
  const mode = row?.mode || db.prepare("SELECT mode FROM sessions WHERE id = ?").get(id)?.mode || "photo";
  if (row) db.prepare("UPDATE gallery_sync SET folder = ?, state = 'active', attempts = 0, next_try = 0, last_error = NULL WHERE session_id = ?").run(folder, id);
  else db.prepare("INSERT INTO gallery_sync (session_id, token, mode, folder, created_at) VALUES (?, ?, ?, ?, ?)").run(id, token, mode, folder, Date.now() - ACTIVE_MS - 1000);
  nudge();
  return { ok: true, token, url: `${baseUrl()}/s/${token}` };
}

module.exports = { writeShareFile, listArchive, uploadArchive, enabled, ready, shareUrlFor, enqueue, run, start, testConnection, status, nudge };
