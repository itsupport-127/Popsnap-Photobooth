// ==========================================================
// Sinkron riwayat transaksi ke aplikasi KASIR (Popsnap-Kasir).
//
// - Nomor transaksi dibuat DI SINI (PB-<KODE STUDIO>-<YYMMDD>-<URUT>) lalu dipakai apa adanya di kasir,
//   jadi nomornya sama di kedua aplikasi. Untuk QRIS, nomor ini juga menjadi order_id Midtrans & id sesi.
// - Offline-first: transaksi selalu ditulis ke tabel tx_log lebih dulu; pengiriman ke kasir berjalan di latar,
//   diulang sampai berhasil. Booth tidak pernah tertahan karena kasir/internet bermasalah.
// - Idempoten: kasir memperbarui baris dengan order_no yang sama, jadi aman dikirim ulang.
// - Yang dikirim hanya transaksi berstatus "paid" (QRIS lunas / voucher dipakai / sesi gratis).
// ==========================================================
const db = require("./db");
const settingsStore = require("./settings");

const INTERVAL_MS = 20 * 1000;
const BATCH = 50;
const state = { running: false, lastTryAt: null, lastOkAt: null, lastError: null, failStreak: 0, nextAt: 0 };

const pad = (n, w = 2) => String(n).padStart(w, "0");
const nowIso = () => new Date().toISOString();

function cfg() {
  return settingsStore.load().payment.cloud;
}

function datePart(d = new Date()) {
  return `${pad(d.getFullYear() % 100)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** Kode studio: yang diisi admin, atau dibuat acak SEKALI lalu disimpan (supaya nomor antar-studio tidak bentrok di kasir). */
function studioCode() {
  const c = cfg();
  if (c.studioCode) return c.studioCode;
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  settingsStore.update({ payment: { cloud: { studioCode: code } } });
  return code;
}

/** Nomor berikutnya: PB-<KODE>-<YYMMDD>-<0001>. Urutan per hari; bentrok -> naik satu lagi. */
function newOrderNo() {
  const prefix = `PB-${studioCode()}-${datePart()}-`;
  const row = db.prepare("SELECT order_no FROM tx_log WHERE order_no LIKE ? ORDER BY order_no DESC LIMIT 1").get(`${prefix}%`);
  let n = row ? parseInt(row.order_no.slice(prefix.length), 10) || 0 : 0;
  for (;;) {
    n += 1;
    const no = `${prefix}${pad(n, 4)}`;
    if (!db.prepare("SELECT 1 FROM tx_log WHERE order_no = ?").get(no)) return no;
  }
}

function templateInfo(templateId) {
  if (!templateId) return { name: null, category: null };
  const t = db.prepare("SELECT name, category FROM templates WHERE id = ?").get(templateId);
  return { name: t?.name ?? null, category: t?.category ?? null };
}

const MODE_NAME = { gif: "GIF", boomerang: "Boomerang", video: "Video" };

/**
 * Catat transaksi baru.
 * @param {{orderNo?:string, method:'qris'|'voucher'|'free', mode?:string, templateId?:string, amount?:number, status?:string,
 *          voucherCode?:string, voucherRef?:string, sessionId?:string}} t
 */
function create(t) {
  const orderNo = t.orderNo || newOrderNo();
  const tpl = templateInfo(t.templateId);
  const mode = t.mode || "photo";
  const status = t.status || "pending";
  const at = nowIso();
  db.prepare(`INSERT INTO tx_log (order_no, method, mode, template_id, template_name, category, voucher_code, voucher_ref, amount, status, session_id, created_at, paid_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    orderNo, t.method, mode, t.templateId ?? null,
    tpl.name ?? (MODE_NAME[mode] ? `Mode ${MODE_NAME[mode]}` : null), tpl.category,
    t.voucherCode ?? null, t.voucherRef ?? null, Math.max(0, Math.round(t.amount || 0)), status, t.sessionId ?? null, at, status === "paid" ? at : null, at,
  );
  nudge();
  return orderNo;
}

/** Ubah status pembayaran QRIS (pending | paid | expired). Status "paid" tidak pernah mundur. */
function setStatus(orderNo, status) {
  if (!orderNo) return;
  const row = db.prepare("SELECT status FROM tx_log WHERE order_no = ?").get(orderNo);
  if (!row || row.status === status || (row.status === "paid" && status !== "paid")) return;
  const at = nowIso();
  db.prepare("UPDATE tx_log SET status = ?, paid_at = CASE WHEN ? = 'paid' THEN ? ELSE paid_at END, updated_at = ? WHERE order_no = ?").run(status, status, at, at, orderNo);
  if (status === "paid") nudge();
}

