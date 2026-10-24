// ==========================================================
// POPSNAP Cloud Dashboard — server PUSAT
//
// BEDA sama backend/server.js (yang jalan lokal di tiap PC toko).
// Ini jalan di HOSTING (Railway/Render/VPS), nampung laporan ringkasan
// dari SEMUA toko, dan kasih kamu (owner) 1 tempat buat pantau semua.
//
// PENTING: proyek ini HARUS di-deploy ke server yang bisa diakses
// dari internet supaya toko-toko bisa lapor kesini. Gak bisa cuma
// jalan di PC lokal kayak backend biasa.
// ==========================================================
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");

const PORT = process.env.PORT || 5000;
const SYNC_API_KEY = process.env.SYNC_API_KEY || null; // WAJIB diisi di production, samain dengan CLOUD_SYNC_API_KEY di tiap toko
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString("hex");

if (!SYNC_API_KEY) {
  console.warn("[peringatan] SYNC_API_KEY belum diisi — SIAPA SAJA bisa kirim laporan palsu ke dashboard ini. WAJIB diisi sebelum dipakai produksi.");
}

const dbDir = path.join(__dirname, "db");
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new DatabaseSync(path.join(dbDir, "dashboard.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS stores (
    store_id TEXT PRIMARY KEY,
    store_name TEXT,
    today_sessions INTEGER DEFAULT 0,
    today_revenue INTEGER DEFAULT 0,
    total_sessions_all_time INTEGER DEFAULT 0,
    last_seen_at TEXT
  );

  CREATE TABLE IF NOT EXISTS owners (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL
  );
`);

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}
function verifyPassword(password, hash, salt) {
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- Terima laporan dari tiap toko ----------
app.post("/api/sync/report", (req, res) => {
  if (SYNC_API_KEY && req.headers["x-api-key"] !== SYNC_API_KEY) {
    return res.status(401).json({ error: "API key salah." });
  }
  const { storeId, storeName, todaySessions, todayRevenue, totalSessionsAllTime } = req.body;
  if (!storeId) return res.status(400).json({ error: "storeId wajib ada." });

  db.prepare(`
    INSERT INTO stores (store_id, store_name, today_sessions, today_revenue, total_sessions_all_time, last_seen_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(store_id) DO UPDATE SET
      store_name = excluded.store_name,
      today_sessions = excluded.today_sessions,
      today_revenue = excluded.today_revenue,
      total_sessions_all_time = excluded.total_sessions_all_time,
      last_seen_at = datetime('now')
  `).run(storeId, storeName, todaySessions || 0, todayRevenue || 0, totalSessionsAllTime || 0);

  res.json({ ok: true });
});

// ---------- Owner auth ----------
app.get("/api/auth/status", (req, res) => {
  const count = db.prepare("SELECT COUNT(*) as c FROM owners").get().c;
  res.json({ needsSetup: count === 0 });
});

app.post("/api/auth/setup", (req, res) => {
  const count = db.prepare("SELECT COUNT(*) as c FROM owners").get().c;
  if (count > 0) return res.status(403).json({ error: "Sudah pernah setup." });
  const { username, password } = req.body;
  if (!username || !password || password.length < 6) return res.status(400).json({ error: "Password minimal 6 karakter." });
  const { hash, salt } = hashPassword(password);
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO owners (id, username, password_hash, password_salt) VALUES (?, ?, ?, ?)").run(id, username, hash, salt);
  const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: { id, username } });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  const owner = db.prepare("SELECT * FROM owners WHERE username = ?").get(username);
  if (!owner || !verifyPassword(password, owner.password_hash, owner.password_salt)) {
    return res.status(401).json({ error: "Username atau password salah." });
  }
  const token = jwt.sign({ id: owner.id, username: owner.username }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: { id: owner.id, username: owner.username } });
});

function requireOwner(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Belum login." });
  try {
    req.owner = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Sesi habis, login ulang." });
  }
}

// ---------- List semua toko (buat dashboard) ----------
app.get("/api/stores", requireOwner, (req, res) => {
  const stores = db.prepare("SELECT * FROM stores ORDER BY last_seen_at DESC").all();
  res.json(stores);
});

app.listen(PORT, () => {
  console.log(`POPSNAP Cloud Dashboard jalan di port ${PORT}`);
});
