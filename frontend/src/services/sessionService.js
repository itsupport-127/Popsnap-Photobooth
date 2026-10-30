// ==========================================================
// Session Service — SEMUA lewat backend lokal.
//
// Sebelumnya ada mode "simulasi" yang tidak mengunggah apa pun dan mengembalikan link download palsu
// kalau VITE_SIMULATE_PAYMENT tidak diisi "false" — akibatnya arsip & QR download tidak pernah benar-benar jalan.
// Simulasi dihapus: unggah selalu ke backend.
// ==========================================================

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

/** Balik horizontal satu foto (dataURL/alamat) -> dataURL JPEG. Gagal -> kembalikan aslinya. */
async function flipShot(src) {
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.translate(c.width, 0); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0);
    return c.toDataURL("image/jpeg", 0.95);
  } catch { return src; }
}

/** Kirim hasil sesi FOTO (gambar akhir + semua foto mentah). Mengembalikan { downloadUrl, sessionId, uploadKey }. */
export async function uploadSession(session) {
  // Foto mentah ikut pilihan tamu: kalau memilih Mirror, file mentah yang diunduh juga terbalik seperti yang mereka lihat
  const shots = session.editorState?.mirror ? await Promise.all(session.shots.map(flipShot)) : session.shots;
  const res = await fetch(`${API_BASE}/api/session/finish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: session.sessionId,
      templateId: session.selectedTemplate?.id,
      paymentMethod: session.paymentMethod,
      finalImage: session.finalImage,
      socialConsent: Number.isInteger(session.socialConsent) ? session.socialConsent : undefined, // izin foto (layar Izin Foto): 1 sosmed, 2 mading, 3 keduanya, 0 tidak
      shots,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Gagal mengunggah hasil sesi.");
  return data;
}

/**
 * Unggah GIF / boomerang / video (isi mentah). Tanpa `sessionId` = sesi baru (mode GIF/Boomerang/Video).
 * Dengan sessionId + uploadKey = tambahan GIF untuk sesi foto.
 */
export async function uploadMedia(blob, kind, { sessionId, uploadKey, paymentMethod, orderNo, social } = {}) {
  const qs = new URLSearchParams({ kind });
  if (sessionId) { qs.set("sessionId", sessionId); qs.set("key", uploadKey ?? ""); }
  if (paymentMethod) qs.set("paymentMethod", paymentMethod);
  if (Number.isInteger(social)) qs.set("social", String(social));
  if (orderNo) qs.set("orderNo", orderNo); // nomor transaksi (QRIS/voucher) supaya sesi ini terhubung ke riwayat kasir
  const res = await fetch(`${API_BASE}/api/session/media?${qs}`, {
    method: "POST",
    headers: { "Content-Type": blob.type.split(";")[0] },
    body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Gagal mengunggah media.");
  return data;
}

/** Unggah klip mentah satu foto (Template Animasi). n = nomor foto mulai 1. */
export async function uploadClip(blob, { sessionId, uploadKey, n }) {
  const qs = new URLSearchParams({ sessionId, key: uploadKey ?? "", n: String(n) });
  const res = await fetch(`${API_BASE}/api/session/clip?${qs}`, {
    method: "POST",
    headers: { "Content-Type": blob.type.split(";")[0] },
    body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Gagal mengunggah klip.");
  return data;
}

/** Unggah video "Live" template (MP4 tidak didukung browser -> GIF bergerak). Disimpan sebagai klip nomor 0. */
export async function uploadLive(blob, { sessionId, uploadKey }, extra = null) {
  const qs = new URLSearchParams({ sessionId, key: uploadKey ?? "", ...(extra ? { extra } : { live: "1" }) });
  const res = await fetch(`${API_BASE}/api/session/clip?${qs}`, { method: "POST", headers: { "Content-Type": blob.type.split(";")[0] }, body: blob });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Gagal mengunggah video Live.");
  return data;
}
