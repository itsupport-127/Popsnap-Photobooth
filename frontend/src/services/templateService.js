// ==========================================================
// Template Service
// Ambil/simpan data template (termasuk seluruh layer & posisinya) dari
// backend lokal. Kalau backend belum jalan, fallback ke localStorage
// supaya Admin tool tetap bisa dicoba-coba.
// ==========================================================
import { authHeader, handleAuthError } from "./authService";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
const LOCAL_KEY = "popsnap_templates_fallback";

export async function listTemplates() {
  try {
    const res = await fetch(`${API_BASE}/api/templates`);
    if (!res.ok) throw new Error("backend unavailable");
    return await res.json();
  } catch {
    return loadLocalFallback();
  }
}

// Bikin template baru ala dslrBooth: ukuran kanvas (px) dipilih DULU.
// Gambar awal OPSIONAL (dipasang sebagai layer paling belakang).
export async function createTemplate({ name, category, price = 0, canvasWidth, canvasHeight, paperSize, orientation, dpi, backgroundColor, initialImageFile, imported }) {
  const form = new FormData();
  if (initialImageFile) form.append("initialImage", initialImageFile);
  form.append("name", name || "Template Baru");
  form.append("category", category);
  form.append("price", price);
  form.append("canvasWidth", canvasWidth);
  form.append("canvasHeight", canvasHeight);
  form.append("paperSize", paperSize);
  form.append("orientation", orientation);
  form.append("dpi", dpi);
  form.append("backgroundColor", backgroundColor || "#ffffff");
  if (imported) form.append("imported", "1");
  const res = await fetch(`${API_BASE}/api/templates`, { method: "POST", headers: authHeader(), body: form });
  if (handleAuthError(res.status)) return;
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Gagal membuat template.");
  return res.json();
}

// Upload gambar tambahan (dekorasi/sticker) buat dipakai sebagai layer "image" baru
export async function uploadTemplateAsset(templateId, file) {
  try {
    const form = new FormData();
    form.append("image", file);
    const res = await fetch(`${API_BASE}/api/templates/${templateId}/assets`, { method: "POST", headers: authHeader(), body: form });
    if (handleAuthError(res.status)) return;
    if (!res.ok) throw new Error("backend unavailable");
    return await res.json(); // { url, fullUrl }
  } catch {
    const url = URL.createObjectURL(file);
    return { url, fullUrl: url };
  }
}

// Simpan SEMUA yang berubah di editor: layer + pengaturan kanvas + harga + nama.
export async function saveTemplate(templateId, data) {
  const res = await fetch(`${API_BASE}/api/templates/${templateId}/layers`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(data),
  });
  if (handleAuthError(res.status)) return;
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Gagal menyimpan template.");
  return res.json();
}

export async function cleanupOrphanedFiles() {
  const res = await fetch(`${API_BASE}/api/templates/cleanup-orphaned-files`, {
    method: "POST",
    headers: authHeader(),
  });
  if (handleAuthError(res.status)) return;
  if (!res.ok) throw new Error((await res.json()).error || "Gagal bersihin file.");
  return res.json(); // { ok, deletedCount }
}

export async function deleteTemplate(templateId) {
  const res = await fetch(`${API_BASE}/api/templates/${templateId}`, {
    method: "DELETE",
    headers: authHeader(),
  });
  if (handleAuthError(res.status)) return;
  if (!res.ok) throw new Error((await res.json()).error || "Gagal hapus template.");
  return res.json();
}

export async function updateCanvasSize(templateId, canvasWidth, canvasHeight) {
  const res = await fetch(`${API_BASE}/api/templates/${templateId}/canvas-size`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ canvasWidth, canvasHeight }),
  });
  if (handleAuthError(res.status)) return;
  if (!res.ok) throw new Error((await res.json()).error || "Gagal update ukuran kanvas.");
  return res.json();
}

export async function listTemplatesByCategory() {
  const templates = await listTemplates();
  const grouped = { strip2: [], print4r: [], custom: [], personalize: [] };
  for (const t of templates) {
    if (!grouped[t.category]) grouped[t.category] = [];
    grouped[t.category].push(t);
  }
  return grouped;
}

function loadLocalFallback() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY)) ?? [];
  } catch {
    return [];
  }
}

function saveLocalFallback(templates) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(templates));
}

/** Tandai / lepas template sebagai favorit (bintang). Mengembalikan status terbaru. */
export async function setTemplateFavorite(templateId, favorite) {
  const res = await fetch(`${API_BASE}/api/templates/${templateId}/favorite`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ favorite }),
  });
  if (handleAuthError(res.status)) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Gagal mengubah favorit.");
  return data.favorite;
}

/** Catat aksi di sisi browser (ekspor / cetak tes) ke log aktivitas. Gagal mencatat tidak mengganggu pengguna. */
export function auditTemplate(templateId, action) {
  fetch(`${API_BASE}/api/templates/${templateId}/audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ action }),
  }).catch(() => {});
}

/** Nyalakan / matikan "Template animasi" (klip live per foto) untuk satu template. Mengembalikan status terbaru. */
export async function setTemplateAnimated(templateId, animated) {
  const res = await fetch(`${API_BASE}/api/templates/${templateId}/animated`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ animated }),
  });
  if (handleAuthError(res.status)) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Gagal mengubah template animasi.");
  return data.animated;
}
