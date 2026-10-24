// ==========================================================
// POPSNAP — Konfigurasi utama aplikasi
// Semua angka yang bisa berubah (timer, batas retake, dll)
// dikumpulkan di sini supaya gampang diubah tanpa oprek logic.
// ==========================================================

const appConfig = {
  // --- Timers (dalam detik) ---
  timers: {
    payment: 45,          // batas waktu pembayaran (QRIS/voucher)
    photoSession: 240,     // 4 menit sesi foto
    photoSessionExtend: 60, // tambahan waktu saat "waktu habis"
    editor: 180,           // 3 menit di halaman editor/template
    downloadQr: 120,        // 2 menit tampil barcode download
  },

  // --- Aturan sesi foto ---
  photoSession: {
    totalShots: 8,     // total foto per sesi
    maxRetakes: 5,     // batas retake keseluruhan sesi
  },

  // --- Retensi file (berapa lama foto bisa didownload) ---
  // Ubah nilai ini kapan saja. Satuan: hari.
  fileRetentionDays: 7,

  // --- Kategori template ---
  templateCategories: [
    { id: "strip2", label: "2 Photo Strips", subtitle: "you will get 2× photo strips" },
    { id: "print4r", label: "1 4R" },
    { id: "custom", label: "Custom" },
    { id: "personalize", label: "Personalize Template" },
  ],

  // --- Metode pembayaran ---
  paymentMethods: [
    { id: "qris", label: "QRIS" },
    { id: "voucher", label: "Voucher" },
  ],

  // --- Orientasi kamera yang didukung ---
  cameraOrientations: ["portrait", "landscape"],

  // --- Mode kamera: 'webcam' (browser getUserMedia) atau 'dslr' (via jembatan Electron) ---
  cameraMode: "webcam",
};

export default appConfig;
