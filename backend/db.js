// ==========================================================
// Database setup — pakai node:sqlite (bawaan Node.js sendiri,
// TIDAK butuh compiler/Visual Studio seperti better-sqlite3).
// File disimpan di backend/db/popsnap.db, jalan lokal di PC booth,
// gak butuh internet (sesuai keputusan arsitektur "local-first hybrid").
//
// Syarat: Node.js versi 22.5 ke atas (kamu pakai v24, jadi aman).
// ==========================================================
const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs = require("fs");

const dbDir = path.join(require("./config").dataDir, "db");
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new DatabaseSync(path.join(dbDir, "popsnap.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    background_url TEXT NOT NULL,
    foreground_url TEXT,
    canvas_width INTEGER NOT NULL,
    canvas_height INTEGER NOT NULL,
    slots TEXT NOT NULL DEFAULT '[]',
    price INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vouchers (
    code TEXT PRIMARY KEY,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    template_id TEXT,
    final_image_path TEXT,
    payment_method TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT
  );

  CREATE TABLE IF NOT EXISTS payments (
    order_id TEXT PRIMARY KEY,
    template_id TEXT,
    gross_amount INTEGER,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL, -- 'admin' | 'cashier'
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS store_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1), -- cuma 1 baris, single-row config
    store_name TEXT,
    store_id TEXT -- identitas unik toko ini buat lapor ke server pusat
  );
`);

// ----------------------------------------------------------
// Migrasi ringan: kalau file db.popsnap.db kamu dibuat dari versi
// APLIKASI YANG LEBIH LAMA (sebelum kolom `price`/`foreground_url`
// ditambahkan), `CREATE TABLE IF NOT EXISTS` di atas TIDAK akan
// menambahkan kolom baru ke tabel yang sudah ada. Kode di bawah
// ini cek satu-satu dan nambahin kolom yang belum ada, supaya
// database lama otomatis "naik versi" tanpa perlu hapus manual.
// ----------------------------------------------------------
function ensureColumn(table, column, definition) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all();
  const hasColumn = existing.some((col) => col.name === column);
  if (!hasColumn) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[db migrate] Tambah kolom ${table}.${column}`);
  }
}

ensureColumn("payments", "gateway_ref", "TEXT"); // nomor referensi dari gateway (DOKU: referenceNo)

// Riwayat transaksi booth: nomor transaksi (order_no) dibuat di sini lalu dikirim ke aplikasi kasir (lihat cloudSync.js).
// synced_at kosong atau lebih lama dari updated_at = masih perlu dikirim.
db.exec(`
  CREATE TABLE IF NOT EXISTS tx_log (
    order_no TEXT PRIMARY KEY,
    method TEXT NOT NULL DEFAULT 'qris',
    mode TEXT,
    template_id TEXT,
    template_name TEXT,
    category TEXT,
    voucher_code TEXT,
    voucher_ref TEXT,
    amount INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    session_id TEXT,
    created_at TEXT NOT NULL,
    paid_at TEXT,
    updated_at TEXT NOT NULL,
    synced_at TEXT,
    sync_error TEXT,
    sync_tries INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_tx_log_session ON tx_log(session_id);
  CREATE INDEX IF NOT EXISTS idx_tx_log_updated ON tx_log(updated_at);
`);

// Perubahan dari kasir (edit/hapus transaksi). Baris tx_log TIDAK dihapus supaya nomor transaksi tidak terpakai ulang.
ensureColumn("tx_log", "kasir_edited_at", "TEXT");
ensureColumn("tx_log", "kasir_deleted_at", "TEXT");
ensureColumn("tx_log", "gallery_purged", "INTEGER NOT NULL DEFAULT 0"); // 0 = galeri belum dibersihkan, 1 = sudah / tidak ada