/**
 * Sesi (foto/GIF/video) selesai dibuat: hubungkan ke transaksinya. Id sesi QRIS = nomor transaksi; voucher memakai nomor
 * dari validate (atau fallback "VCH-<kode>"); sesi gratis belum punya nomor -> dibuatkan di sini.
 */
function attachSession({ sessionId, ref, templateId, mode, paymentMethod }) {
  if (!sessionId) return null;
  try {
    // ref = nomor transaksi yang dibawa browser (QRIS / voucher); sessionId = id sesi di server
    let row = db.prepare("SELECT * FROM tx_log WHERE order_no = ? OR order_no = ? OR session_id = ? ORDER BY (order_no = ?) DESC LIMIT 1").get(ref || sessionId, sessionId, sessionId, ref || sessionId);
    const legacy = ref || sessionId;
    if (!row && /^VCH-/i.test(legacy)) {
      const code = legacy.slice(4).toUpperCase();
      row = db.prepare("SELECT * FROM tx_log WHERE method = 'voucher' AND voucher_code = ? AND session_id IS NULL ORDER BY created_at DESC LIMIT 1").get(code);
    }
    if (!row) {
      const orderNo = create({ method: paymentMethod === "voucher" ? "voucher" : "free", mode, templateId, amount: 0, status: "paid", sessionId });
      return orderNo;
    }
    if (row.session_id === sessionId && (!templateId || templateId === row.template_id)) return row.order_no; // tidak ada yang berubah
    const tpl = templateInfo(templateId || row.template_id);
    db.prepare(`UPDATE tx_log SET session_id = ?, template_id = COALESCE(?, template_id), template_name = COALESCE(?, template_name),
        category = COALESCE(?, category), mode = COALESCE(?, mode), updated_at = ? WHERE order_no = ?`)
      .run(sessionId, templateId ?? null, tpl.name, tpl.category, mode ?? null, nowIso(), row.order_no);
    nudge();
    return row.order_no;
  } catch (err) {
    console.warn("[kasir-sync] Gagal menghubungkan sesi ke transaksi:", err.message);
    return null;
  }
}

// ---------- Pengiriman ke kasir ----------
function baseUrl() {
  return String(cfg().url || "").trim().replace(/\/+$/, "").replace(/\/api\/photobox$/i, "");
}
function ready() {
  const c = cfg();
  return !!(c.enabled && baseUrl() && c.token);
}

/** Link galeri (halaman QR) sesi ini, kalau galeri cloud aktif. Kasir menampilkannya sebagai tombol salin / WhatsApp. */
function galleryUrlFor(sessionId) {
  if (!sessionId) return null;
  try {
    const gallery = require("./gallerySync");
    const row = db.prepare("SELECT share_token FROM sessions WHERE id = ?").get(sessionId);
    return row?.share_token ? gallery.shareUrlFor(row.share_token) : null;
  } catch { return null; }
}

function toPayload(r) {
  return {
    order_no: r.order_no, template_id: r.template_id, template_name: r.template_name, category: r.category,
    mode: r.mode, method: r.method, voucher_code: r.voucher_code, amount: r.amount, status: r.status,
    paid_at: r.paid_at, created_at: r.created_at, session_id: r.session_id,
    meta: r.voucher_ref ? { kasir_reference: r.voucher_ref } : null,
    gallery_url: galleryUrlFor(r.session_id),
  };
}

