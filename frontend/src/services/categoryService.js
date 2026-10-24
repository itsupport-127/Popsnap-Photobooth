// Kategori template (bisa ditambah admin). Daftar publik dipakai layar kiosk; ubah-ubah butuh login admin.
import appConfig from "../config/appConfig";
import { authHeader, handleAuthError } from "./authService";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

/** Daftar kategori [{id,label,count}]. Backend mati -> pakai kategori bawaan supaya kiosk tetap jalan. */
export async function listCategories() {
  try {
    const res = await fetch(`${API_BASE}/api/categories`);
    if (!res.ok) throw new Error("backend unavailable");
    return await res.json();
  } catch {
    return appConfig.templateCategories.map((c) => ({ ...c, count: 0 }));
  }
}

async function call(path, method, body) {
  const res = await fetch(`${API_BASE}/api/categories${path}`, {
    method,
    headers: { ...authHeader(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (handleAuthError(res.status)) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Gagal menyimpan kategori.");
  return data;
}

export const createCategory = (label) => call("", "POST", { label });
export const renameCategory = (id, label) => call(`/${encodeURIComponent(id)}`, "PUT", { label });
/** Ubah sebagian: { label?, icon?: "preset:xxx" | null, iconWhite?: boolean } */
export const updateCategory = (id, patch) => call(`/${encodeURIComponent(id)}`, "PUT", patch);
export async function uploadCategoryIcon(id, file) {
  const form = new FormData();
  form.append("image", file);
  const res = await fetch(`${API_BASE}/api/categories/${encodeURIComponent(id)}/icon`, { method: "POST", headers: authHeader(), body: form });
  if (handleAuthError(res.status)) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Gagal mengunggah ikon.");
  return data;
}
export const deleteCategory = (id) => call(`/${encodeURIComponent(id)}`, "DELETE");
export const reorderCategories = (ids) => call("/order", "PUT", { ids });
