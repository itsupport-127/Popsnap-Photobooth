// ==========================================================
// POPSNAP Backend — Fase 2
//
// Jalan LOKAL di PC booth. Menangani:
//  - Template CRUD (upload PNG, simpan posisi slot)
//  - Voucher validation (kerja walau offline)
//  - Sesi selesai -> simpan hasil final image, generate link download
//
// Payment QRIS asli (Midtrans) & cloud sync menyusul di Fase 3-4.
// Bentuk endpoint SUDAH disiapkan supaya frontend service
// (paymentService.js, sessionService.js) tinggal ganti
// VITE_SIMULATE_PAYMENT=false tanpa ubah UI.
// ==========================================================
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { nanoid } = require("nanoid");
const sizeOf = require("image-size");

const db = require("./db");
const config = require("./config");
const auth = require("./auth");
const { logActivity, diffSettings } = require("./activity");
const { hashPassword, verifyPassword, createToken, requirePerm } = auth;

const settingsStore = require("./settings");
const cloud = require("./cloudSync"); // sinkron riwayat transaksi ke aplikasi kasir
const doku = require("./doku"); // QRIS DOKU (SNAP)
const gallery = require("./gallerySync"); // unggah hasil sesi ke POPSNAP Galeri (halaman QR + cloud)
const { customAlphabet } = require("nanoid");
// Mode akhir sesi (Admin > Tampilan > Sharing): "preview" = hasil hanya ditampilkan di booth, tanpa QR / link / unggah ke galeri cloud.
const sharingOn = () => (settingsStore.load().display?.sharing?.mode ?? "qr") !== "preview";
const crypto = require("crypto");

// Midtrans dibangun DINAMIS dari pengaturan admin (fallback ke .env), supaya key bisa
// diganti dari halaman /admin/payment tanpa restart.
let midtransCache = { sig: null, client: null };
function getMidtrans() {
  const m = settingsStore.load().payment.qris.midtrans;
  const serverKey = m.serverKey || config.midtrans.serverKey;
  if (!serverKey) return null;
  const clientKey = m.clientKey || config.midtrans.clientKey;
  const isProduction = m.serverKey ? m.isProduction : config.midtrans.isProduction;
  const sig = `${serverKey}|${clientKey}|${isProduction}`;
  if (midtransCache.sig !== sig) {
    const midtransClient = require("midtrans-client");
    midtransCache = { sig, client: new midtransClient.CoreApi({ isProduction, serverKey, clientKey }) };
    console.log("[midtrans] Aktif -", isProduction ? "PRODUCTION" : "SANDBOX");
  }
  return midtransCache.client;
}

// ---- Cek koneksi internet (di-cache 10 detik) ----
// Dulu hanya menguji SATU alamat (api.midtrans.com) dengan batas 2,5 detik -> sering salah "offline" (DNS lambat, IPv6, antivirus,
// atau satu situs sedang bermasalah). Sekarang beberapa alamat diuji BERSAMAAN; satu saja menjawab = online. Satu kali gagal
// tidak langsung dianggap offline (harus gagal 2 kali beruntun) supaya tidak berkedip.
const ONLINE_TARGETS = ["https://www.gstatic.com/generate_204", "https://cloudflare.com/cdn-cgi/trace", "https://api.midtrans.com", "https://api.doku.com", "https://www.google.com/generate_204", ...(process.env.DOKU_BASE_URL ? [process.env.DOKU_BASE_URL] : [])];
let onlineCache = { at: 0, value: false, fails: 0, reason: "" };
async function checkOnline() {
  if (Date.now() - onlineCache.at < 10000) return onlineCache.value;
  let ok = false, reason = "";
  try {
    await Promise.any(ONLINE_TARGETS.map((u) => fetch(u, { method: "GET", signal: AbortSignal.timeout(5000), redirect: "manual", cache: "no-store" })));
    ok = true; // respons HTTP apa pun = internet nyambung
  } catch (err) {
    const e = err?.errors?.[0];
    reason = e?.cause?.code || e?.cause?.message || e?.message || String(err);
  }
  const fails = ok ? 0 : onlineCache.fails + 1;
  const value = ok || (onlineCache.value && fails < 2);
  onlineCache = { at: Date.now(), value, fails, reason };
  if (!ok) console.log(`[online] semua alamat uji gagal (${fails}x): ${reason}`);
  return value;
}

// ---- Metode bayar yang BENAR-BENAR tampil di booth sekarang ----
// Aturan emas: konsumen tidak boleh sampai buntu. Kalau QRIS tidak bisa jalan
// (internet mati / belum dikonfigurasi), otomatis jatuh ke voucher (bayar di kasir).
async function paymentState() {
  const s = settingsStore.load();
  const online = await checkOnline();
  const simulate = s.payment.qris.simulate;
  const useDoku = s.payment.qris.provider === "doku";
  const configured = useDoku ? doku.configured() : !!getMidtrans();
  const qrisUsable = simulate || (configured && online);
  const mode = s.payment.mode;

  let methods;
  let notice = null;
  if (mode === "voucher") methods = ["voucher"];
  else if (mode === "qris") methods = qrisUsable ? ["qris"] : ["voucher"];
  else if (mode === "both") methods = qrisUsable ? ["voucher", "qris"] : ["voucher"];
  else methods = qrisUsable ? ["voucher", "qris"] : ["voucher"]; // auto

  if (mode !== "voucher" && !qrisUsable) {
    notice = !configured && !simulate
      ? `QRIS belum dikonfigurasi (${useDoku ? "data DOKU belum lengkap" : "Midtrans server key kosong"}), jadi booth memakai voucher.`
      : "Internet sedang mati, jadi booth otomatis memakai voucher (bayar di kasir).";
  }
  return { mode, methods, online, onlineReason: online ? "" : onlineCache.reason, qrisConfigured: configured, simulate, notice };
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" })); // dinaikkan karena sekarang kirim SEMUA foto mentah (8x) + hasil final sekaligus
app.use("/uploads", express.static(path.join(config.dataDir, "uploads")));

const upload = multer({ dest: path.join(config.dataDir, "uploads") });

// ---------- AUTH ----------

// Dipanggil frontend buat cek: apakah PC ini sudah pernah di-setup (ada
// user admin) atau belum. Kalau belum, frontend nampilin wizard setup
// akun pertama, bukan halaman login biasa.
app.get("/api/auth/status", (req, res) => {
  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
  const settings = db.prepare("SELECT store_name FROM store_settings WHERE id = 1").get();
  res.json({ needsSetup: userCount === 0, storeName: settings?.store_name });
});

const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;
function validateUsername(u) {
  return typeof u === "string" && USERNAME_RE.test(u.trim())
    ? null : "Username 3-32 karakter: huruf, angka, titik, strip, atau underscore (tanpa spasi).";
}
function validatePassword(p) {
  return typeof p === "string" && p.length >= 6 && p.length <= 100 ? null : "Password minimal 6 karakter.";
}
const usernameTaken = (username, exceptId) =>
  !!db.prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?").get(username, exceptId ?? "");
const activeSuperadmins = () => db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'superadmin' AND active = 1").get().c;

// Setup akun pertama = SUPER ADMIN (cuma bisa dipanggil kalau belum ada user sama sekali).
app.post("/api/auth/setup", (req, res) => {
  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
  if (userCount > 0) return res.status(403).json({ error: "Setup sudah pernah dilakukan. Pakai halaman login." });

  const { password, storeName } = req.body;
  const username = String(req.body.username ?? "").trim();
  const err = validateUsername(username) || validatePassword(password);
  if (err) return res.status(400).json({ error: err });

  const { hash, salt } = hashPassword(password);
  const id = nanoid();
  db.prepare("INSERT INTO users (id, username, password_hash, password_salt, role) VALUES (?, ?, ?, ?, 'superadmin')").run(id, username, hash, salt);
  if (storeName) db.prepare("UPDATE store_settings SET store_name = ? WHERE id = 1").run(storeName);

  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  logActivity(row, "auth.setup", username, { role: "superadmin" }, req);
  res.json({ token: createToken(row), user: auth.publicUser(row) });
});

// Batasi tebak password: maks 8 kegagalan per username per 5 menit
const loginFails = new Map();
const DUMMY = hashPassword("dummy-password");
app.post("/api/auth/login", (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const key = username.toLowerCase();
  const recent = (loginFails.get(key) || []).filter((t) => Date.now() - t < 5 * 60 * 1000);
  if (recent.length >= 8) {
    logActivity(username.slice(0, 40) || "(kosong)", "auth.login_failed", username.slice(0, 40), { alasan: "terlalu banyak percobaan (diblokir sementara)" }, req);
    return res.status(429).json({ error: "Terlalu banyak percobaan gagal. Coba lagi beberapa menit lagi." });
  }

  const row = db.prepare("SELECT * FROM users WHERE LOWER(username) = LOWER(?)").get(username);
  // Selalu hitung hash (meski user tidak ada) supaya waktu respons tidak membocorkan keberadaan akun
  const ok = row ? verifyPassword(password, row.password_hash, row.password_salt) : (verifyPassword(password, DUMMY.hash, DUMMY.salt), false);
  if (!row || !ok) {
    loginFails.set(key, [...recent, Date.now()]);
    logActivity(row ? row : username.slice(0, 40) || "(kosong)", "auth.login_failed", username.slice(0, 40), { alasan: row ? "password salah" : "username tidak ada" }, req);
    return res.status(401).json({ error: "Username atau password salah." });
  }
  if (!row.active) {
    logActivity(row, "auth.login_failed", row.username, { alasan: "akun dinonaktifkan" }, req);
    return res.status(403).json({ error: "Akun ini dinonaktifkan. Hubungi Super Admin." });
  }

  loginFails.delete(key);
  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
  logActivity(row, "auth.login", row.username, { peran: row.role }, req);
  res.json({ token: createToken(row), user: auth.publicUser(row) });
});

// Data akun yang SEDANG login (hak akses terbaru). Dipakai frontend untuk menyegarkan menu.
app.get("/api/auth/me", requirePerm(), (req, res) => {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({ user: auth.publicUser(row) });
});

app.post("/api/auth/logout", requirePerm(), (req, res) => {
  logActivity(req.user, "auth.logout", req.user.username, null, req);
  res.json({ ok: true });
});

// Ganti data login SENDIRI (username / password). Wajib memasukkan password saat ini.
app.put("/api/auth/me", requirePerm(), (req, res) => {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const { currentPassword, newPassword } = req.body ?? {};
  if (!verifyPassword(String(currentPassword ?? ""), row.password_hash, row.password_salt)) {
    return res.status(400).json({ error: "Password saat ini salah." });
  }

  let username = row.username;
  if (typeof req.body.username === "string" && req.body.username.trim() !== row.username) {
    username = req.body.username.trim();
    const err = validateUsername(username);
    if (err) return res.status(400).json({ error: err });
    if (usernameTaken(username, row.id)) return res.status(409).json({ error: "Username sudah dipakai." });
  }

  let tokenVersion = row.token_version ?? 0;
  if (newPassword) {
    const err = validatePassword(newPassword);
    if (err) return res.status(400).json({ error: err });
    const { hash, salt } = hashPassword(newPassword);
    tokenVersion += 1; // semua sesi lama (di perangkat lain) otomatis keluar
    db.prepare("UPDATE users SET username = ?, password_hash = ?, password_salt = ?, token_version = ? WHERE id = ?").run(username, hash, salt, tokenVersion, row.id);
  } else {
    db.prepare("UPDATE users SET username = ? WHERE id = ?").run(username, row.id);
  }

  const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(row.id);
  logActivity(req.user, "account.update", row.username, {
    username: username !== row.username ? { from: row.username, to: username } : undefined,
    passwordChanged: newPassword ? true : undefined,
  }, req);
  res.json({ token: createToken(fresh), user: auth.publicUser(fresh) });
});

// ---------- PENGGUNA & HAK AKSES (khusus Super Admin) ----------

app.get("/api/auth/catalog", requirePerm(), (req, res) => {
  res.json({ permissions: auth.PERMISSIONS, roleDefaults: auth.getRoleDefaults(), roles: auth.ROLES });
});

app.put("/api/auth/roles", requirePerm("users.manage"), (req, res) => {
  const before = auth.getRoleDefaults();
  const after = auth.setRoleDefaults(req.body ?? {});
  const diff = {};
  for (const role of ["admin", "cashier"]) {
    const added = after[role].filter((p) => !before[role].includes(p));
    const removed = before[role].filter((p) => !after[role].includes(p));
    if (added.length || removed.length) diff[role] = { ditambah: added, dicabut: removed };
  }
  logActivity(req.user, "role.update", "hak akses peran", diff, req);
  res.json({ roleDefaults: after });
});

function formatUser(row) {
  const custom = auth.parseCustom(row);
  return {
    id: row.id, username: row.username, role: row.role, active: !!row.active,
    createdAt: row.created_at, lastLoginAt: row.last_login_at,
    permissions: auth.effectivePermissions(row),
    customPermissions: custom, // null = ikut default peran
  };
}

app.get("/api/auth/users", requirePerm("users.manage"), (req, res) => {
  res.json(db.prepare("SELECT * FROM users ORDER BY created_at, rowid").all().map(formatUser));
});

app.post("/api/auth/users", requirePerm("users.manage"), (req, res) => {
  const { password, role } = req.body ?? {};
  const username = String(req.body?.username ?? "").trim();
  const err = validateUsername(username) || validatePassword(password);
  if (err) return res.status(400).json({ error: err });
  if (!auth.ROLES.includes(role)) return res.status(400).json({ error: "Peran tidak valid." });
  if (usernameTaken(username)) return res.status(409).json({ error: "Username sudah dipakai." });

  const custom = role !== "superadmin" && Array.isArray(req.body.customPermissions) ? JSON.stringify(auth.cleanPerms(req.body.customPermissions)) : null;
  const { hash, salt } = hashPassword(password);
  const id = nanoid();
  db.prepare("INSERT INTO users (id, username, password_hash, password_salt, role, permissions) VALUES (?, ?, ?, ?, ?, ?)").run(id, username, hash, salt, role, custom);
  logActivity(req.user, "user.create", username, { peran: role, hakKhusus: custom ? JSON.parse(custom) : undefined }, req);
  res.json(formatUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id)));
});