async function post(path, body, method = "POST") {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${baseUrl()}/api/photobox${path}`, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${cfg().token}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || `Kasir menjawab HTTP ${res.status}`);
    return data;
  } finally { clearTimeout(timer); }
}

function pendingRows(limit = BATCH) {
  return db.prepare(`SELECT * FROM tx_log WHERE status = 'paid' AND kasir_deleted_at IS NULL AND (synced_at IS NULL OR updated_at > synced_at) ORDER BY created_at LIMIT ?`).all(limit);
}

/** Kirim semua yang belum terkirim. force = abaikan jeda ulang setelah gagal (tombol "Kirim sekarang"). */
async function pushPending({ force = false } = {}) {
  if (state.running || !ready()) return { ok: false, skipped: true };
  if (!force && Date.now() < state.nextAt) return { ok: false, skipped: true };
  state.running = true;
  state.lastTryAt = nowIso();
  let sent = 0;
  try {
    for (;;) {
      const rows = pendingRows();
      if (!rows.length) break;
      const sentAt = nowIso();
      const data = await post("/transactions", { transactions: rows.map(toPayload) });
      const byNo = new Map((data.results || []).map((x) => [x.order_no, x]));
      for (const r of rows) {
        const res = byNo.get(r.order_no);
        if (res?.ok) { db.prepare("UPDATE tx_log SET synced_at = ?, sync_error = NULL WHERE order_no = ?").run(sentAt, r.order_no); sent++; }
        else db.prepare("UPDATE tx_log SET sync_tries = sync_tries + 1, sync_error = ?, synced_at = ? WHERE order_no = ?")
          // ditolak kasir (data tidak valid): tandai selesai-dengan-error supaya tidak diulang terus; update berikutnya mengirim lagi
          .run(res?.error || "Tidak ada jawaban untuk baris ini", sentAt, r.order_no);
      }
      if (rows.length < BATCH) break;
    }
    state.lastOkAt = nowIso(); state.lastError = null; state.failStreak = 0; state.nextAt = 0;
    return { ok: true, sent };
  } catch (err) {
    state.failStreak += 1;
    state.lastError = err.name === "AbortError" ? "Kasir tidak menjawab (timeout)" : err.message;
    state.nextAt = Date.now() + Math.min(5 * 60 * 1000, 20000 * 2 ** Math.min(state.failStreak, 4)); // 40 dtk, 80, 160, 300
    return { ok: false, error: state.lastError, sent };
  } finally { state.running = false; }
}

let nudgeTimer = null;
// ---------- Perubahan dari kasir (edit / hapus) ----------
// Kasir = sumber angka resmi. Booth menarik perubahan lalu menyesuaikan tx_log; kalau transaksi dihapus,
// sesi galeri cloud-nya ikut dihapus. Baris tx_log tetap disimpan (ditandai) supaya nomor transaksi tidak dipakai ulang.
const CURSOR_KEY = "kasir_changes_cursor";
let onChanged = null; // dipanggil setelah ada perubahan dari kasir (mis. segera lapor ke cloud-dashboard)
const setOnChanged = (fn) => { onChanged = fn; };
const pullState = { running: false, nextAt: 0, lastOkAt: null, lastError: null, applied: 0 };
const getCursor = () => db.prepare("SELECT value FROM app_settings WHERE key = ?").get(CURSOR_KEY)?.value || "";
const setCursor = (v) => db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(CURSOR_KEY, String(v));

/** Terapkan 1 perubahan dari kasir. Idempoten: aman dipanggil berulang untuk perubahan yang sama. */
function applyChange(c) {
  const row = db.prepare("SELECT * FROM tx_log WHERE order_no = ?").get(c?.order_no);
  if (!row) return false; // bukan transaksi booth ini
  const at = c.changed_at || nowIso();
  if (c.deleted) {
    if (row.kasir_deleted_at) return false;
    db.prepare("UPDATE tx_log SET kasir_deleted_at = ?, gallery_purged = 0 WHERE order_no = ?").run(at, row.order_no);
    return true;
  }
  if (row.kasir_deleted_at) return false; // hapus tidak bisa dibatalkan oleh edit lama
  if (row.kasir_edited_at && new Date(row.kasir_edited_at) >= new Date(at)) return false; // sudah diterapkan
  const paidIso = c.paid_at && !Number.isNaN(new Date(c.paid_at).getTime()) ? new Date(c.paid_at).toISOString() : null; // format sama dengan booth (UTC)
  // updated_at sengaja tidak diubah: ini bukan perubahan baru dari booth, jadi tidak perlu dikirim ulang ke kasir
  db.prepare("UPDATE tx_log SET template_name = ?, method = ?, amount = ?, status = ?, paid_at = ?, kasir_edited_at = ? WHERE order_no = ?")
    .run(c.template_name ?? null, c.method ?? row.method, Number(c.amount) || 0, c.status ?? row.status, paidIso ?? row.paid_at, at, row.order_no);
  return true;
}

/** Bersihkan galeri cloud untuk transaksi yang dihapus di kasir. Diulang sampai berhasil. */
async function purgeGalleries() {
  const rows = db.prepare("SELECT order_no, session_id FROM tx_log WHERE kasir_deleted_at IS NOT NULL AND gallery_purged = 0 LIMIT 20").all();
  if (!rows.length) return 0;
  let gallery = null; try { gallery = require("./gallerySync"); } catch { /* galeri tidak tersedia */ }
  let n = 0;
  for (const r of rows) {
    const token = r.session_id ? db.prepare("SELECT share_token FROM sessions WHERE id = ?").get(r.session_id)?.share_token : null;
    if (!token) { db.prepare("UPDATE tx_log SET gallery_purged = 1 WHERE order_no = ?").run(r.order_no); continue; } // tidak ada galeri
    if (!gallery || !gallery.ready()) continue; // galeri belum aktif: coba lagi nanti
    const res = await gallery.deleteRemote(token);
    if (res.ok) { db.prepare("UPDATE tx_log SET gallery_purged = 1 WHERE order_no = ?").run(r.order_no); n++; }
  }
  return n;
}

async function pullChanges({ force = false } = {}) {
  if (pullState.running || !ready()) return { ok: false, skipped: true };
  if (!force && Date.now() < pullState.nextAt) return { ok: false, skipped: true };
  pullState.running = true;
  let applied = 0;
  try {
    for (let page = 0; page < 10; page++) {
      const cursor = getCursor();
      const data = await post(`/changes${cursor ? `?since=${encodeURIComponent(cursor)}` : ""}`, null, "GET");
      const list = data.changes || [];
      for (const c of list) if (applyChange(c)) applied++;
      if (data.cursor && data.cursor !== cursor) setCursor(data.cursor);
      if (list.length < 200 || !data.cursor || data.cursor === cursor) break;
    }
    await purgeGalleries();
    if (applied > 0 && onChanged) { try { onChanged(); } catch { /* abaikan */ } }
    pullState.lastOkAt = nowIso(); pullState.lastError = null; pullState.nextAt = 0; pullState.applied += applied;
    return { ok: true, applied };
  } catch (err) {
    pullState.lastError = err.name === "AbortError" ? "Kasir tidak menjawab (timeout)" : err.message;
    pullState.nextAt = Date.now() + 60 * 1000;
    return { ok: false, error: pullState.lastError, applied };
  } finally { pullState.running = false; }
}

/**
 * Pendapatan hari ini (tanggal lokal "YYYY-MM-DD") untuk cloud-dashboard.
 * Dihitung dari tx_log supaya SAMA dengan kasir: transaksi lunas, tanpa yang dihapus di kasir, dan memakai nominal hasil edit kasir.
 */
function todayRevenue(localDate) {
  const start = new Date(`${localDate}T00:00:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM tx_log WHERE status = 'paid' AND kasir_deleted_at IS NULL AND paid_at >= ? AND paid_at < ?")
    .get(start.toISOString(), end.toISOString()).total;
}

