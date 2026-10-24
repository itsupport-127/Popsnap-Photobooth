// ==========================================================
// Auth — login lokal per toko (admin & kasir).
//
// Password di-hash pakai `crypto.scrypt` BAWAAN Node.js (bukan bcrypt),
// supaya gak perlu native module tambahan yang bisa bikin masalah instalasi
// di Windows (sama kayak alasan kita pindah dari better-sqlite3 ke node:sqlite).
//
// Token pakai JWT (jsonwebtoken) — stateless, gampang divalidasi, cukup
// buat kebutuhan 1 PC/toko. JWT_SECRET di-generate otomatis & disimpan di
// file lokal supaya semua token tetap valid walau backend di-restart,
// tapi otomatis logout semua orang kalau file itu dihapus (misal pas migrasi
// PC baru — fitur keamanan, bukan bug).
// ==========================================================

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const db = require("./db");

const SECRET_PATH = path.join(require("./config").dataDir, "db", ".jwt-secret");

function getOrCreateSecret() {
  if (fs.existsSync(SECRET_PATH)) {
    return fs.readFileSync(SECRET_PATH, "utf-8").trim();
  }
  const secret = crypto.randomBytes(48).toString("hex");
  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  fs.writeFileSync(SECRET_PATH, secret);
  return secret;
}

const JWT_SECRET = getOrCreateSecret();
const TOKEN_EXPIRY = "12h"; // shift kerja biasanya gak lebih dari ini; login ulang tiap shift baru = wajar

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const candidateHash = crypto.scryptSync(password, salt, 64).toString("hex");
  // timingSafeEqual supaya gak bocor info lewat timing attack
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidateHash, "hex"));
}

// ==========================================================
// HAK AKSES
//   Peran (role):  superadmin | admin | cashier
//   Setiap peran punya DAFTAR HAK DEFAULT (bisa diatur Super Admin di Pengguna > Hak Akses Peran).
//   Tiap akun boleh punya hak KHUSUS yang menimpa default peran (kolom users.permissions).
//   Super Admin selalu punya semua hak. "users.manage" hanya dimiliki Super Admin.
// ==========================================================

const PERMISSIONS = [
  { id: "template.manage", group: "Konten", label: "Edit template", desc: "Buka Template Editor; buat, ubah, dan hapus template." },
  { id: "settings.manage", group: "Konten", label: "Pengaturan umum", desc: "Nama event, nama toko, sumber kamera, jumlah foto, retake, dan timer." },
  { id: "voucher.manage", group: "Kasir", label: "Kelola voucher", desc: "Membuat, melihat, dan membatalkan voucher." },
  { id: "payment.mode", group: "Kasir", label: "Ganti mode pembayaran", desc: "Pindah antara voucher / QRIS / otomatis (misal saat internet putus)." },
  { id: "report.view", group: "Kasir", label: "Lihat statistik hari ini", desc: "Jumlah sesi, voucher, dan pemasukan QRIS di halaman depan admin." },
  { id: "payment.gateway", group: "Sistem", label: "Payment gateway & integrasi kasir", desc: "Key Midtrans, mode simulasi, masa berlaku voucher, API key aplikasi kasir." },
  { id: "activity.view", group: "Sistem", label: "Lihat log aktivitas", desc: "Riwayat siapa mengubah apa dan kapan (termasuk login dan perubahan hak akses)." },
  { id: "tools.maintenance", group: "Sistem", label: "Tools & pemeliharaan", desc: "Info sistem dan pembersihan file." },
  { id: "users.manage", group: "Sistem", label: "Kelola pengguna & hak akses", desc: "Khusus Super Admin.", locked: true },
];
const ALL_PERMS = PERMISSIONS.map((p) => p.id);
const GRANTABLE = ALL_PERMS.filter((p) => p !== "users.manage");

const DEFAULT_ROLES = {
  admin: [...GRANTABLE],
  cashier: ["voucher.manage", "payment.mode", "report.view"],
};
const ROLES = ["superadmin", "admin", "cashier"];

function cleanPerms(list) {
  if (!Array.isArray(list)) return [];
  return GRANTABLE.filter((p) => list.includes(p)); // buang id tak dikenal & users.manage
}

function getRoleDefaults() {
  let stored = {};
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'roles'").get();
    stored = row ? JSON.parse(row.value) : {};
  } catch { stored = {}; }
  return {
    admin: Array.isArray(stored.admin) ? cleanPerms(stored.admin) : DEFAULT_ROLES.admin,
    cashier: Array.isArray(stored.cashier) ? cleanPerms(stored.cashier) : DEFAULT_ROLES.cashier,
  };
}

function setRoleDefaults({ admin, cashier }) {
  const cur = getRoleDefaults();
  const next = {
    admin: Array.isArray(admin) ? cleanPerms(admin) : cur.admin,
    cashier: Array.isArray(cashier) ? cleanPerms(cashier) : cur.cashier,
  };
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('roles', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next));
  return next;
}

function parseCustom(row) {
  if (row.permissions == null) return null;
  try { return cleanPerms(JSON.parse(row.permissions)); } catch { return null; }
}

/** Hak akses EFEKTIF akun ini (hasil akhir yang dipakai server & frontend). */
function effectivePermissions(row) {
  if (row.role === "superadmin") return [...ALL_PERMS];
  const custom = parseCustom(row);
  if (custom) return custom;
  return getRoleDefaults()[row.role] ?? [];
}

function publicUser(row) {
  return { id: row.id, username: row.username, role: row.role, permissions: effectivePermissions(row) };
}

function createToken(user) {
  return jwt.sign({ id: user.id, tv: user.token_version ?? 0 }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/**
 * Middleware: wajib login. Akun SELALU dibaca ulang dari database di tiap permintaan, jadi
 * perubahan hak akses, penonaktifan, atau penghapusan akun langsung berlaku tanpa menunggu token habis.
 *
 *   requirePerm()                         -> cukup login
 *   requirePerm("voucher.manage")         -> harus punya hak itu
 *   requirePerm("a", "b")                 -> cukup punya SALAH SATU
 */
function requirePerm(...needed) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Belum login." });

    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: "Sesi login habis, silakan login ulang." });

    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.id);
    if (!row || !row.active || (row.token_version ?? 0) !== (payload.tv ?? 0)) {
      return res.status(401).json({ error: "Sesi tidak berlaku lagi. Silakan login ulang." });
    }

    const permissions = effectivePermissions(row);
    if (needed.length && !needed.some((p) => permissions.includes(p))) {
      return res.status(403).json({ error: "Akun kamu tidak punya hak akses untuk fitur ini." });
    }
    req.user = { id: row.id, username: row.username, role: row.role, permissions };
    next();
  };
}

module.exports = {
  hashPassword, verifyPassword, createToken, verifyToken, requirePerm,
  PERMISSIONS, ALL_PERMS, GRANTABLE, ROLES, cleanPerms, getRoleDefaults, setRoleDefaults,
  effectivePermissions, publicUser, parseCustom,
};