// Ubah akun orang lain: username, reset password, peran, hak khusus, aktif/nonaktif.
app.put("/api/auth/users/:id", requirePerm("users.manage"), (req, res) => {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Akun tidak ditemukan." });
  const b = req.body ?? {};
  const isSelf = row.id === req.user.id;

  const next = { username: row.username, role: row.role, active: row.active, permissions: row.permissions, tv: row.token_version ?? 0 };
  let hash, salt;

  if (typeof b.username === "string" && b.username.trim() !== row.username) {
    const err = validateUsername(b.username);
    if (err) return res.status(400).json({ error: err });
    if (usernameTaken(b.username.trim(), row.id)) return res.status(409).json({ error: "Username sudah dipakai." });
    next.username = b.username.trim();
  }
  if (b.password) {
    const err = validatePassword(b.password);
    if (err) return res.status(400).json({ error: err });
    ({ hash, salt } = hashPassword(b.password));
    next.tv += 1;
  }
  if (b.role !== undefined && b.role !== row.role) {
    if (!auth.ROLES.includes(b.role)) return res.status(400).json({ error: "Peran tidak valid." });
    if (isSelf) return res.status(400).json({ error: "Kamu tidak bisa mengubah peran akunmu sendiri." });
    next.role = b.role;
  }
  if (b.active !== undefined && !!b.active !== !!row.active) {
    if (isSelf) return res.status(400).json({ error: "Kamu tidak bisa menonaktifkan akunmu sendiri." });
    next.active = b.active ? 1 : 0;
    if (!b.active) next.tv += 1; // paksa keluar dari semua sesi
  }
  if (b.customPermissions !== undefined) {
    if (isSelf) return res.status(400).json({ error: "Hak akses akunmu sendiri tidak bisa diubah di sini." });
    next.permissions = b.customPermissions === null ? null : JSON.stringify(auth.cleanPerms(b.customPermissions));
  }
  if (next.role === "superadmin") next.permissions = null;

  // Jangan sampai sistem kehilangan Super Admin terakhir
  const losesSuper = row.role === "superadmin" && row.active && (next.role !== "superadmin" || !next.active);
  if (losesSuper && activeSuperadmins() <= 1) {
    return res.status(400).json({ error: "Harus ada minimal satu Super Admin aktif." });
  }

  db.prepare("UPDATE users SET username = ?, role = ?, active = ?, permissions = ?, token_version = ? WHERE id = ?")
    .run(next.username, next.role, next.active, next.permissions, next.tv, row.id);
  if (hash) db.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?").run(hash, salt, row.id);
  const changes = {};
  if (next.username !== row.username) changes.username = { from: row.username, to: next.username };
  if (next.role !== row.role) changes.peran = { from: row.role, to: next.role };
  if (!!next.active !== !!row.active) changes.aktif = { from: !!row.active, to: !!next.active };
  if (next.permissions !== row.permissions) changes.hakAkses = next.permissions ? { khusus: JSON.parse(next.permissions) } : "ikut peran";
  if (hash) changes.passwordDireset = true;
  logActivity(req.user, "user.update", row.username, changes, req);
  res.json(formatUser(db.prepare("SELECT * FROM users WHERE id = ?").get(row.id)));
});

app.delete("/api/auth/users/:id", requirePerm("users.manage"), (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "Tidak bisa menghapus akun yang sedang kamu pakai." });
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Akun tidak ditemukan." });
  if (row.role === "superadmin" && row.active && activeSuperadmins() <= 1) {
    return res.status(400).json({ error: "Harus ada minimal satu Super Admin aktif." });
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(row.id);
  logActivity(req.user, "user.delete", row.username, { peran: row.role }, req);
  res.json({ ok: true });
});

// ---------- STORE SETTINGS ----------

app.get("/api/store/settings", requirePerm("settings.manage"), (req, res) => {
  res.json(db.prepare("SELECT * FROM store_settings WHERE id = 1").get());
});

app.put("/api/store/settings", requirePerm("settings.manage"), (req, res) => {
  const { storeName } = req.body;
  const prev = db.prepare("SELECT store_name FROM store_settings WHERE id = 1").get();
  db.prepare("UPDATE store_settings SET store_name = ? WHERE id = 1").run(storeName ?? null);
  if ((prev?.store_name ?? null) !== (storeName ?? null)) logActivity(req.user, "settings.update", "nama toko", { changes: [{ path: "storeName", from: prev?.store_name, to: storeName }] }, req);
  res.json({ ok: true });
});

// Unggah gambar untuk pengaturan tampilan (latar layar Start, "say cheese", latar & logo layar pengingat).
app.post("/api/settings/upload-asset", requirePerm("settings.manage"), upload.single("image"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "File gambar wajib diunggah." });
  const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" }[file.mimetype];
  if (!ext || file.size > 15 * 1024 * 1024) {
    fs.unlink(file.path, () => {});
    return res.status(400).json({ error: "Gambar harus PNG / JPG / WEBP / GIF, maksimal 15 MB." });
  }
  const finalName = `asset-${nanoid(12)}${ext}`;
  fs.renameSync(file.path, path.join(config.dataDir, "uploads", finalName));
  logActivity(req.user, "settings.upload", file.originalname?.slice(0, 80), null, req);
  res.json({ url: `/uploads/${finalName}`, fullUrl: toFullUrl(`/uploads/${finalName}`) });
});

/** Folder arsip permanen: pilihan admin (Pengaturan > Umum > Data Directory), kalau kosong pakai OUTPUT_DIR / bawaan. */
function outputDir() {
  const d = settingsStore.load().general?.dataDir;
  return d && path.isAbsolute(d) ? d : config.outputDir;
}

/** Cek folder bisa dibuat & ditulis. Mengembalikan pesan error atau null. */
function checkWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.popsnap-test-${nanoid(6)}`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return null;
  } catch (err) { return `Folder tidak bisa ditulis: ${err.code || err.message}`; }
}

// ---------- Pemilih folder (dipakai tombol Browse di admin) ----------
// Browser tidak boleh memberi alamat folder lengkap, jadi daftar folder dibaca oleh backend (yang jalan di PC booth yang sama).
const HIDDEN_DIR = /^(\.|\$)|^(System Volume Information|Recovery|Windows|Program Files|Program Files \(x86\)|ProgramData|node_modules)$/i;
app.get("/api/system/browse", requirePerm("settings.manage"), (req, res) => {
  const home = require("os").homedir();
  const shortcuts = [["Desktop", "Desktop"], ["Documents", "Documents"], ["Downloads", "Downloads"], ["Pictures", "Pictures"]]
    .map(([label, d]) => ({ label, path: path.join(home, d) })).filter((x) => fs.existsSync(x.path));
  shortcuts.unshift({ label: "Folder Home", path: home });
  const isWin = process.platform === "win32";
  const drives = [];
  if (isWin) for (const L of "CDEFGHIJKLMNOPQRSTUVWXYZ") { const r = `${L}:\\`; try { if (fs.existsSync(r)) drives.push({ label: `Drive ${L}:`, path: r }); } catch { /* lewati */ } }
  else drives.push({ label: "/", path: "/" });
  const want = String(req.query.path || "").trim();
  if (!want) return res.json({ path: "", parent: null, entries: drives, shortcuts, drives });
  if (!path.isAbsolute(want)) return res.status(400).json({ error: "Alamat folder harus lengkap." });
  const cur = path.resolve(want);
  try {
    const entries = fs.readdirSync(cur, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !HIDDEN_DIR.test(d.name))
      .map((d) => ({ label: d.name, path: path.join(cur, d.name) }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true }))
      .slice(0, 1000);
    const up = path.dirname(cur);
    res.json({ path: cur, parent: up === cur ? "" : up, entries, shortcuts, drives });
  } catch (err) {
    res.status(400).json({ error: `Folder tidak bisa dibuka: ${err.code || err.message}` });
  }
});

app.post("/api/system/mkdir", requirePerm("settings.manage"), (req, res) => {
  const parent = String(req.body?.parent ?? "").trim();
  const name = String(req.body?.name ?? "").trim();
  if (!parent || !path.isAbsolute(parent)) return res.status(400).json({ error: "Folder induk tidak valid." });
  if (!name || name.length > 80 || /[\\/:*?"<>|]/.test(name) || /^\.+$/.test(name)) return res.status(400).json({ error: "Nama folder tidak valid (jangan pakai \\ / : * ? \" < > |)." });
  try {
    const dir = path.join(parent, name);
    fs.mkdirSync(dir);
    res.json({ path: dir });
  } catch (err) {
    res.status(400).json({ error: err.code === "EEXIST" ? "Folder dengan nama itu sudah ada." : `Gagal membuat folder: ${err.code || err.message}` });
  }
});

// Dialog pilih folder BAWAAN SISTEM OPERASI. Dialog muncul di layar PC tempat backend berjalan, jadi hanya dilayani untuk
// permintaan dari PC itu sendiri (localhost / aplikasi desktop). Dari perangkat lain -> 403, admin otomatis memakai daftar folder dalam aplikasi.
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
let pickingFolder = false;
app.post("/api/system/pick-folder", requirePerm("settings.manage"), (req, res) => {
  if (!LOOPBACK.has(req.socket.remoteAddress)) return res.status(403).json({ error: "Dialog folder bawaan hanya bisa dibuka dari PC booth itu sendiri." });
  if (pickingFolder) return res.status(409).json({ error: "Dialog pilih folder sedang terbuka di PC booth." });
  const { execFile } = require("child_process");
  let start = String(req.body?.start ?? "").trim();
  try { if (!start || !path.isAbsolute(start) || !fs.statSync(start).isDirectory()) start = require("os").homedir(); } catch { start = require("os").homedir(); }
  const title = "Pilih folder";
  let cmd, args;
  const env = { ...process.env, POPSNAP_START: start, POPSNAP_TITLE: title };
  if (process.platform === "win32") {
    // Dialog "Open" Windows (sama seperti jendela pilih file), dipakai untuk memilih folder: masuk ke folder tujuan lalu klik Open.
    const ps = [
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "Add-Type -AssemblyName System.Windows.Forms",
      "$f = New-Object System.Windows.Forms.Form; $f.TopMost = $true; $f.ShowInTaskbar = $false; $f.StartPosition = 'CenterScreen'; $f.Size = New-Object System.Drawing.Size(0,0); $f.Opacity = 0; $f.Show(); $f.Activate()",
      "$d = New-Object System.Windows.Forms.OpenFileDialog",
      "$d.Title = $env:POPSNAP_TITLE + ' - masuk ke foldernya lalu klik Open'",
      "$d.InitialDirectory = $env:POPSNAP_START",
      "$d.ValidateNames = $false; $d.CheckFileExists = $false; $d.CheckPathExists = $true",
      "$d.FileName = 'Pilih folder ini'",
      "if ($d.ShowDialog($f) -eq [System.Windows.Forms.DialogResult]::OK) { [IO.Path]::GetDirectoryName($d.FileName) }",
      "$f.Close()",
    ].join("; ");
    cmd = "powershell.exe";
    args = ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")];
  } else if (process.platform === "darwin") {
    cmd = "osascript";
    args = ["-e", 'POSIX path of (choose folder with prompt "Pilih folder")'];
  } else {
    cmd = "zenity";
    args = ["--file-selection", "--directory", "--title=Pilih folder", `--filename=${start}/`];
  }
  pickingFolder = true;
  execFile(cmd, args, { env, timeout: 10 * 60 * 1000, windowsHide: false, maxBuffer: 1024 * 64 }, (err, stdout) => {
    pickingFolder = false;
    const out = String(stdout || "").replace(/^\uFEFF/, "").trim(); // buang BOM dari PowerShell
    if (out) return res.json({ path: path.resolve(out) });
    if (!err || err.code === 1) return res.json({ path: null }); // dibatalkan pengguna (powershell: tanpa output; zenity/osascript: kode 1)
    res.status(500).json({ error: `Dialog folder tidak bisa dibuka (${err.code || err.message}).` });
  });
});

// Tes folder ekspor real-time: coba buat folder & tulis file kecil, supaya salah ketik path ketahuan SEKARANG, bukan saat sesi pertama.
app.post("/api/settings/test-export-dir", requirePerm("settings.manage"), (req, res) => {
  const dir = String(req.body?.dir ?? "").trim();
  if (!dir || !path.isAbsolute(dir)) return res.status(400).json({ ok: false, error: "Isi dengan alamat folder lengkap, misalnya D:\\HASIL atau /home/user/hasil." });
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.popsnap-test-${nanoid(6)}`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: `Folder tidak bisa ditulis: ${err.code || err.message}` });
  }
});

