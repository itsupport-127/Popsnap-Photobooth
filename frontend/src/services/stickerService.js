// Stiker (Editor > Add sticker). Daftar publik dipakai booth; unggah/ubah/hapus butuh login admin (hak "Edit template").
import { authHeader, handleAuthError } from "./authService";
import { DEFAULT_STICKERS } from "../utils/defaultStickers";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

/** { categories:[{id,label,count}], uncategorized, stickers:[{id,categoryId,name,url,width,height}], builtin } */
export async function listStickers() {
  try {
    const res = await fetch(`${API_BASE}/api/stickers`);
    if (!res.ok) throw new Error("backend unavailable");
    const data = await res.json();
    if (data.stickers?.length) return { ...data, builtin: false };
  } catch { /* backend mati -> pakai stiker bawaan */ }
  return { categories: [], uncategorized: 0, stickers: DEFAULT_STICKERS, builtin: true };
}

async function call(path, method, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { ...authHeader(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (handleAuthError(res.status)) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Gagal menyimpan stiker.");
  return data;
}

/** Daftar untuk halaman admin (tanpa stiker bawaan). */
export async function adminListStickers() {
  const res = await fetch(`${API_BASE}/api/stickers`);
  if (!res.ok) throw new Error("Backend tidak bisa dihubungi.");
  return res.json();
}
export async function uploadStickers(files, categoryId) {
  const form = new FormData();
  if (categoryId) form.append("categoryId", categoryId);
  [...files].forEach((f) => form.append("images", f));
  const res = await fetch(`${API_BASE}/api/stickers`, { method: "POST", headers: authHeader(), body: form });
  if (handleAuthError(res.status)) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Gagal mengunggah stiker.");
  return data;
}
export const updateSticker = (id, patch) => call(`/api/stickers/${encodeURIComponent(id)}`, "PUT", patch);
export const deleteSticker = (id) => call(`/api/stickers/${encodeURIComponent(id)}`, "DELETE");
export const createStickerCategory = (label) => call("/api/sticker-categories", "POST", { label });
export const renameStickerCategory = (id, label) => call(`/api/sticker-categories/${encodeURIComponent(id)}`, "PUT", { label });
export const deleteStickerCategory = (id) => call(`/api/sticker-categories/${encodeURIComponent(id)}`, "DELETE");