ensureColumn("templates", "price", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("templates", "foreground_url", "TEXT");
ensureColumn("templates", "layers", "TEXT NOT NULL DEFAULT '[]'");
// Pengaturan kanvas ala dslrBooth: ukuran kertas dipilih DULU saat bikin template
ensureColumn("templates", "background_color", "TEXT NOT NULL DEFAULT '#ffffff'");
ensureColumn("templates", "paper_size", "TEXT NOT NULL DEFAULT 'custom'");
ensureColumn("templates", "orientation", "TEXT NOT NULL DEFAULT 'portrait'");
ensureColumn("templates", "dpi", "INTEGER NOT NULL DEFAULT 300");

// Voucher: siapa yang bikin, dari mana (kasir / API aplikasi kasir), catatan/nomor struk,
// masa berlaku, kapan dipakai, dan status dibatalkan.
ensureColumn("vouchers", "created_by", "TEXT");
ensureColumn("vouchers", "source", "TEXT NOT NULL DEFAULT 'cashier'");
ensureColumn("vouchers", "note", "TEXT");
ensureColumn("vouchers", "reference", "TEXT");
ensureColumn("vouchers", "expires_at", "TEXT");
ensureColumn("vouchers", "used_at", "TEXT");
ensureColumn("vouchers", "voided", "INTEGER NOT NULL DEFAULT 0");
// Batas pemakaian per voucher: max_uses 0 = tak terbatas, default 1 (perilaku lama). use_count = sudah dipakai berapa kali.
ensureColumn("vouchers", "max_uses", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("vouchers", "use_count", "INTEGER NOT NULL DEFAULT 0");
// Voucher lama yang sudah terpakai -> use_count 1 (aman dijalankan berulang)
db.exec("UPDATE vouchers SET use_count = 1 WHERE used = 1 AND use_count = 0");

// Stiker (Editor > Add sticker): gambar unggahan admin, bisa dikelompokkan per kategori.
// category_id NULL = "Tanpa kategori" (kategori dihapus -> stikernya tidak ikut terhapus).
db.exec(`CREATE TABLE IF NOT EXISTS sticker_categories (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
)`);
db.exec(`CREATE TABLE IF NOT EXISTS stickers (
  id TEXT PRIMARY KEY,
  category_id TEXT,
  name TEXT NOT NULL DEFAULT '',
  file TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

// Kategori template: bisa ditambah/diubah/dihapus admin (Template Editor > Kategori > Kelola).
// Diisi 4 kategori awal kalau tabel masih kosong; kategori yang sudah dipakai template lama ikut didaftarkan.
db.exec(`CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
)`);
if (db.prepare("SELECT COUNT(*) c FROM categories").get().c === 0) {
  const seed = db.prepare("INSERT INTO categories (id, label, sort) VALUES (?, ?, ?)");
  [["strip2", "2 Photo Strips"], ["print4r", "1 4R"], ["custom", "Custom"], ["personalize", "Personalize Template"]]
    .forEach(([id, label], i) => seed.run(id, label, i));
}
// Ikon kartu: null = ikon bawaan | "preset:<nama>" = ikon dari galeri | "upload:/uploads/<file>" = gambar unggahan admin
// Keterangan di pil krem di samping judul kategori (layar daftar template). Kosong = pil krem tidak ditampilkan.
// Kolom baru -> kategori bawaan "2 Photo Strips" diisi sekali dengan teks yang dulu tertulis permanen di aplikasi.
const hadSubtitle = db.prepare("PRAGMA table_info(categories)").all().some((c) => c.name === "subtitle");
ensureColumn("categories", "subtitle", "TEXT");
if (!hadSubtitle) db.prepare("UPDATE categories SET subtitle = ? WHERE id = 'strip2' AND subtitle IS NULL").run("you will get 2× photo strips");
ensureColumn("categories", "icon", "TEXT");
ensureColumn("categories", "icon_white", "INTEGER NOT NULL DEFAULT 1"); // 1 = gambar unggahan dijadikan siluet putih
for (const r of db.prepare("SELECT DISTINCT category FROM templates WHERE category NOT IN (SELECT id FROM categories)").all()) {
  db.prepare("INSERT INTO categories (id, label, sort) VALUES (?, ?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM categories))").run(r.category, r.category);
}

// Favorit template (bintang di Template Editor): dipakai kalau layar booth diatur "pilih dari favorit"
ensureColumn("templates", "favorite", "INTEGER NOT NULL DEFAULT 0");
// Mode booth: photo | gif | boomerang | video, plus file GIF (dari mode foto) & video
ensureColumn("sessions", "mode", "TEXT NOT NULL DEFAULT 'photo'");
ensureColumn("sessions", "gif_path", "TEXT");
ensureColumn("sessions", "video_path", "TEXT");
ensureColumn("sessions", "share_token", "TEXT");          // token acak untuk halaman unduh /s/<token>
ensureColumn("templates", "animated", "INTEGER NOT NULL DEFAULT 0"); // 1 = template animasi (GIF gerak + klip per foto)
db.exec(`
  CREATE TABLE IF NOT EXISTS session_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    idx INTEGER NOT NULL DEFAULT 0,
    path TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_session_files_session ON session_files(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_share ON sessions(share_token);
`);

// Hak akses pengguna: permissions = NULL berarti "ikuti default peran"; isi JSON = hak khusus akun ini.
// active = 0 -> akun dinonaktifkan. token_version naik tiap password diganti / akun dinonaktifkan
// sehingga semua token lama otomatis tidak berlaku.
ensureColumn("users", "permissions", "TEXT");
ensureColumn("users", "active", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("users", "token_version", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("users", "last_login_at", "TEXT");

// Migrasi: instalasi lama hanya punya 'admin' & 'cashier'. Akun admin PERTAMA (pembuat setup)
// dijadikan Super Admin supaya selalu ada yang bisa mengatur hak akses.
if (db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'superadmin'").get().c === 0) {
  const first = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at, rowid LIMIT 1").get();
  if (first) {
    db.prepare("UPDATE users SET role = 'superadmin' WHERE id = ?").run(first.id);
    console.log("[db migrate] Akun admin pertama dijadikan Super Admin");
  }
}

// Log aktivitas (append-only): siapa melakukan apa dan kapan. Tidak ada endpoint untuk mengubah / menghapus;
// baris lama dibersihkan otomatis oleh activity.js sesuai masa simpan.
db.exec(`
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    user_id TEXT,
    username TEXT,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    ip TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_activity_at ON activity_log (at);
  CREATE INDEX IF NOT EXISTS idx_activity_action ON activity_log (action);
`);

// Pengaturan aplikasi (1 baris JSON): pembayaran, event, kamera, timer sesi, kunci API kasir
db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Pastikan ada 1 baris store_settings dengan store_id unik (dibuat sekali,
// dipakai buat identifikasi toko ini kalau nanti lapor ke server pusat)
const { randomUUID } = require("crypto");
const existingSettings = db.prepare("SELECT * FROM store_settings WHERE id = 1").get();
if (!existingSettings) {
  db.prepare("INSERT INTO store_settings (id, store_name, store_id) VALUES (1, ?, ?)").run("Toko Belum Diberi Nama", randomUUID());
}

// ----------------------------------------------------------
// Migrasi DATA (bukan cuma kolom): template lama yang dibuat sebelum
// sistem layer bebas ada (cuma punya background_url/foreground_url/slots
// terpisah) otomatis "dirakit ulang" jadi format `layers` yang baru,
// supaya template lama gak hilang/rusak dan tetap kepakai di sistem baru.
// ----------------------------------------------------------
function migrateOldTemplatesToLayers() {
  const rows = db.prepare("SELECT * FROM templates WHERE layers = '[]'").all();
  for (const row of rows) {
    const layers = [];
    if (row.background_url) {
      layers.push({
        id: `legacy-bg-${row.id}`,
        type: "image",
        imageUrl: row.background_url,
        xPct: 0, yPct: 0, widthPct: 100, heightPct: 100, rotation: 0,
      });
    }
    try {
      const oldSlots = JSON.parse(row.slots || "[]");
      for (const slot of oldSlots) {
        layers.push({
          id: slot.id || `legacy-slot-${row.id}-${slot.order}`,
          type: "photo-slot",
          photoOrder: slot.order,
          shapeKind: slot.shape || "rectangle",
          xPct: slot.xPct, yPct: slot.yPct, widthPct: slot.widthPct, heightPct: slot.heightPct,
          rotation: slot.rotation || 0,
        });
      }
    } catch {
      // slots lama gagal diparse — lewati, template tetap jalan tanpa slot foto (bisa ditambah manual di editor)
    }
    if (row.foreground_url) {
      layers.push({
        id: `legacy-fg-${row.id}`,
        type: "image",
        imageUrl: row.foreground_url,
        xPct: 0, yPct: 0, widthPct: 100, heightPct: 100, rotation: 0,
      });
    }
    if (layers.length > 0) {
      db.prepare("UPDATE templates SET layers = ? WHERE id = ?").run(JSON.stringify(layers), row.id);
      console.log(`[db migrate] Template "${row.name}" dirakit ulang jadi ${layers.length} layer`);
    }
  }
}
migrateOldTemplatesToLayers();

module.exports = db;