// ---------- TEMPLATES ----------

// List semua template (dipakai kiosk utk pilih template, & admin editor)
// ---------- KATEGORI TEMPLATE ----------
function listCategories() {
  return db.prepare(`SELECT c.id, c.label, c.subtitle, c.icon, c.icon_white AS iconWhite, (SELECT COUNT(*) FROM templates t WHERE t.category = c.id) AS count,
      (SELECT COUNT(*) FROM templates t WHERE t.category = c.id AND t.favorite = 1) AS liveCount
    FROM categories c ORDER BY c.sort, c.rowid`).all().map((c) => ({ ...c, iconWhite: !!c.iconWhite }));
}
// Nama ikon galeri (gambarnya ada di frontend: components/categoryIcons.js)
const CATEGORY_ICON_PRESETS = ["heart", "star", "camera", "gift", "cake", "balloon", "ring", "cap", "users", "flower", "crown", "music"];
const CATEGORY_ICON_FILE_RE = /^upload:\/uploads\/(catico-[A-Za-z0-9_-]+\.(?:png|jpg|webp|gif))$/;
function deleteCategoryIconFile(icon) {
  const m = typeof icon === "string" && icon.match(CATEGORY_ICON_FILE_RE);
  if (m) fs.unlink(path.join(config.dataDir, "uploads", m[1]), () => {});
}
// Normalisasi nilai ikon dari klien: null/"" -> null; preset harus dikenal; unggahan hanya boleh file hasil endpoint upload
function parseCategoryIcon(v) {
  if (v === null || v === "" || v === undefined) return null;
  if (typeof v !== "string") return undefined;
  if (v.startsWith("preset:")) return CATEGORY_ICON_PRESETS.includes(v.slice(7)) ? v : undefined;
  const m = v.match(CATEGORY_ICON_FILE_RE);
  return m && fs.existsSync(path.join(config.dataDir, "uploads", m[1])) ? v : undefined;
}
function slugifyCategory(label) {
  return String(label).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "kategori";
}
// Kategori yang valid; kalau `cat` tidak dikenal -> fallback (atau kategori pertama)
function validCategory(cat, fallback) {
  const ids = db.prepare("SELECT id FROM categories ORDER BY sort, rowid").all().map((r) => r.id);
  if (cat && ids.includes(cat)) return cat;
  return fallback && ids.includes(fallback) ? fallback : ids[0] ?? "custom";
}
function cleanCategorySubtitle(v) {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  return t || null; // kosong -> null -> pil keterangan tidak tampil di booth
}
function cleanCategoryLabel(v) {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 40) : "";
}

// Publik: layar kiosk memakainya untuk kartu tipe template
app.get("/api/categories", (req, res) => res.json(listCategories()));

app.post("/api/categories", requirePerm("template.manage"), (req, res) => {
  const label = cleanCategoryLabel(req.body?.label);
  if (!label) return res.status(400).json({ error: "Nama kategori wajib diisi." });
  if (listCategories().some((c) => c.label.toLowerCase() === label.toLowerCase())) return res.status(409).json({ error: "Kategori dengan nama itu sudah ada." });
  const base = slugifyCategory(label);
  let id = base, n = 2;
  while (db.prepare("SELECT 1 FROM categories WHERE id = ?").get(id)) id = `${base}-${n++}`;
  db.prepare("INSERT INTO categories (id, label, subtitle, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM categories))").run(id, label, cleanCategorySubtitle(req.body?.subtitle));
  logActivity(req.user, "category.create", label, { id }, req);
  res.json({ created: id, categories: listCategories() });
});

// Urutan kartu di layar kiosk. Didaftarkan SEBELUM "/:id" supaya "order" tidak dianggap id.
app.put("/api/categories/order", requirePerm("template.manage"), (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  const known = listCategories().map((c) => c.id);
  if (ids.length !== known.length || !known.every((id) => ids.includes(id))) return res.status(400).json({ error: "Daftar urutan tidak cocok dengan kategori yang ada." });
  const upd = db.prepare("UPDATE categories SET sort = ? WHERE id = ?");
  ids.forEach((id, i) => upd.run(i, id));
  logActivity(req.user, "category.reorder", null, null, req);
  res.json({ categories: listCategories() });
});

