// ==========================================================
// Log aktivitas — mencatat siapa melakukan apa, kapan, dan dari mana.
//
// Aturan:
//  - TIDAK PERNAH mencatat password, token, atau isi key rahasia (hanya "diubah").
//  - Gagal mencatat tidak boleh menggagalkan permintaan aslinya (try/catch).
//  - Append-only: tidak ada fungsi ubah/hapus selain pembersihan otomatis sesuai masa simpan.
// ==========================================================
const db = require("./db");

const RETENTION_DAYS = 180;

function clientIp(req) {
  const ip = req?.ip || req?.socket?.remoteAddress || "";
  return String(ip).replace(/^::ffff:/, "").slice(0, 64);
}

/**
 * @param {object|string} actor  req.user ({id, username}) atau nama string untuk aktor sistem (mis. "booth", "pos-api")
 * @param {string} action        kode aksi, format "kategori.aksi" (mis. "voucher.create")
 * @param {string} [target]      objek yang dikenai aksi (nama template, kode voucher, username...)
 * @param {object} [detail]      info tambahan (tanpa data rahasia)
 * @param {object} [req]         untuk mencatat alamat IP
 */
function logActivity(actor, action, target, detail, req) {
  try {
    const a = typeof actor === "string" ? { id: null, username: actor } : actor || {};
    db.prepare("INSERT INTO activity_log (at, user_id, username, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      new Date().toISOString(),
      a.id ?? null,
      a.username ?? null,
      action,
      target == null ? null : String(target).slice(0, 200),
      detail && Object.keys(detail).length ? JSON.stringify(detail).slice(0, 2000) : null,
      clientIp(req)
    );
  } catch (err) {
    console.error("[activity] gagal mencatat:", err.message);
  }
}

function prune() {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400 * 1000).toISOString();
    const r = db.prepare("DELETE FROM activity_log WHERE at < ?").run(cutoff);
    if (r.changes) console.log(`[activity] ${r.changes} log lama (> ${RETENTION_DAYS} hari) dibersihkan`);
  } catch (err) {
    console.error("[activity] gagal membersihkan:", err.message);
  }
}
prune();
setInterval(prune, 24 * 3600 * 1000).unref();

const SECRET_PATHS = new Set(["payment.qris.midtrans.serverKey", "payment.qris.doku.secretKey", "payment.qris.doku.privateKey", "payment.qris.doku.keyPassphrase", "payment.pos.apiKey", "payment.cloud.token", "general.security.pinHash", "general.security.pinSalt"]);

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, path, out);
    else out[path] = v;
  }
  return out;
}

/** Daftar perubahan antara dua objek pengaturan. Nilai rahasia TIDAK ditulis, hanya "diubah". */
function diffSettings(before, after) {
  const a = flatten(before), b = flatten(after);
  const changes = [];
  for (const path of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[path]) === JSON.stringify(b[path])) continue;
    changes.push(SECRET_PATHS.has(path) ? { path, secret: true } : { path, from: a[path], to: b[path] });
  }
  return changes;
}

module.exports = { logActivity, diffSettings };