/** Sekali saja: kirim ulang transaksi lama yang sudah punya sesi galeri, supaya link galerinya sampai ke kasir. */
function backfillGalleryLinks() {
  const KEY = "kasir_gallery_backfill_v1";
  if (db.prepare("SELECT 1 FROM app_settings WHERE key = ?").get(KEY)) return;
  db.prepare(`UPDATE tx_log SET synced_at = NULL WHERE status = 'paid' AND kasir_deleted_at IS NULL
    AND session_id IN (SELECT id FROM sessions WHERE share_token IS NOT NULL)`).run();
  db.prepare("INSERT INTO app_settings (key, value) VALUES (?, '1')").run(KEY);
}

function nudge() { // kirim segera (setelah jeda singkat supaya perubahan beruntun dikirim sekaligus)
  if (!ready() || nudgeTimer) return;
  nudgeTimer = setTimeout(() => { nudgeTimer = null; pushPending().catch(() => {}); }, 1500);
}

async function testConnection() {
  if (!baseUrl() || !cfg().token) return { ok: false, error: "Alamat kasir dan token belum diisi." };
  try {
    const r = await post("/ping", null, "GET");
    return { ok: !!r.ok, studio: r.studio };
  } catch (err) {
    return { ok: false, error: err.name === "AbortError" ? "Kasir tidak menjawab (timeout)" : err.message };
  }
}

function status() {
  const c = cfg();
  const count = (sql) => db.prepare(sql).get().n;
  return {
    enabled: !!c.enabled, configured: !!(baseUrl() && c.token), studioCode: c.studioCode || null,
    pending: count("SELECT COUNT(*) n FROM tx_log WHERE status = 'paid' AND kasir_deleted_at IS NULL AND (synced_at IS NULL OR updated_at > synced_at)"),
    errors: count("SELECT COUNT(*) n FROM tx_log WHERE sync_error IS NOT NULL AND updated_at <= synced_at"),
    changesAppliedCount: pullState.applied, changesLastOkAt: pullState.lastOkAt, changesError: pullState.lastError,
    lastTryAt: state.lastTryAt, lastOkAt: state.lastOkAt || db.prepare("SELECT MAX(synced_at) v FROM tx_log").get().v || null, lastError: state.lastError,
  };
}

function recent(limit = 30) {
  return db.prepare("SELECT * FROM tx_log ORDER BY created_at DESC, order_no DESC LIMIT ?").all(Math.min(200, limit))
    .map((r) => ({ ...r, synced: !!r.synced_at && r.synced_at >= r.updated_at && !r.sync_error }));
}

let timer = null;
function start() {
  if (timer) return;
  try { backfillGalleryLinks(); } catch (e) { console.warn("[kasir-sync] backfill link galeri gagal:", e.message); }
  const tick = async () => { await pushPending().catch(() => {}); await pullChanges().catch(() => {}); };
  timer = setInterval(tick, INTERVAL_MS);
  setTimeout(tick, 5000);
}

module.exports = { create, setStatus, attachSession, newOrderNo, pushPending, pullChanges, applyChange, purgeGalleries, todayRevenue, setOnChanged, backfillGalleryLinks, testConnection, status, recent, start, ready };