// Ubah sebagian: { label?, subtitle?, icon?, iconWhite? }
app.put("/api/categories/:id", requirePerm("template.manage"), (req, res) => {
  const cur = db.prepare("SELECT * FROM categories WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "Kategori tidak ditemukan." });
  const body = req.body || {};

  if (body.label !== undefined) {
    const label = cleanCategoryLabel(body.label);
    if (!label) return res.status(400).json({ error: "Nama kategori wajib diisi." });
    if (listCategories().some((c) => c.id !== cur.id && c.label.toLowerCase() === label.toLowerCase())) return res.status(409).json({ error: "Kategori dengan nama itu sudah ada." });
    if (label !== cur.label) {
      db.prepare("UPDATE categories SET label = ? WHERE id = ?").run(label, cur.id);
      logActivity(req.user, "category.rename", cur.label, { menjadi: label }, req);
    }
  }
  if (body.subtitle !== undefined) {
    const subtitle = cleanCategorySubtitle(body.subtitle);
    if (subtitle !== (cur.subtitle ?? null)) {
      db.prepare("UPDATE categories SET subtitle = ? WHERE id = ?").run(subtitle, cur.id);
      logActivity(req.user, "category.subtitle", cur.label, { keterangan: subtitle ?? "(dikosongkan)" }, req);
    }
  }
  if (body.icon !== undefined) {
    const icon = parseCategoryIcon(body.icon);
    if (icon === undefined) return res.status(400).json({ error: "Ikon tidak valid." });
    if (icon !== cur.icon) {
      db.prepare("UPDATE categories SET icon = ? WHERE id = ?").run(icon, cur.id);
      if (cur.icon !== icon) deleteCategoryIconFile(cur.icon); // file unggahan lama tidak dipakai lagi
      logActivity(req.user, "category.icon", cur.label, { ikon: icon ?? "bawaan" }, req);
    }
  }
  if (body.iconWhite !== undefined) db.prepare("UPDATE categories SET icon_white = ? WHERE id = ?").run(body.iconWhite ? 1 : 0, cur.id);
  res.json({ categories: listCategories() });
});

// Unggah gambar ikon sendiri (PNG/JPG/WEBP/GIF, maks 2 MB). SVG sengaja tidak diterima (bisa memuat skrip).
app.post("/api/categories/:id/icon", requirePerm("template.manage"), upload.single("image"), (req, res) => {
  const file = req.file;
  const cur = db.prepare("SELECT * FROM categories WHERE id = ?").get(req.params.id);
  const reject = (code, msg) => { if (file) fs.unlink(file.path, () => {}); return res.status(code).json({ error: msg }); };
  if (!cur) return reject(404, "Kategori tidak ditemukan.");
  if (!file) return reject(400, "File gambar wajib diunggah.");
  const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" }[file.mimetype];
  if (!ext || file.size > 2 * 1024 * 1024) return reject(400, "Ikon harus PNG / JPG / WEBP / GIF, maksimal 2 MB.");
  const finalName = `catico-${nanoid(10)}${ext}`;
  fs.renameSync(file.path, path.join(config.dataDir, "uploads", finalName));
  deleteCategoryIconFile(cur.icon);
  db.prepare("UPDATE categories SET icon = ? WHERE id = ?").run(`upload:/uploads/${finalName}`, cur.id);
  logActivity(req.user, "category.icon", cur.label, { ikon: "unggahan", file: file.originalname?.slice(0, 60) }, req);
  res.json({ categories: listCategories() });
});

app.delete("/api/categories/:id", requirePerm("template.manage"), (req, res) => {
  const cur = db.prepare("SELECT * FROM categories WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "Kategori tidak ditemukan." });
  const used = db.prepare("SELECT COUNT(*) c FROM templates WHERE category = ?").get(cur.id).c;
  if (used > 0) return res.status(409).json({ error: `Masih ada ${used} template di kategori ini. Pindahkan atau hapus template-nya dulu.` });
  if (listCategories().length <= 1) return res.status(409).json({ error: "Minimal harus ada satu kategori." });
  db.prepare("DELETE FROM categories WHERE id = ?").run(cur.id);
  deleteCategoryIconFile(cur.icon);
  logActivity(req.user, "category.delete", cur.label, null, req);
  res.json({ categories: listCategories() });
});

// ---------- STIKER (Editor > Add sticker) ----------
// Admin mengunggah gambar (PNG/WEBP/GIF/JPG; SVG ditolak karena bisa memuat skrip) dan mengelompokkannya per kategori.
// Hak akses: sama dengan "Edit template" (template.manage). Daftar publik dipakai layar booth.
const STICKER_EXT = { "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/jpeg": ".jpg" };
const STICKER_FILE_RE = /^stk-[A-Za-z0-9_-]+\.(?:png|webp|gif|jpg)$/;
function imageDims(filePath) {
  const fn = typeof sizeOf === "function" ? sizeOf : sizeOf.imageSize;
  const d = fn(fs.readFileSync(filePath));
  return { width: d?.width || 0, height: d?.height || 0 };
}
function listStickers() {
  const categories = db.prepare(`SELECT c.id, c.label, (SELECT COUNT(*) FROM stickers s WHERE s.category_id = c.id) AS count FROM sticker_categories c ORDER BY c.sort, c.rowid`).all();
  const stickers = db.prepare("SELECT id, category_id, name, file, width, height FROM stickers ORDER BY sort, rowid").all()
    .map((s) => ({ id: s.id, categoryId: s.category_id, name: s.name, url: toFullUrl(`/uploads/${s.file}`), width: s.width, height: s.height }));
  return { categories, uncategorized: stickers.filter((s) => !s.categoryId).length, stickers };
}
const cleanStickerText = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

app.get("/api/stickers", (req, res) => res.json(listStickers()));

app.post("/api/stickers", requirePerm("template.manage"), upload.array("images", 40), (req, res) => {
  const files = req.files || [];
  const dropAll = () => files.forEach((f) => fs.unlink(f.path, () => {}));
  if (!files.length) return res.status(400).json({ error: "Pilih minimal satu gambar." });
  const catId = req.body?.categoryId ? String(req.body.categoryId) : null;
  if (catId && !db.prepare("SELECT 1 FROM sticker_categories WHERE id = ?").get(catId)) { dropAll(); return res.status(400).json({ error: "Kategori stiker tidak ditemukan." }); }
  const ins = db.prepare("INSERT INTO stickers (id, category_id, name, file, width, height, sort) VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM stickers))");
  const added = [], rejected = [];
  for (const f of files) {
    const ext = STICKER_EXT[f.mimetype];
    if (!ext || f.size > 3 * 1024 * 1024) { fs.unlink(f.path, () => {}); rejected.push(`${f.originalname}: harus PNG/WEBP/GIF/JPG maks. 3 MB`); continue; }
    let dims;
    try { dims = imageDims(f.path); } catch { dims = { width: 0, height: 0 }; }
    if (!dims.width || !dims.height || dims.width > 4000 || dims.height > 4000) { fs.unlink(f.path, () => {}); rejected.push(`${f.originalname}: bukan gambar valid / lebih dari 4000 px`); continue; }
    const id = nanoid(10);
    const finalName = `stk-${nanoid(12)}${ext}`;
    fs.renameSync(f.path, path.join(config.dataDir, "uploads", finalName));
    ins.run(id, catId, cleanStickerText(path.parse(f.originalname || "").name, 60), finalName, dims.width, dims.height);
    added.push(id);
  }
  if (added.length) logActivity(req.user, "sticker.upload", `${added.length} stiker`, { kategori: catId ?? "(tanpa kategori)" }, req);
  res.json({ added: added.length, rejected, ...listStickers() });
});

app.put("/api/stickers/:id", requirePerm("template.manage"), (req, res) => {
  const cur = db.prepare("SELECT * FROM stickers WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "Stiker tidak ditemukan." });
  const b = req.body || {};
  if (b.categoryId !== undefined) {
    const cid = b.categoryId ? String(b.categoryId) : null;
    if (cid && !db.prepare("SELECT 1 FROM sticker_categories WHERE id = ?").get(cid)) return res.status(400).json({ error: "Kategori stiker tidak ditemukan." });
    db.prepare("UPDATE stickers SET category_id = ? WHERE id = ?").run(cid, cur.id);
  }
  if (b.name !== undefined) db.prepare("UPDATE stickers SET name = ? WHERE id = ?").run(cleanStickerText(b.name, 60), cur.id);
  res.json(listStickers());
});

app.delete("/api/stickers/:id", requirePerm("template.manage"), (req, res) => {
  const cur = db.prepare("SELECT * FROM stickers WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "Stiker tidak ditemukan." });
  db.prepare("DELETE FROM stickers WHERE id = ?").run(cur.id);
  if (STICKER_FILE_RE.test(cur.file)) fs.unlink(path.join(config.dataDir, "uploads", cur.file), () => {});
  logActivity(req.user, "sticker.delete", cur.name || cur.id, null, req);
  res.json(listStickers());
});

app.post("/api/sticker-categories", requirePerm("template.manage"), (req, res) => {
  const label = cleanStickerText(req.body?.label, 40);
  if (!label) return res.status(400).json({ error: "Nama kategori wajib diisi." });
  if (listStickers().categories.some((c) => c.label.toLowerCase() === label.toLowerCase())) return res.status(409).json({ error: "Kategori dengan nama itu sudah ada." });
  const id = `sc-${nanoid(8)}`;
  db.prepare("INSERT INTO sticker_categories (id, label, sort) VALUES (?, ?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM sticker_categories))").run(id, label);
  logActivity(req.user, "sticker.category.create", label, null, req);
  res.json({ created: id, ...listStickers() });
});

app.put("/api/sticker-categories/:id", requirePerm("template.manage"), (req, res) => {
  const cur = db.prepare("SELECT * FROM sticker_categories WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "Kategori tidak ditemukan." });
  const label = cleanStickerText(req.body?.label, 40);
  if (!label) return res.status(400).json({ error: "Nama kategori wajib diisi." });
  if (listStickers().categories.some((c) => c.id !== cur.id && c.label.toLowerCase() === label.toLowerCase())) return res.status(409).json({ error: "Kategori dengan nama itu sudah ada." });
  db.prepare("UPDATE sticker_categories SET label = ? WHERE id = ?").run(label, cur.id);
  logActivity(req.user, "sticker.category.rename", cur.label, { menjadi: label }, req);
  res.json(listStickers());
});

// Hapus kategori: stikernya TIDAK ikut terhapus, pindah ke "Tanpa kategori".
app.delete("/api/sticker-categories/:id", requirePerm("template.manage"), (req, res) => {
  const cur = db.prepare("SELECT * FROM sticker_categories WHERE id = ?").get(req.params.id);
  if (!cur) return res.status(404).json({ error: "Kategori tidak ditemukan." });
  db.prepare("UPDATE stickers SET category_id = NULL WHERE category_id = ?").run(cur.id);
  db.prepare("DELETE FROM sticker_categories WHERE id = ?").run(cur.id);
  logActivity(req.user, "sticker.category.delete", cur.label, null, req);
  res.json(listStickers());
});

app.get("/api/templates", (req, res) => {
  const rows = db.prepare("SELECT * FROM templates ORDER BY created_at DESC").all();
  res.json(rows.map(formatTemplate));
});

// Bikin template BARU ala dslrBooth: ukuran kanvas dipilih DULU (kertas + dpi),
// bukan ditebak dari ukuran file gambar. Gambar awal sekarang OPSIONAL —
// kalau dikirim, dipasang sebagai layer gambar paling belakang.
app.post("/api/templates", requirePerm("template.manage"), upload.single("initialImage"), (req, res) => {
  const { category, name, price, paperSize, orientation, dpi, backgroundColor } = req.body;
  const width = Math.round(Number(req.body.canvasWidth));
  const height = Math.round(Number(req.body.canvasHeight));
  if (!width || !height || width < 50 || height < 50 || width > 12000 || height > 12000) {
    return res.status(400).json({ error: "canvasWidth & canvasHeight wajib angka (50-12000 px)." });
  }

  const initialLayers = [];
  const file = req.file;
  if (file) {
    const finalName = saveUploadedFile(file);
    initialLayers.push({
      id: nanoid(), type: "image", name: "Background", imageUrl: `/uploads/${finalName}`,
      xPct: 0, yPct: 0, widthPct: 100, heightPct: 100, rotation: 0,
    });
  }

  const id = nanoid();
  db.prepare(`
    INSERT INTO templates (id, name, category, background_url, canvas_width, canvas_height, layers, price,
                           background_color, paper_size, orientation, dpi)
    VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, name || "Template Baru", validCategory(category), width, height, JSON.stringify(initialLayers), Number(price) || 0,
    backgroundColor || "#ffffff", paperSize || "custom", orientation === "landscape" ? "landscape" : "portrait", Number(dpi) || 300
  );

  const row = db.prepare("SELECT * FROM templates WHERE id = ?").get(id);
  logActivity(req.user, req.body.imported === "1" ? "template.import" : "template.create", name || "Template Baru", { ukuran: `${width}x${height}`, kertas: paperSize || "custom" }, req);
  res.json(formatTemplate(row));
});

// Upload gambar TAMBAHAN (dekorasi/sticker/dsb) buat dipakai sebagai layer
// bertipe "image" di editor. Beda dari initialImage di atas — ini dipanggil
// berkali-kali tiap admin nambah elemen gambar baru ke template yang sedang diedit.
app.post("/api/templates/:id/assets", requirePerm("template.manage"), upload.single("image"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "File gambar wajib diupload" });
  const finalName = saveUploadedFile(file);
  res.json({ url: `/uploads/${finalName}`, fullUrl: `http://${config.publicHost}:${config.port}/uploads/${finalName}` });
});

function saveUploadedFile(file) {
  const ext = path.extname(file.originalname) || ".png";
  const finalName = `${file.filename}${ext}`;
  fs.renameSync(file.path, path.join(config.dataDir, "uploads", finalName));
  return finalName;
}

// Simpan SELURUH layer (posisi, urutan depan-belakang, isi tiap elemen) + harga.
// Dipanggil tiap kali admin klik "Simpan" di editor.
app.put("/api/templates/:id/layers", requirePerm("template.manage"), (req, res) => {
  const { layers, price, name, category, backgroundColor, paperSize, orientation, dpi, canvasWidth, canvasHeight } = req.body;
  // WAJIB divalidasi — JSON.stringify(undefined) bukan JSON valid dan bakal
  // bikin SEMUA template gagal dimuat saat GET /api/templates.
  if (!Array.isArray(layers)) {
    return res.status(400).json({ error: "layers wajib berupa array." });
  }
  const current = db.prepare("SELECT * FROM templates WHERE id = ?").get(req.params.id);
  if (!current) return res.status(404).json({ error: "Template tidak ditemukan." });

  const w = Math.round(Number(canvasWidth)) || current.canvas_width;
  const h = Math.round(Number(canvasHeight)) || current.canvas_height;
  db.prepare(`
    UPDATE templates SET layers = ?, price = ?, name = ?, category = ?, background_color = ?,
      paper_size = ?, orientation = ?, dpi = ?, canvas_width = ?, canvas_height = ?
    WHERE id = ?
  `).run(
    JSON.stringify(layers),
    price !== undefined ? Number(price) || 0 : current.price,
    name || current.name,
    category ? validCategory(category, current.category) : current.category,
    backgroundColor || current.background_color,
    paperSize || current.paper_size,
    orientation === "landscape" || orientation === "portrait" ? orientation : current.orientation,
    Number(dpi) || current.dpi,
    w, h,
    req.params.id
  );
  const prevLayers = (() => { try { return JSON.parse(current.layers || "[]").length; } catch { return 0; } })();
  const detail = { layer: layers.length };
  if (prevLayers !== layers.length) detail.layerSebelumnya = prevLayers;
  if (name && name !== current.name) detail.nama = { from: current.name, to: name };
  if (price !== undefined && Number(price) !== current.price) detail.harga = { from: current.price, to: Number(price) || 0 };
  if (w !== current.canvas_width || h !== current.canvas_height) detail.ukuran = { from: `${current.canvas_width}x${current.canvas_height}`, to: `${w}x${h}` };
  logActivity(req.user, "template.update", name || current.name, detail, req);
  res.json({ ok: true });
});

// Ubah ukuran kanvas MANUAL — dipakai kalau deteksi otomatis pas upload salah
// (misal gara-gara format PNG tertentu gagal dibaca library-nya), sehingga
// posisi semua layer meleset dari ukuran asli file template.
app.put("/api/templates/:id/canvas-size", requirePerm("template.manage"), (req, res) => {
  const { canvasWidth, canvasHeight } = req.body;
  const w = Number(canvasWidth);
  const h = Number(canvasHeight);
  if (!w || !h || w <= 0 || h <= 0) {
    return res.status(400).json({ error: "canvasWidth & canvasHeight wajib angka positif." });
  }
  db.prepare("UPDATE templates SET canvas_width = ?, canvas_height = ? WHERE id = ?").run(w, h, req.params.id);
  res.json({ ok: true });
});

app.delete("/api/templates/:id", requirePerm("template.manage"), (req, res) => {
  // CATATAN: sengaja TIDAK langsung hapus file gambarnya di sini. Kalau ada
  // konsumen yang lagi di tengah sesi foto pakai template ini pas admin hapus,
  // file yang masih dia butuhin buat compose hasil akhir bisa ke-delete duluan
  // dan hasil fotonya jadi rusak. File yang beneran gak kepake dibersihin
  // belakangan lewat endpoint /api/templates/cleanup-orphaned-files (manual,
  // dijalankan admin pas yakin gak ada sesi yang lagi jalan, misal akhir hari).
  const gone = db.prepare("SELECT name FROM templates WHERE id = ?").get(req.params.id);
  db.prepare("DELETE FROM templates WHERE id = ?").run(req.params.id);
  logActivity(req.user, "template.delete", gone?.name ?? req.params.id, null, req);
  res.json({ ok: true });
});

// Bintang favorit: template favorit yang tampil di booth kalau Tampilan > Template diatur "pilih dari favorit".
app.put("/api/templates/:id/favorite", requirePerm("template.manage"), (req, res) => {
  const t = db.prepare("SELECT name, favorite FROM templates WHERE id = ?").get(req.params.id);
  if (!t) return res.status(404).json({ error: "Template tidak ditemukan." });
  const value = typeof req.body?.favorite === "boolean" ? (req.body.favorite ? 1 : 0) : t.favorite ? 0 : 1;
  db.prepare("UPDATE templates SET favorite = ? WHERE id = ?").run(value, req.params.id);
  logActivity(req.user, value ? "template.favorite" : "template.unfavorite", t.name, null, req);
  res.json({ favorite: !!value });
});

// Saklar "Template animasi": template ini menghasilkan GIF gerak + klip mentah per foto (lihat Pengaturan > GIF & Video).
app.put("/api/templates/:id/animated", requirePerm("template.manage"), (req, res) => {
  const t = db.prepare("SELECT name, animated FROM templates WHERE id = ?").get(req.params.id);
  if (!t) return res.status(404).json({ error: "Template tidak ditemukan." });
  const value = typeof req.body?.animated === "boolean" ? (req.body.animated ? 1 : 0) : t.animated ? 0 : 1;
  db.prepare("UPDATE templates SET animated = ? WHERE id = ?").run(value, req.params.id);
  logActivity(req.user, value ? "template.animated_on" : "template.animated_off", t.name, null, req);
  res.json({ animated: !!value });
});

// Aksi yang terjadi di sisi browser (ekspor file template, cetak tes) dicatat lewat sini.
app.post("/api/templates/:id/audit", requirePerm("template.manage"), (req, res) => {
  const action = { export: "template.export", print_test: "template.print_test" }[req.body?.action];
  if (!action) return res.status(400).json({ error: "Aksi tidak dikenal." });
  const t = db.prepare("SELECT name FROM templates WHERE id = ?").get(req.params.id);
  if (!t) return res.status(404).json({ error: "Template tidak ditemukan." });
  logActivity(req.user, action, t.name, null, req);
  res.json({ ok: true });
});

// Bersihin file di folder uploads/ yang UDAH GAK DIPAKAI template mana pun lagi
// (sisa dari template yang pernah dihapus). Aman dijalankan kapan saja karena
// cuma hapus file yang beneran orphan — tapi disarankan pas gak ada sesi
// konsumen yang lagi jalan (misal tutup toko), buat jaga-jaga.
app.post("/api/templates/cleanup-orphaned-files", requirePerm("tools.maintenance"), (req, res) => {
  const allTemplates = db.prepare("SELECT layers FROM templates").all();
  const usedFilenames = new Set();
  for (const row of allTemplates) {
    try {
      const layers = JSON.parse(row.layers || "[]");
      for (const layer of layers) {
        if (layer.type === "image" && layer.imageUrl) {
          const filename = layer.imageUrl.split("/uploads/")[1];
          if (filename) usedFilenames.add(filename);
        }
      }
    } catch {
      // template dengan layers rusak — lewati, gak masalah buat proses cleanup ini
    }
  }

  // PENTING: folder uploads/ juga dipakai buat simpan hasil foto akhir
  // konsumen (yang dilayani lewat link QR download) — file-file ITU BUKAN
  // "orphan", jangan ikut kehapus. Kecualikan semua yang tercatat di
  // tabel sessions, biar cleanup ini cuma nyentuh sisa file template lama.
  const allSessions = db.prepare("SELECT final_image_path, gif_path, video_path FROM sessions").all();
  for (const s of allSessions) {
    for (const p of [s.final_image_path, s.gif_path, s.video_path]) {
      const filename = p && p.split("/uploads/")[1];
      if (filename) usedFilenames.add(filename);
    }
  }
  // Ikon kategori unggahan admin juga JANGAN ikut terhapus
  for (const c of db.prepare("SELECT icon FROM categories WHERE icon LIKE 'upload:%'").all()) {
    const filename = c.icon.split("/uploads/")[1];
    if (filename) usedFilenames.add(filename);
  }
  // Stiker unggahan admin juga JANGAN ikut terhapus
  for (const st of db.prepare("SELECT file FROM stickers").all()) usedFilenames.add(st.file);
  // Gambar yang dipakai pengaturan tampilan (latar Start, logo, say cheese, layar pengingat) juga JANGAN ikut terhapus
  JSON.stringify(settingsStore.load(), (k, v) => {
    if (typeof v === "string" && v.startsWith("/uploads/")) usedFilenames.add(v.split("/uploads/")[1]);
    return v;
  });

  const uploadsDir = path.join(config.dataDir, "uploads");
  const allFiles = fs.readdirSync(uploadsDir);
  let deletedCount = 0;
  for (const filename of allFiles) {
    if (filename === ".gitkeep") continue;
    if (!usedFilenames.has(filename)) {
      fs.unlinkSync(path.join(uploadsDir, filename));
      deletedCount++;
    }
  }

  logActivity(req.user, "files.cleanup", "file tidak terpakai", { dihapus: deletedCount }, req);
  res.json({ ok: true, deletedCount });
});

function formatTemplate(row) {
  // try/catch di sini itu PERTAHANAN KEDUA — kalau ada baris lama yang
  // kebetulan udah kadung rusak (data JSON gak valid), 1 baris itu gak
  // sampai bikin SELURUH daftar template gagal dimuat (yang berarti kiosk
  // konsumen ikut mati total). Baris yang rusak cuma dianggap "tanpa layer"
  // sampai admin masuk dan simpan ulang.
  let layers = [];
  try {
    layers = JSON.parse(row.layers || "[]").map((layer) =>
      layer.imageUrl ? { ...layer, imageUrl: toFullUrl(layer.imageUrl) } : layer
    );
  } catch (err) {
    console.error(`[template] Data layers rusak buat template "${row.name}" (id: ${row.id}):`, err.message);
  }
  // thumbnailUrl buat ditampilkan di layar pilih template konsumen —
  // dari layer gambar PALING BAWAH (index 0), atau fallback background_url lama.
  const firstImageLayer = layers.find((l) => l.type === "image");
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    thumbnailUrl: firstImageLayer?.imageUrl || (row.background_url ? toFullUrl(row.background_url) : null),
    canvasWidth: row.canvas_width,
    canvasHeight: row.canvas_height,
    backgroundColor: row.background_color || "#ffffff",
    favorite: !!row.favorite,
    animated: !!row.animated,
    paperSize: row.paper_size || "custom",
    orientation: row.orientation || "portrait",
    dpi: row.dpi || 300,
    layers,
    price: row.price,
  };
}

function toFullUrl(pathOrUrl) {
  // IDEMPOTEN: kalau udah full URL (http://...), jangan di-prefix lagi.
  // Ini WAJIB karena admin editor nyimpen ulang layer yang imageUrl-nya
  // udah dalam bentuk full URL (hasil dari GET sebelumnya) — tanpa cek ini,
  // domain bakal ke-tempel dobel tiap kali admin save ulang template yang
  // sudah pernah dibuka (jadi http://host:4000http://host:4000/uploads/...).
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `http://${config.publicHost}:${config.port}${pathOrUrl}`;
}

// ---------- PENGATURAN & STATUS ----------

// Dipakai layar booth (publik): hanya info yang aman dilihat konsumen (tanpa PIN, key, folder ekspor).
app.get("/api/settings/public", async (req, res) => {
  const store = db.prepare("SELECT store_name FROM store_settings WHERE id = 1").get();
  const pay = await paymentState();
  const kiosk = settingsStore.forKiosk();
  // Alamat gambar (latar Start, logo, "say cheese") dijadikan alamat penuh supaya bisa dimuat dari browser mana pun
  const d = kiosk.display;
  for (const o of [d.startScreen, d.capture, d.reminder]) {
    for (const k of ["image", "sayCheeseImage", "backgroundImage", "logoImage"]) if (o[k]) o[k] = toFullUrl(o[k]);
  }
  for (const f of kiosk.editor?.filters ?? []) if (f.lut?.url) f.lut.url = toFullUrl(f.lut.url);
  res.json({ storeName: store?.store_name, ...kiosk, payment: { mode: pay.mode, methods: pay.methods, online: pay.online } });
});

// PIN keluar dari layar penuh. Dibatasi 5 salah per menit (dengan jeda) supaya tidak bisa ditebak dari layar.
let pinFails = [];
app.post("/api/kiosk/verify-pin", (req, res) => {
  pinFails = pinFails.filter((t) => Date.now() - t < 60000);
  if (pinFails.length >= 5) return res.status(429).json({ ok: false, error: "Terlalu banyak percobaan. Tunggu 1 menit." });
  if (settingsStore.verifyPin(req.body?.pin)) {
    if (settingsStore.hasPin()) logActivity("booth (layar penuh)", "kiosk.unlock", null, null, req);
    return res.json({ ok: true });
  }
  pinFails.push(Date.now());
  logActivity("booth (layar penuh)", "kiosk.pin_failed", null, { percobaan: pinFails.length }, req);
  res.status(401).json({ ok: false, error: "PIN salah." });
});

app.get("/api/settings", requirePerm("settings.manage", "payment.gateway"), (req, res) => {
  const full = settingsStore.forAdmin();
  for (const f of full.editor?.filters ?? []) if (f.lut?.url) f.lut.url = toFullUrl(f.lut.url);
  if (!req.user.permissions.includes("payment.gateway")) delete full.payment;
  if (!req.user.permissions.includes("settings.manage")) { for (const k of ["event", "editor", "general", "camera", "display", "session", "gif", "result", "boomerang", "video", "animated"]) delete full[k]; }
  res.json(full);
});

app.put("/api/settings", requirePerm("settings.manage", "payment.gateway"), (req, res) => {
  const body = req.body ?? {};
  const can = (p) => req.user.permissions.includes(p);
  const touchesGeneral = body.event || body.editor || body.general || body.camera || body.display || body.session || body.gif || body.result || body.boomerang || body.video || body.animated;
  if (touchesGeneral && !can("settings.manage")) return res.status(403).json({ error: "Akun kamu tidak boleh mengubah pengaturan umum." });
  if (body.payment && !can("payment.gateway")) return res.status(403).json({ error: "Akun kamu tidak boleh mengubah pengaturan payment gateway." });
  const before = JSON.parse(JSON.stringify(settingsStore.load()));
  const newDataDir = typeof body.general?.dataDir === "string" ? body.general.dataDir.trim() : null;
  if (newDataDir) {
    if (!path.isAbsolute(newDataDir)) return res.status(400).json({ error: "Data Directory harus alamat folder lengkap, misalnya D:\\POPSNAP-Foto." });
    const bad = checkWritableDir(newDataDir);
    if (bad) return res.status(400).json({ error: `Data Directory: ${bad}` });
  }
  try {
    settingsStore.update(body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const changes = diffSettings(before, settingsStore.load()).filter((c) => !c.path.endsWith("serverKeySet") && !c.path.endsWith("tokenSet"));
  if (changes.length) {
    const section = changes.some((c) => c.path.startsWith("payment")) ? "payment gateway" : "pengaturan umum";
    logActivity(req.user, "settings.update", section, { changes }, req);
  }
  const full = settingsStore.forAdmin();
  if (!can("payment.gateway")) delete full.payment;
  res.json(full);
});

// Admin DAN kasir boleh ganti mode pembayaran (misal: internet mati -> voucher saja).
app.put("/api/settings/payment-mode", requirePerm("payment.mode"), async (req, res) => {
  const prevMode = settingsStore.load().payment.mode;
  if (!settingsStore.setPaymentMode(req.body?.mode)) {
    return res.status(400).json({ error: "Mode pembayaran tidak valid." });
  }
  if (prevMode !== req.body.mode) logActivity(req.user, "payment.mode", req.body.mode, { from: prevMode, to: req.body.mode }, req);
  res.json(await paymentState());
});

app.post("/api/settings/pos-api-key/regenerate", requirePerm("payment.gateway"), (req, res) => {
  const apiKey = settingsStore.regenerateApiKey();
  logActivity(req.user, "pos.key_regenerate", "API key aplikasi kasir", null, req);
  res.json({ apiKey });
});

// ---------- LOG AKTIVITAS ----------
// Hanya baca. Filter: cat (kategori), user, q (cari teks), from/to (ISO), before (id terakhir untuk halaman berikutnya).
app.get("/api/admin/activity", requirePerm("activity.view"), (req, res) => {
  const q = req.query;
  const where = [];
  const args = [];
  if (q.cat) { where.push("action LIKE ?"); args.push(`${String(q.cat).replace(/[^a-z_]/gi, "")}.%`); }
  if (q.user) { where.push("username = ?"); args.push(String(q.user)); }
  if (q.from) { where.push("at >= ?"); args.push(String(q.from)); }
  if (q.to) { where.push("at <= ?"); args.push(String(q.to)); }
  if (q.before) { where.push("id < ?"); args.push(Number(q.before) || 0); }
  if (q.q) {
    where.push("(username LIKE ? OR target LIKE ? OR detail LIKE ? OR action LIKE ?)");
    const like = `%${String(q.q).slice(0, 60)}%`;
    args.push(like, like, like, like);
  }
  const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
  const rows = db.prepare(`SELECT * FROM activity_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`).all(...args, limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).map((r) => ({
    id: r.id, at: r.at, userId: r.user_id, username: r.username, action: r.action, target: r.target, ip: r.ip,
    detail: (() => { try { return r.detail ? JSON.parse(r.detail) : null; } catch { return null; } })(),
  }));
  res.json({ rows: page, nextBefore: hasMore ? page[page.length - 1].id : null });
});

app.get("/api/admin/activity/meta", requirePerm("activity.view"), (req, res) => {
  res.json({ users: db.prepare("SELECT DISTINCT username FROM activity_log WHERE username IS NOT NULL ORDER BY username").all().map((r) => r.username) });
});

// Ringkasan buat halaman depan /admin
app.get("/api/admin/overview", requirePerm(), async (req, res) => {
  const pay = await paymentState();
  const one = (sql) => db.prepare(sql).get();
  const today = {
    sessions: one("SELECT COUNT(*) c FROM sessions WHERE date(created_at,'localtime') = date('now','localtime')").c,
    vouchersCreated: one("SELECT COUNT(*) c FROM vouchers WHERE voided = 0 AND date(created_at,'localtime') = date('now','localtime')").c,
    vouchersUsed: one("SELECT COUNT(*) c FROM vouchers WHERE use_count > 0 AND date(used_at,'localtime') = date('now','localtime')").c,
    qrisRevenue: one("SELECT COALESCE(SUM(gross_amount),0) t FROM payments WHERE status = 'paid' AND date(created_at,'localtime') = date('now','localtime')").t,
  };
  const out = { payment: pay, event: settingsStore.load().event, today: req.user.permissions.includes("report.view") ? today : null, user: { username: req.user.username, role: req.user.role } };
  if (req.user.permissions.includes("tools.maintenance")) {
    out.system = { publicHost: config.publicHost, port: config.port, retentionDays: config.fileRetentionDays, outputDir: outputDir(), defaultOutputDir: config.outputDir };
  }
  res.json(out);
});

// ---------- VOUCHER ----------

const makeVoucherCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8); // tanpa 0/O/1/I biar gak salah baca

// expiryDays: undefined = ikut pengaturan umum (jam) | 0/null = selamanya | angka = berapa hari
// maxUses:    undefined = 1x pakai | 0 = tak terbatas | angka = boleh dipakai berapa kali
function parseVoucherOptions(body) {
  const out = {};
  if (body?.expiryDays !== undefined) {
    const d = body.expiryDays === null ? 0 : Math.round(Number(body.expiryDays));
    out.expiryDays = Number.isFinite(d) ? Math.min(3650, Math.max(0, d)) : undefined;
  }
  if (body?.maxUses !== undefined) {
    const m = body.maxUses === null ? 0 : Math.round(Number(body.maxUses));
    out.maxUses = Number.isFinite(m) ? Math.min(999, Math.max(0, m)) : undefined;
  }
  return out;
}

function createVouchers({ count = 1, createdBy, source, note, reference, expiryDays, maxUses }) {
  let expiresAt;
  if (expiryDays === undefined) {
    const hours = settingsStore.load().payment.voucherExpiryHours;
    expiresAt = hours > 0 ? new Date(Date.now() + hours * 3600 * 1000).toISOString() : null;
  } else {
    expiresAt = expiryDays > 0 ? new Date(Date.now() + expiryDays * 86400 * 1000).toISOString() : null;
  }
  const uses = maxUses === undefined ? 1 : maxUses;
  const insert = db.prepare("INSERT INTO vouchers (code, created_by, source, note, reference, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = makeVoucherCode();
    insert.run(code, createdBy ?? null, source, note ?? null, reference ?? null, expiresAt, uses);
    codes.push(code);
  }
  return { codes, expiresAt };
}

function voucherStatus(row) {
  if (row.voided) return "voided";
  if (row.used || (row.max_uses > 0 && row.use_count >= row.max_uses)) return "used"; // used = kuota habis
  if (row.expires_at && row.expires_at < new Date().toISOString()) return "expired";
  return "active";
}

function formatVoucher(row) {
  return {
    code: row.code, status: voucherStatus(row), createdAt: row.created_at, createdBy: row.created_by,
    source: row.source, note: row.note, reference: row.reference, expiresAt: row.expires_at, usedAt: row.used_at,
    maxUses: row.max_uses, useCount: row.use_count,
  };
}

// Kasir generate kode voucher baru (dikasih fisik/verbal ke konsumen)
app.post("/api/voucher/generate", requirePerm("voucher.manage"), (req, res) => {
  const count = Math.min(20, Math.max(1, Math.round(Number(req.body?.count)) || 1));
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 100) : null;
  const opts = parseVoucherOptions(req.body);
  const { codes, expiresAt } = createVouchers({ count, createdBy: req.user.username, source: "cashier", note: note || null, ...opts });
  logActivity(req.user, "voucher.create", codes.join(", "), { jumlah: count, catatan: note || undefined, hari: opts.expiryDays, maksPakai: opts.maxUses }, req);
  res.json({ code: codes[0], codes, expiresAt, maxUses: opts.maxUses ?? 1 });
});

app.get("/api/voucher/list", requirePerm("voucher.manage"), (req, res) => {
  const rows = db.prepare("SELECT * FROM vouchers ORDER BY created_at DESC, rowid DESC LIMIT 100").all();
  res.json(rows.map(formatVoucher));
});

app.post("/api/voucher/:code/void", requirePerm("voucher.manage"), (req, res) => {
  const r = db.prepare("UPDATE vouchers SET voided = 1 WHERE code = ? AND used = 0 AND voided = 0").run(req.params.code.toUpperCase());
  if (r.changes === 0) return res.status(409).json({ error: "Voucher tidak ditemukan atau sudah dipakai/dibatalkan." });
  logActivity(req.user, "voucher.void", req.params.code.toUpperCase(), null, req);
  res.json({ ok: true });
});

/** Harga yang berlaku untuk template (mode foto) atau mode GIF/Boomerang/Video — selalu dari server. */
function priceFor(templateId, mode) {
  if (["gif", "boomerang", "video"].includes(mode)) return settingsStore.load().general.modes[mode]?.price || 0;
  const t = templateId ? db.prepare("SELECT price FROM templates WHERE id = ?").get(templateId) : null;
  return t?.price || 0;
}

// Batas percobaan salah (anti tebak-tebak kode): maks 10 kegagalan per menit
let voucherFails = [];

// Konsumen input kode di layar payment -> divalidasi & ditandai "used" (atomik: 1 kode = 1x pakai)
app.post("/api/voucher/validate", async (req, res) => {
  const fail = (reason, status = 200) => {
    voucherFails.push(Date.now());
    return res.status(status).json({ valid: false, reason });
  };
  voucherFails = voucherFails.filter((t) => Date.now() - t < 60000);
  if (voucherFails.length >= 10) {
    if (!voucherFails.warned || Date.now() - voucherFails.warned > 60000) {
      voucherFails.warned = Date.now();
      logActivity("booth (pelanggan)", "voucher.rate_limited", null, { alasan: "10 kode salah dalam 1 menit, input diblokir sementara" }, req);
    }
    return res.status(429).json({ valid: false, reason: "Terlalu banyak percobaan. Tunggu sebentar atau minta bantuan kasir." });
  }

  const pay = await paymentState();
  if (!pay.methods.includes("voucher")) return fail("Pembayaran voucher sedang tidak aktif.");

  const code = String(req.body?.code ?? "").trim().toUpperCase();
  const row = code ? db.prepare("SELECT * FROM vouchers WHERE code = ?").get(code) : null;
  if (!row) return fail("Kode voucher tidak ditemukan.");
  const status = voucherStatus(row);
  if (status === "voided") return fail("Voucher ini sudah dibatalkan.");
  if (status === "used") return fail(row.max_uses > 1 ? "Kuota pemakaian voucher ini sudah habis." : "Voucher ini sudah dipakai.");
  if (status === "expired") return fail("Voucher sudah kedaluwarsa.");

  // Atomik: tambah use_count hanya kalau kuota masih ada; used=1 ditandai saat kuota habis
  const r = db.prepare(`UPDATE vouchers SET use_count = use_count + 1, used_at = ?,
      used = CASE WHEN max_uses > 0 AND use_count + 1 >= max_uses THEN 1 ELSE 0 END
    WHERE code = ? AND voided = 0 AND used = 0 AND (max_uses = 0 OR use_count < max_uses)`).run(new Date().toISOString(), code);
  if (r.changes === 0) return fail("Voucher ini sudah dipakai.");
  logActivity("booth (pelanggan)", "voucher.used", code, row.max_uses === 1 ? null : { pemakaianKe: row.use_count + 1, maks: row.max_uses || "tak terbatas" }, req);
  // Nomor transaksi untuk riwayat kasir. Pendapatan voucher biasanya sudah tercatat di transaksi kasir (pelanggan bayar di sana),
  // jadi nilainya 0 kecuali admin menyalakan "Hitung voucher sebagai pendapatan".
  let orderNo = null;
  try {
    const tplId = typeof req.body?.templateId === "string" ? req.body.templateId : null;
    const mode = ["photo", "gif", "boomerang", "video"].includes(req.body?.mode) ? req.body.mode : "photo";
    const amount = settingsStore.load().payment.cloud.countVoucherRevenue ? priceFor(tplId, mode) : 0;
    orderNo = cloud.create({ method: "voucher", mode, templateId: tplId, amount, status: "paid", voucherCode: code, voucherRef: row.reference });
  } catch (err) { console.warn("[kasir-sync] Gagal mencatat transaksi voucher:", err.message); }
  res.json({ valid: true, orderNo });
});

// ---------- INTEGRASI APLIKASI KASIR (POS) ----------
// Aplikasi kasir kamu memanggil endpoint ini dengan header  X-API-Key: <key dari /admin/payment>
// Contoh: setelah pelanggan bayar di kasir -> POS minta voucher -> cetak di struk.

function requireApiKey(req, res, next) {
  const given = String(req.headers["x-api-key"] || "");
  const expected = settingsStore.load().payment.pos.apiKey;
  const h = (v) => crypto.createHash("sha256").update(v).digest();
  if (!given || !crypto.timingSafeEqual(h(given), h(expected))) {
    return res.status(401).json({ error: "API key tidak valid." });
  }
  next();
}

app.get("/api/integration/status", requireApiKey, async (req, res) => {
  const pay = await paymentState();
  res.json({ ok: true, paymentMode: pay.mode, methods: pay.methods, online: pay.online });
});

// Idempoten: kalau `reference` (misal nomor transaksi POS) sudah pernah dibuatkan voucher
// yang masih aktif, voucher yang sama dikembalikan — aman kalau POS retry saat koneksi putus.
app.post("/api/integration/vouchers", requireApiKey, (req, res) => {
  const reference = typeof req.body?.reference === "string" ? req.body.reference.trim().slice(0, 80) : "";
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 100) : null;
  const count = Math.min(20, Math.max(1, Math.round(Number(req.body?.count)) || 1));

  if (reference) {
    const existing = db.prepare("SELECT * FROM vouchers WHERE reference = ? AND source = 'api' AND voided = 0 ORDER BY rowid").all(reference);
    if (existing.length) return res.json({ codes: existing.map((r) => r.code), vouchers: existing.map(formatVoucher), reused: true });
  }
  const { codes, expiresAt } = createVouchers({ count, createdBy: "pos-api", source: "api", note, reference: reference || null, ...parseVoucherOptions(req.body) });
  logActivity("aplikasi kasir (API)", "voucher.create", codes.join(", "), { jumlah: count, referensi: reference || undefined, catatan: note || undefined }, req);
  res.json({ codes, expiresAt, reused: false });
});

app.get("/api/integration/vouchers/:code", requireApiKey, (req, res) => {
  const row = db.prepare("SELECT * FROM vouchers WHERE code = ?").get(req.params.code.toUpperCase());
  if (!row) return res.status(404).json({ error: "Voucher tidak ditemukan." });
  res.json(formatVoucher(row));
});

app.post("/api/integration/vouchers/:code/void", requireApiKey, (req, res) => {
  const r = db.prepare("UPDATE vouchers SET voided = 1 WHERE code = ? AND used = 0 AND voided = 0").run(req.params.code.toUpperCase());
  if (r.changes === 0) return res.status(409).json({ error: "Voucher tidak ditemukan atau sudah dipakai/dibatalkan." });
  logActivity("aplikasi kasir (API)", "voucher.void", req.params.code.toUpperCase(), null, req);
  res.json({ ok: true });
});

// ---------- SESSION (hasil akhir) ----------

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATA_IMG = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/;
// Kunci unggah per sesi (di memori): hanya pemilik sesi yang boleh menambahkan GIF/video ke sesinya.
const sessionKeys = new Map();
const publicFileUrl = (p) => (p ? `http://${config.publicHost}:${config.port}${p}` : null);

/** Salin hasil ke folder ekspor real-time (flashdisk / folder cloud) kalau diaktifkan admin. Gagal = dicatat saja, tidak menggagalkan sesi. */
function exportCopy(kind, name, data) {
  const ex = settingsStore.load().general.export;
  if (!ex.enabled || !ex.dir || !ex[kind]) return;
  try {
    const folder = { prints: "Prints", originals: "Originals", gifs: "GIFs", videos: "Videos" }[kind];
    const target = path.join(ex.dir, folder, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  } catch (err) {
    console.error(`[export] Gagal menyalin ${kind} ke "${ex.dir}":`, err.message);
  }
}

/** Tanggal HARI INI menurut jam PC booth (YYYY-MM-DD). toISOString() memakai UTC, jadi sesi jam 00.00-07.00 WIB salah masuk folder kemarin. */
function localDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sessionExpiry() {
  return new Date(Date.now() + config.fileRetentionDays * 24 * 60 * 60 * 1000).toISOString();
}

function archiveFolder(id) {
  const folder = path.join(outputDir(), localDate(), id);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

app.post("/api/session/finish", (req, res) => {
  const { sessionId, templateId, finalImage, shots, paymentMethod } = req.body ?? {};
  // sessionId datang dari browser -> JANGAN dipakai mentah-mentah sebagai nama file/folder (bisa "../../x").
  const id = SAFE_ID.test(String(sessionId ?? "")) ? String(sessionId) : nanoid();
  const key = nanoid(24);
  const stamp = localDate();

  let finalImagePath = null;
  let finalBuf = null;
  if (finalImage) {
    const m = DATA_IMG.exec(String(finalImage));
    if (!m) return res.status(400).json({ error: "finalImage harus berupa gambar PNG/JPEG (data URL)." });
    finalBuf = Buffer.from(m[2], "base64");
    // Nama file download acak (bukan kode voucher / id sesi) supaya link orang lain tidak bisa ditebak
    const filename = `${nanoid(16)}.${m[1] === "png" ? "png" : "jpg"}`;
    fs.writeFileSync(path.join(config.dataDir, "uploads", filename), finalBuf);
    finalImagePath = `/uploads/${filename}`;
  }

  const expiresAt = sessionExpiry();
  // Template animasi + halaman unduh aktif -> QR membuka halaman /s/<token> yang berisi semua file sesi (foto, GIF, video, klip)
  const shareToken = sharingOn() ? gallery.newShareCode() : null; // QR sesi foto = SATU halaman berisi semua file (hasil template, GIF, video, foto mentah, klip)
  db.prepare(`
    INSERT INTO sessions (id, template_id, final_image_path, payment_method, expires_at, mode, share_token)
    VALUES (?, ?, ?, ?, ?, 'photo', ?)
    ON CONFLICT(id) DO UPDATE SET final_image_path = excluded.final_image_path, share_token = COALESCE(excluded.share_token, sessions.share_token)
  `).run(id, templateId ?? null, finalImagePath, paymentMethod ?? null, expiresAt, shareToken);
  // ?? null WAJIB ada — node:sqlite melempar error kalau parameter `undefined`.
  sessionKeys.set(id, { key, until: Date.now() + 60 * 60 * 1000 });
  cloud.attachSession({ sessionId: id, ref: SAFE_ID.test(String(sessionId ?? "")) ? String(sessionId) : null, templateId, mode: "photo", paymentMethod });
  const realToken = db.prepare("SELECT share_token FROM sessions WHERE id = ?").get(id)?.share_token || shareToken; // sesi diulang: pakai token yang sudah tersimpan
  gallery.enqueue(id, realToken, "photo");

  // ---- Arsip PERMANEN: output/<tanggal>/<id>/final.png + raw/shot-N.jpg (SEMUA foto yang dijepret) ----
  try {
    const sessionFolder = archiveFolder(id);
    gallery.writeShareFile(sessionFolder, realToken, "photo");
    if (finalBuf) fs.writeFileSync(path.join(sessionFolder, "final.png"), finalBuf);
    if (finalBuf) exportCopy("prints", `${stamp}_${id}.png`, finalBuf);

    if (Array.isArray(shots) && shots.length > 0) {
      const rawFolder = path.join(sessionFolder, "raw");
      fs.mkdirSync(rawFolder, { recursive: true });
      shots.slice(0, 40).forEach((shot, i) => {
        const m = DATA_IMG.exec(String(shot));
        if (!m) return;
        const buf = Buffer.from(m[2], "base64");
        fs.writeFileSync(path.join(rawFolder, `shot-${i + 1}.jpg`), buf);
        try { // salinan di uploads supaya masuk halaman unduh /s/<token> (ikut terhapus otomatis sesuai masa simpan)
          const rawName = `${nanoid(16)}.jpg`;
          fs.writeFileSync(path.join(config.dataDir, "uploads", rawName), buf);
          db.prepare("DELETE FROM session_files WHERE session_id = ? AND kind = 'raw' AND idx = ?").run(id, i + 1);
          db.prepare("INSERT INTO session_files (session_id, kind, idx, path) VALUES (?, 'raw', ?, ?)").run(id, i + 1, `/uploads/${rawName}`);
        } catch (e) { console.error("[output] Gagal simpan foto mentah untuk halaman unduh:", e.message); }
        exportCopy("originals", path.join(`${stamp}_${id}`, `shot-${i + 1}.jpg`), buf);
      });
    }
  } catch (err) {
    // Gagal simpan arsip lokal jangan menggagalkan request — konsumen tetap harus dapat link download QR-nya.
    console.error("[output] Gagal simpan arsip lokal:", err.message);
  }

  res.json({ sessionId: id, uploadKey: key, downloadUrl: publicFileUrl(finalImagePath), shareUrl: gallery.shareUrlFor(realToken) || (realToken ? publicFileUrl(`/s/${realToken}`) : null), expiresAt });
});

// Unggah GIF / boomerang / video (isi mentah, bukan JSON — video bisa puluhan MB).
//   ?kind=gif|boomerang|video  &sessionId=...&key=...
// Tanpa sessionId = sesi baru (mode GIF / Boomerang / Video murni). Dengan sessionId+key = tambahan GIF untuk sesi foto.
const MEDIA = {
  gif: { exts: { "image/gif": "gif" }, magic: (b) => b.slice(0, 4).toString("latin1") === "GIF8", column: "gif_path", exportKind: "gifs" },
  boomerang: { exts: { "image/gif": "gif" }, magic: (b) => b.slice(0, 4).toString("latin1") === "GIF8", column: "final_image_path", exportKind: "gifs" },
  video: {
    exts: { "video/webm": "webm", "video/mp4": "mp4" },
    magic: (b) => (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) || b.slice(4, 8).toString("latin1") === "ftyp",
    column: "video_path", exportKind: "videos",
  },
};

app.post("/api/session/media", express.raw({ type: () => true, limit: "300mb" }), async (req, res) => {
  const kind = String(req.query.kind ?? "");
  const spec = MEDIA[kind];
  if (!spec) return res.status(400).json({ error: "kind harus gif, boomerang, atau video." });
  const mime = String(req.headers["content-type"] ?? "").split(";")[0].trim();
  const ext = spec.exts[mime];
  const body = req.body;
  if (!ext || !Buffer.isBuffer(body) || body.length < 16 || !spec.magic(body)) {
    return res.status(400).json({ error: "Isi file tidak sesuai jenis media yang dikirim." });
  }

  // Mode berbayar: pastikan mode ini memang diaktifkan admin (mode foto dilayani endpoint lain)
  const modeCfg = settingsStore.load().general.modes[kind === "boomerang" ? "boomerang" : kind];
  const isExisting = SAFE_ID.test(String(req.query.sessionId ?? ""));
  let id, key;
  if (isExisting) {
    id = String(req.query.sessionId);
    const k = sessionKeys.get(id);
    if (!k || k.key !== req.query.key || k.until < Date.now()) return res.status(403).json({ error: "Kunci sesi tidak valid / kedaluwarsa." });
    key = k.key;
  } else {
    if (!modeCfg?.enabled) return res.status(403).json({ error: "Mode ini tidak aktif." });
    id = nanoid();
    key = nanoid(24);
    sessionKeys.set(id, { key, until: Date.now() + 60 * 60 * 1000 });
  }

  const filename = `${nanoid(16)}.${ext}`;
  const urlPath = `/uploads/${filename}`;
  let mediaShareToken = null;
  fs.writeFileSync(path.join(config.dataDir, "uploads", filename), body);

  if (isExisting) {
    db.prepare(`UPDATE sessions SET ${spec.column} = ? WHERE id = ?`).run(urlPath, id);
  } else {
    mediaShareToken = gallery.ready() && sharingOn() ? gallery.newShareCode() : null; // galeri aktif: QR = halaman galeri
    db.prepare(`INSERT INTO sessions (id, ${spec.column}, payment_method, expires_at, mode, share_token) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, urlPath, req.query.paymentMethod ? String(req.query.paymentMethod).slice(0, 20) : null, sessionExpiry(), kind, mediaShareToken);
    if (mediaShareToken) gallery.enqueue(id, mediaShareToken, kind);
    const ref = SAFE_ID.test(String(req.query.orderNo ?? "")) ? String(req.query.orderNo) : null;
    cloud.attachSession({ sessionId: id, ref, mode: kind, paymentMethod: req.query.paymentMethod ? String(req.query.paymentMethod) : null });
  }

  try {
    const stamp = localDate();
    if (mediaShareToken) gallery.writeShareFile(archiveFolder(id), mediaShareToken, kind);
    fs.writeFileSync(path.join(archiveFolder(id), kind === "video" ? `video.${ext}` : kind === "boomerang" ? "boomerang.gif" : "session.gif"), body);
    exportCopy(spec.exportKind, `${stamp}_${id}${kind === "boomerang" ? "_boomerang" : ""}.${ext}`, body);
  } catch (err) {
    console.error("[output] Gagal simpan arsip media:", err.message);
  }
  res.json({ sessionId: id, uploadKey: key, downloadUrl: publicFileUrl(urlPath), shareUrl: mediaShareToken ? gallery.shareUrlFor(mediaShareToken) : null, expiresAt: sessionExpiry() });
});

// Klip mentah per foto (Template Animasi): MP4 / WebM / GIF pendek hasil rekaman sekitar jepretan. Satu klip per nomor foto.
const CLIP_TYPES = {
  "video/mp4": { ext: "mp4", magic: (b) => b.slice(4, 8).toString("latin1") === "ftyp" },
  "video/webm": { ext: "webm", magic: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  "image/gif": { ext: "gif", magic: (b) => b.slice(0, 4).toString("latin1") === "GIF8" },
};
app.post("/api/session/clip", express.raw({ type: () => true, limit: "60mb" }), (req, res) => {
  const id = String(req.query.sessionId ?? "");
  const k = SAFE_ID.test(id) ? sessionKeys.get(id) : null;
  if (!k || k.key !== req.query.key || k.until < Date.now()) return res.status(403).json({ error: "Kunci sesi tidak valid / kedaluwarsa." });
  if (settingsStore.load().result?.live === false) return res.status(403).json({ error: "Fitur Live dimatikan di pengaturan." });
  const mime = String(req.headers["content-type"] ?? "").split(";")[0].trim();
  const spec = CLIP_TYPES[mime];
  const body = req.body;
  if (!spec || !Buffer.isBuffer(body) || body.length < 16 || !spec.magic(body)) return res.status(400).json({ error: "Isi file bukan klip yang valid (MP4/WebM/GIF)." });
  if (!db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(id)) return res.status(404).json({ error: "Sesi tidak ditemukan." });
  const extra = req.query.live === "1" ? "live" : req.query.extra === "gifplain" ? "gifplain" : null; // file tambahan sesi (bukan klip per foto)
  const live = !!extra;
  const kindName = extra || "clip";
  const n = live ? 0 : Math.min(40, Math.max(1, parseInt(req.query.n, 10) || 1));

  // klip ke-n sudah ada (retake / unggah ulang) -> timpa
  for (const old of db.prepare("SELECT id, path FROM session_files WHERE session_id = ? AND kind = ? AND idx = ?").all(id, kindName, n)) {
    try { fs.unlinkSync(path.join(config.dataDir, old.path)); } catch { /* sudah tidak ada */ }
    db.prepare("DELETE FROM session_files WHERE id = ?").run(old.id);
  }
  const filename = `${nanoid(16)}.${spec.ext}`;
  const urlPath = `/uploads/${filename}`;
  fs.writeFileSync(path.join(config.dataDir, "uploads", filename), body);
  db.prepare("INSERT INTO session_files (session_id, kind, idx, path) VALUES (?, ?, ?, ?)").run(id, kindName, n, urlPath);
  try {
    if (live) {
      fs.writeFileSync(path.join(archiveFolder(id), `${extra}.${spec.ext}`), body);
      exportCopy(extra === "gifplain" ? "gifs" : "videos", path.join(`${localDate()}_${id}`, `${extra}.${spec.ext}`), body);
      return res.json({ ok: true, url: publicFileUrl(urlPath) });
    }
    fs.mkdirSync(path.join(archiveFolder(id), "clips"), { recursive: true });
    fs.writeFileSync(path.join(archiveFolder(id), "clips", `clip-${n}.${spec.ext}`), body);
    exportCopy("videos", path.join(`${localDate()}_${id}`, "clips", `clip-${n}.${spec.ext}`), body);
  } catch (err) {
    console.error("[output] Gagal simpan arsip klip:", err.message);
  }
  res.json({ ok: true, url: publicFileUrl(urlPath) });
});

// Halaman unduh /s/<token> (+ files.json, all.zip)
require("./cameraBridge").mount(app, { settingsStore });
require("./sharePage").mount(app, { db, backendDir: config.dataDir, getStoreName: () => settingsStore.load().event?.name || db.prepare("SELECT store_name FROM store_settings WHERE id = 1").get()?.store_name || "POPSNAP" });

// ---------- PAYMENT (QRIS via Midtrans) ----------

// Buat transaksi QRIS baru. Harga diambil dari data template di DB
// (BUKAN dari input klien) supaya harga tidak bisa dimanipulasi dari browser.
app.post("/api/payment/qris", async (req, res) => {
  const { templateId, mode } = req.body ?? {};
  const modeKey = ["gif", "boomerang", "video"].includes(mode) ? mode : null;
  if (!modeKey && !templateId) return res.status(400).json({ error: "templateId wajib diisi." });

  // Tolak kalau QRIS tidak aktif / internet mati — mencegah "gratis" lewat simulasi tak sengaja
  const pay = await paymentState();
  if (!pay.methods.includes("qris")) {
    return res.status(403).json({ error: "QRIS sedang tidak aktif. Gunakan voucher dari kasir." });
  }

  // Harga SELALU dari server: harga template (mode foto) atau harga mode (GIF/Boomerang/Video) — bukan dari browser.
  let grossAmount;
  let orderTemplateId = null;
  if (modeKey) {
    const cfg = settingsStore.load().general.modes[modeKey];
    if (!cfg.enabled) return res.status(403).json({ error: "Mode ini tidak aktif." });
    grossAmount = cfg.price || 0;
    if (grossAmount <= 0) return res.status(400).json({ error: "Mode ini gratis / belum diberi harga." });
  } else {
    const template = db.prepare("SELECT * FROM templates WHERE id = ?").get(templateId);
    if (!template) return res.status(404).json({ error: "Template tidak ditemukan" });
    orderTemplateId = templateId;
    grossAmount = template.price || 0;
    if (grossAmount <= 0) {
      return res.status(400).json({ error: "Template ini belum diatur harganya. Set harga dulu di Template Editor sebelum bisa menerima pembayaran QRIS." });
    }
  }
  // Nomor transaksi PB-<studio>-<tanggal>-<urut>: dipakai sebagai order_id Midtrans, id sesi, dan nomor di aplikasi kasir.
  const txMode = modeKey || "photo";
  const newTx = () => cloud.create({ method: "qris", mode: txMode, templateId: orderTemplateId, amount: grossAmount, status: "pending" });

  // ---- Mode SIMULASI (hanya kalau diaktifkan manual di pengaturan) ----
  if (settingsStore.load().payment.qris.simulate) {
    const orderId = newTx();
    db.prepare("INSERT INTO payments (order_id, template_id, gross_amount, status) VALUES (?, ?, ?, 'pending')").run(orderId, orderTemplateId, grossAmount);
    setTimeout(() => {
      db.prepare("UPDATE payments SET status = 'paid' WHERE order_id = ?").run(orderId);
      cloud.setStatus(orderId, "paid");
    }, 6000);
    return res.json({ orderId, qrString: `SIMULATED-QRIS-${orderId}`, amount: grossAmount, simulated: true });
  }

  // ---- DOKU QRIS (SNAP) ----
  if (settingsStore.load().payment.qris.provider === "doku") {
    for (let attempt = 0; attempt < 4; attempt++) {
      const orderId = newTx();
      try {
        const g = await doku.generate({ orderNo: orderId, amount: grossAmount, minutes: 15 });
        db.prepare("INSERT INTO payments (order_id, template_id, gross_amount, status, gateway_ref) VALUES (?, ?, ?, 'pending', ?)").run(orderId, orderTemplateId, grossAmount, g.referenceNo);
        return res.json({ orderId, qrString: g.qrContent, amount: grossAmount });
      } catch (err) {
        cloud.setStatus(orderId, "failed");
        if (/duplicate|already|sudah|4040/i.test(err.message) && attempt < 3) continue;
        console.error("[doku] Gagal membuat QRIS:", err.message);
        return res.status(500).json({ error: "Gagal membuat QRIS DOKU. Cek koneksi internet / pengaturan DOKU di Admin > Pembayaran." });
      }
    }
  }

  // ---- Mode ASLI (Midtrans Sandbox/Production) ----
  // Nomor yang pernah dipakai Midtrans (mis. database booth direset saat uji coba) ditolak -> otomatis coba nomor berikutnya.
  let orderId = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    orderId = newTx();
    try {
      const chargeResponse = await getMidtrans().charge({
        payment_type: "qris",
        transaction_details: { order_id: orderId, gross_amount: grossAmount },
      });

      db.prepare("INSERT INTO payments (order_id, template_id, gross_amount, status) VALUES (?, ?, ?, 'pending')").run(orderId, orderTemplateId, grossAmount);

      const qrAction = chargeResponse.actions?.find((a) => a.name === "generate-qr-code");
      return res.json({ orderId, qrImageUrl: qrAction?.url, amount: grossAmount });
    } catch (err) {
      cloud.setStatus(orderId, "failed");
      const duplicate = /already|duplicate|sudah/i.test(`${err.message} ${err.ApiResponse?.status_message ?? ""}`);
      if (duplicate && attempt < 3) continue;
      console.error("[midtrans] Gagal charge:", err.message);
      return res.status(500).json({ error: "Gagal membuat transaksi QRIS. Cek koneksi internet / key Midtrans." });
    }
  }
});

function mapMidtransStatus({ transaction_status, fraud_status }) {
  if (transaction_status === "settlement" || (transaction_status === "capture" && fraud_status === "accept")) return "paid";
  if (["expire", "cancel", "deny"].includes(transaction_status)) return "expired";
  return "pending";
}

// Dicek berkala oleh frontend (polling tiap 2 detik).
// PC booth ada di balik WiFi/router sehingga webhook Midtrans TIDAK bisa masuk —
// jadi kalau masih pending, backend yang bertanya langsung ke Midtrans (dibatasi 1x/1.5 detik per order).
const lastMidtransCheck = new Map();
app.get("/api/payment/status/:orderId", async (req, res) => {
  const orderId = req.params.orderId;
  let row = db.prepare("SELECT status, gateway_ref FROM payments WHERE order_id = ?").get(orderId);
  const mt = getMidtrans();
  const simulate = settingsStore.load().payment.qris.simulate;
  if (row?.status === "pending" && !simulate && settingsStore.load().payment.qris.provider === "doku" && doku.configured() && Date.now() - (lastMidtransCheck.get(orderId) || 0) > 2000) {
    lastMidtransCheck.set(orderId, Date.now());
    try {
      const st = await doku.queryStatus({ orderNo: orderId, referenceNo: row.gateway_ref });
      if (st !== "pending") {
        db.prepare("UPDATE payments SET status = ? WHERE order_id = ?").run(st, orderId);
        cloud.setStatus(orderId, st);
        row = { status: st };
        lastMidtransCheck.delete(orderId);
      }
    } catch { /* internet putus sesaat: coba lagi di polling berikutnya */ }
    return res.json({ status: row?.status || "pending" });
  }

  if (row?.status === "pending" && mt && !simulate && Date.now() - (lastMidtransCheck.get(orderId) || 0) > 1500) {
    lastMidtransCheck.set(orderId, Date.now());
    try {
      const st = mapMidtransStatus(await mt.transaction.status(orderId));
      if (st !== "pending") {
        db.prepare("UPDATE payments SET status = ? WHERE order_id = ?").run(st, orderId);
        cloud.setStatus(orderId, st);
        row = { status: st };
        lastMidtransCheck.delete(orderId);
      }
    } catch (err) {
      // Internet putus sesaat / transaksi belum terdaftar: abaikan, coba lagi di polling berikutnya
    }
  }
  res.json({ status: row?.status || "pending" });
});

app.post("/api/payment/doku/test", requirePerm("payment.gateway"), async (req, res) => res.json(await doku.testConnection()));

// Webhook (opsional) — kalau PC booth punya URL publik. Tanpa ini pun pembayaran tetap terdeteksi lewat polling di atas.
app.post("/api/payment/notification", async (req, res) => {
  const mt = getMidtrans();
  if (!mt) return res.json({ ok: true, note: "Midtrans belum dikonfigurasi, webhook diabaikan" });
  try {
    const statusResponse = await mt.transaction.notification(req.body);
    db.prepare("UPDATE payments SET status = ? WHERE order_id = ?").run(mapMidtransStatus(statusResponse), statusResponse.order_id);
    cloud.setStatus(statusResponse.order_id, mapMidtransStatus(statusResponse));
    res.json({ ok: true });
  } catch (err) {
    console.error("[midtrans] Gagal proses notifikasi:", err.message);
    res.status(500).json({ error: "Gagal memproses notifikasi" });
  }
});

// ---------- Sinkron transaksi ke aplikasi kasir (Pengaturan > Pembayaran) ----------
app.get("/api/cloud/status", requirePerm("payment.gateway"), (req, res) => res.json(cloud.status()));
app.get("/api/cloud/transactions", requirePerm("payment.gateway"), (req, res) => res.json({ transactions: cloud.recent(Number(req.query.limit) || 30) }));
app.post("/api/cloud/test", requirePerm("payment.gateway"), async (req, res) => res.json(await cloud.testConnection()));
app.post("/api/cloud/sync", requirePerm("payment.gateway"), async (req, res) => {
  const r = await cloud.pushPending({ force: true });
  res.json({ ...r, status: cloud.status() });
});
cloud.start();

// ---------- POPSNAP Galeri: unggah hasil sesi ke cloud + halaman QR (Pengaturan > Pembayaran) ----------
app.get("/api/gallery/status", requirePerm("payment.gateway"), (req, res) => res.json(gallery.status()));
app.post("/api/gallery/test", requirePerm("payment.gateway"), async (req, res) => res.json(await gallery.testConnection()));
app.post("/api/gallery/sync", requirePerm("payment.gateway"), async (req, res) => { const r = await gallery.run({ force: true }); res.json({ ...r, status: gallery.status() }); });
app.get("/api/gallery/archive", requirePerm("payment.gateway"), (req, res) => res.json({ ready: gallery.ready(), sessions: gallery.listArchive(outputDir(), Number(req.query.days) || 14) }));
app.post("/api/gallery/archive/upload", requirePerm("payment.gateway"), (req, res) => {
  const r = gallery.uploadArchive(outputDir(), req.body?.date, req.body?.id, req.body?.redo === true);
  res.status(r.ok ? 200 : 400).json(r);
});
gallery.start();

// ---------- Sync ringkasan ke server pusat (opsional) ----------
// Jalan tiap 5 menit. Kalau CLOUD_SYNC_URL gak diisi di .env, fungsi ini
// gak ngapa-ngapain (toko berdiri sendiri, gak lapor kemana-mana).
// Kalau internet lagi mati, gagal diam-diam dan coba lagi 5 menit berikutnya
// — gak pernah bikin operasional toko keganggu cuma gara-gara sync gagal.
async function syncToCloud() {
  if (!config.cloudSyncUrl) return;

  try {
    const store = db.prepare("SELECT * FROM store_settings WHERE id = 1").get();
    const today = localDate();
    const todaySessions = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE created_at LIKE ?").get(`${today}%`).count;
    const todayRevenue = cloud.todayRevenue(today); // dari tx_log: sama dengan kasir (ikut edit & hapus di kasir)
    const totalSessionsAllTime = db.prepare("SELECT COUNT(*) as count FROM sessions").get().count;

    await fetch(`${config.cloudSyncUrl}/api/sync/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": config.cloudSyncApiKey || "" },
      body: JSON.stringify({
        storeId: store.store_id,
        storeName: store.store_name,
        todaySessions,
        todayRevenue,
        totalSessionsAllTime,
        reportedAt: new Date().toISOString(),
      }),
    });
  } catch (err) {
    // Diam-diam gagal (misal gak ada internet) — coba lagi tick berikutnya
    console.log("[cloud sync] Gagal lapor ke server pusat (normal kalau lagi offline):", err.message);
  }
}
cloud.setOnChanged(() => { syncToCloud(); }); // edit/hapus di kasir -> dashboard pusat ikut langsung, tidak menunggu 5 menit
setInterval(syncToCloud, 5 * 60 * 1000);
syncToCloud(); // langsung coba sekali pas backend baru nyala, gak nunggu 5 menit pertama
// Jalan tiap 6 jam sekali, hapus session yang expires_at-nya sudah lewat.
setInterval(() => {
  const expired = db.prepare("SELECT * FROM sessions WHERE expires_at < datetime('now')").all();
  for (const s of expired) {
    const extra = db.prepare("SELECT path FROM session_files WHERE session_id = ?").all(s.id).map((r) => r.path);
    for (const p of [s.final_image_path, s.gif_path, s.video_path, ...extra]) {
      if (!p) continue;
      const filePath = path.join(config.dataDir, p);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    db.prepare("DELETE FROM session_files WHERE session_id = ?").run(s.id);
  }
  if (expired.length) {
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
    console.log(`[cleanup] Hapus ${expired.length} sesi yang lewat retensi.`);
  }
}, 6 * 60 * 60 * 1000);

// Pastikan folder arsip permanen ada sejak backend nyala
try { fs.mkdirSync(outputDir(), { recursive: true }); } catch (err) { console.error("[arsip] Folder arsip tidak bisa dibuat:", err.message); }

app.listen(config.port, () => {
  console.log(`POPSNAP backend jalan di http://localhost:${config.port}`);
  console.log(`Alamat LAN buat QR/gambar (dites bisa diakses HP lain di WiFi sama): http://${config.publicHost}:${config.port}`);
  console.log(`Arsip foto permanen tersimpan di: ${outputDir()}`);
  if (config.publicHost === "localhost") {
    console.log("[peringatan] Gagal deteksi IP LAN otomatis — QR download kemungkinan gak bisa dibuka dari HP lain. Set PUBLIC_HOST manual di .env.");
  }
});
