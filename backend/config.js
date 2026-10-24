// ==========================================================
// Konfigurasi backend. Samain angka penting dengan
// frontend/src/config/appConfig.js supaya konsisten.
// ==========================================================
require("dotenv").config();
// .env di folder data (aplikasi .exe: %AppData%\POPSNAP\.env) ikut dibaca, tidak menimpa nilai yang sudah ada
require("dotenv").config({ path: require("path").join(process.env.POPSNAP_DATA || __dirname, ".env") });
const os = require("os");

// Deteksi otomatis alamat IP lokal PC ini di jaringan WiFi (bukan "localhost").
// PENTING: ini dipakai buat generate URL gambar template & link download QR.
// Kalau pakai "localhost", HP konsumen yang scan QR gak akan pernah bisa buka
// link-nya (localhost di HP mereka nunjuk ke HP itu sendiri, bukan PC booth).
function detectLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost"; // fallback kalau gagal deteksi (misal gak ada WiFi/LAN aktif)
}

// Folder DATA (database, upload sementara, kunci login). Bawaan: folder backend. Aplikasi .exe mengisi POPSNAP_DATA ke folder
// AppData milik pengguna, karena folder program (Program Files) tidak boleh ditulisi.
const dataDir = process.env.POPSNAP_DATA || __dirname;
require("fs").mkdirSync(require("path").join(dataDir, "uploads"), { recursive: true });

module.exports = {
  dataDir,
  port: process.env.PORT || 4000,
  fileRetentionDays: 7, // ubah sesuai kebutuhan — dipakai buat auto-hapus file lama DI FOLDER UPLOADS (yang dipakai QR)

  // Folder ARSIP PERMANEN — beda dari folder "uploads" (yang isinya sementara,
  // buat dilayani lewat link QR dan otomatis kehapus sesuai fileRetentionDays).
  // Folder ini TIDAK PERNAH auto-dihapus, isinya hasil final tiap sesi + semua
  // foto mentah hasil jepretan, dikelompokkan per tanggal, supaya bisa kamu buka
  // langsung lewat File Explorer kapan saja tanpa perlu app kebuka.
  // Default: folder "output" di dalam project. Ganti ke path manapun kamu mau,
  // misal Desktop\POPSNAP-Photos, lewat OUTPUT_DIR di .env.
  outputDir: process.env.OUTPUT_DIR || require("path").join(dataDir, "output"),

  // --- Sync ke server pusat (opsional) ---
  // Kalau diisi, backend ini bakal kirim ringkasan data (jumlah sesi, omzet,
  // nama toko) ke server pusat tiap beberapa menit—BUKAN data foto/pribadi
  // konsumen, cuma angka ringkasan buat monitoring. Kosongkan kalau toko ini
  // berdiri sendiri / belum ada server pusat yang di-deploy.
  cloudSyncUrl: process.env.CLOUD_SYNC_URL || null,
  cloudSyncApiKey: process.env.CLOUD_SYNC_API_KEY || null,

  // Alamat yang dipakai di URL publik (gambar template, link download QR).
  // Auto-detect IP LAN PC ini; override manual lewat PUBLIC_HOST di .env
  // kalau auto-detect salah pilih network interface (misal PC punya banyak
  // kartu jaringan sekaligus).
  publicHost: process.env.PUBLIC_HOST || detectLanIp(),

  // --- Midtrans QRIS ---
  // Isi MIDTRANS_SERVER_KEY di file .env untuk aktifkan pembayaran asli.
  // Kalau kosong, backend otomatis fallback ke mode stub/simulasi supaya
  // tidak crash walau belum setup akun Midtrans.
  midtrans: {
    serverKey: process.env.MIDTRANS_SERVER_KEY || null,
    clientKey: process.env.MIDTRANS_CLIENT_KEY || null,
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === "true",
  },
};
