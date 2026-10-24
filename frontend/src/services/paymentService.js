// ==========================================================
// Payment Service — SEMUA lewat backend lokal.
//
// Sebelumnya ada mode "simulasi" di sisi frontend yang menerima voucher apa pun
// (>= 4 karakter) dan melunasi QRIS otomatis. Itu dihapus supaya booth produksi
// tidak bisa dipakai gratis. Simulasi QRIS (khusus testing) sekarang hanya bisa
// dinyalakan sengaja dari Admin > Pembayaran.
// ==========================================================

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

/** Mode foto: kirim templateId. Mode GIF/Boomerang/Video: kirim mode (harga diambil server dari pengaturan). */
export async function createQrisPayment({ templateId, mode }) {
  const res = await fetch(`${API_BASE}/api/payment/qris`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mode && mode !== "photo" ? { mode } : { templateId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Gagal membuat QRIS.");
  return data; // { orderId, qrImageUrl | qrString, amount }
}

export async function checkPaymentStatus(orderId) {
  try {
    const res = await fetch(`${API_BASE}/api/payment/status/${orderId}`);
    const data = await res.json();
    return data.status; // "pending" | "paid" | "expired"
  } catch {
    return "pending"; // koneksi putus sesaat: tetap polling
  }
}

/** @returns {Promise<{valid: boolean, reason?: string, orderNo?: string|null}>} orderNo = nomor transaksi (sama dengan di aplikasi kasir) */
export async function validateVoucher(code, { templateId, mode } = {}) {
  try {
    const res = await fetch(`${API_BASE}/api/voucher/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, templateId, mode }),
    });
    const data = await res.json();
    return { valid: data.valid === true, reason: data.reason, orderNo: data.orderNo || null };
  } catch {
    return { valid: false, reason: "Tidak bisa terhubung ke sistem booth. Hubungi kasir." };
  }
}
