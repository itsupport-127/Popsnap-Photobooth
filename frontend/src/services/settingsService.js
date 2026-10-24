import appConfig from "../config/appConfig";
import { setFilters } from "../utils/filters";
import { applyTheme } from "../state/kioskSettings";
import { authHeader, handleAuthError } from "./authService";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

async function request(path, { method = "GET", body, auth = true } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(auth ? authHeader() : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (auth && handleAuthError(res.status)) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.reason || `Permintaan gagal (${res.status})`);
  return data;
}

// ---------- Layar booth (publik) ----------

/** Ambil pengaturan publik & TERAPKAN ke appConfig (timer, jumlah foto, mode kamera) dan tema warna. */
export async function loadRuntimeConfig() {
  const s = await request("/api/settings/public", { auth: false });
  appConfig.timers = { ...appConfig.timers, ...s.session.timers };
  appConfig.photoSession = { totalShots: s.session.totalShots, maxRetakes: s.session.maxRetakes };
  appConfig.cameraMode = s.camera.mode;
  appConfig.settings = s; // dibaca langsung oleh mesin state & hook kamera (bukan lewat React)
  setFilters(s.editor?.filters);
  applyTheme(s.display?.colors);
  return s;
}

export const getPublicSettings = () => request("/api/settings/public", { auth: false });

// ---------- Admin ----------

export const getAdminSettings = () => request("/api/settings");
export const saveAdminSettings = (patch) => request("/api/settings", { method: "PUT", body: patch });
export const setPaymentMode = (mode) => request("/api/settings/payment-mode", { method: "PUT", body: { mode } });
export const regeneratePosApiKey = () => request("/api/settings/pos-api-key/regenerate", { method: "POST" });
export const getCloudStatus = () => request("/api/cloud/status");
export const getCloudTransactions = (limit = 30) => request(`/api/cloud/transactions?limit=${limit}`);
export const testCloud = () => request("/api/cloud/test", { method: "POST" });
export const syncCloudNow = () => request("/api/cloud/sync", { method: "POST" });
export const testDoku = () => request("/api/payment/doku/test", { method: "POST" });
export const getCameraExposure = () => request("/api/camera/exposure");
export const setCameraExposure = (prop, value) => request("/api/camera/exposure", { method: "POST", body: { prop, value } });
export const getGalleryStatus = () => request("/api/gallery/status");
export const testGallery = () => request("/api/gallery/test", { method: "POST" });
export const getGalleryArchive = (days = 14) => request(`/api/gallery/archive?days=${days}`);
export const uploadGalleryArchive = (date, id, redo = false) => request("/api/gallery/archive/upload", { method: "POST", body: { date, id, redo } });
export const syncGalleryNow = () => request("/api/gallery/sync", { method: "POST" });
export const getOverview = () => request("/api/admin/overview");

export const listVouchers = () => request("/api/voucher/list");
// expiryDays: 0 = selamanya | maxUses: 0 = tak terbatas (kosongkan/undefined = ikut default server)
export const generateVouchers = ({ count = 1, note = "", expiryDays, maxUses } = {}) => request("/api/voucher/generate", { method: "POST", body: { count, note, expiryDays, maxUses } });
export const voidVoucher = (code) => request(`/api/voucher/${encodeURIComponent(code)}/void`, { method: "POST" });

export const getActivityMeta = () => request("/api/admin/activity/meta");
export const getActivity = (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "" && v !== null)).toString();
  return request(`/api/admin/activity${qs ? `?${qs}` : ""}`);
};

export async function uploadSettingsAsset(file) {
  const form = new FormData();
  form.append("image", file);
  const res = await fetch(`${API_BASE}/api/settings/upload-asset`, { method: "POST", headers: authHeader(), body: form });
  if (handleAuthError(res.status)) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Gagal mengunggah gambar.");
  return data; // { url, fullUrl }
}
export const testExportDir = (dir) => request("/api/settings/test-export-dir", { method: "POST", body: { dir } });
export async function verifyKioskPin(pin) {
  const res = await fetch(`${API_BASE}/api/kiosk/verify-pin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && data.ok, error: data.error };
}

export const getStoreSettings = () => request("/api/store/settings");
export const saveStoreSettings = (data) => request("/api/store/settings", { method: "PUT", body: data });

export { API_BASE };

// ---------- Pemilih folder (dibaca backend di PC booth) ----------
export const browseFolders = (dir = "") => request(`/api/system/browse?path=${encodeURIComponent(dir)}`);
export const makeFolder = (parent, name) => request("/api/system/mkdir", { method: "POST", body: { parent, name } });
export const pickFolderNative = (start = "") => request("/api/system/pick-folder", { method: "POST", body: { start } });
