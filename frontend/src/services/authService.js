// ==========================================================
// Auth Service — login lokal per toko (admin & kasir)
// ==========================================================

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
const TOKEN_KEY = "popsnap_auth_token";
const USER_KEY = "popsnap_auth_user";

export async function getAuthStatus() {
  const res = await fetch(`${API_BASE}/api/auth/status`);
  return res.json(); // { needsSetup, storeName }
}

export async function setupFirstAdmin({ username, password, storeName }) {
  const res = await fetch(`${API_BASE}/api/auth/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, storeName }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Gagal setup akun.");
  const data = await res.json();
  saveSession(data.token, data.user);
  return data.user;
}

export async function login(username, password) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Login gagal.");
  const data = await res.json();
  saveSession(data.token, data.user);
  return data.user;
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

/** Header siap pakai buat fetch() ke endpoint yang butuh login */
export function authHeader() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/**
 * Dipanggil di service lain setelah fetch(). 401 = sesi tidak berlaku (token habis, akun dinonaktifkan
 * atau password diganti) -> paksa keluar. 403 = login valid tetapi AKUN TIDAK PUNYA HAK untuk aksi itu;
 * itu BUKAN alasan logout, jadi dibiarkan lewat dan service menampilkan pesan error dari server.
 */
export function handleAuthError(status) {
  if (status === 401) {
    logout();
    window.location.reload();
    return true;
  }
  return false;
}

/** Catat logout ke log aktivitas (dipanggil SEBELUM token dihapus). Gagal mencatat tidak menghalangi logout. */
export async function recordLogout() {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, { method: "POST", headers: authHeader() });
  } catch { /* abaikan */ }
}

/** Cek hak akses akun (hasil efektif dari server; Super Admin selalu punya semua). */
export function can(user, ...perms) {
  if (!user?.permissions) return false;
  return perms.length === 0 || perms.some((p) => user.permissions.includes(p));
}

async function call(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...authHeader() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (handleAuthError(res.status)) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Permintaan gagal (${res.status})`);
  return data;
}

/** Ambil data akun TERBARU (hak akses bisa berubah kapan saja) dan simpan ke sesi lokal. */
export async function refreshMe() {
  const data = await call("/api/auth/me");
  if (!data) return null;
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data.user;
}

/** Ganti username / password akun sendiri. Token baru otomatis disimpan. */
export async function updateMyAccount({ currentPassword, username, newPassword }) {
  const data = await call("/api/auth/me", { method: "PUT", body: { currentPassword, username, newPassword } });
  saveSession(data.token, data.user);
  return data.user;
}

export const getPermissionCatalog = () => call("/api/auth/catalog");
export const saveRoleDefaults = (roleDefaults) => call("/api/auth/roles", { method: "PUT", body: roleDefaults });
export const listUsers = () => call("/api/auth/users");
export const createUser = (data) => call("/api/auth/users", { method: "POST", body: data });
export const updateUser = (id, data) => call(`/api/auth/users/${id}`, { method: "PUT", body: data });
export const deleteUser = (id) => call(`/api/auth/users/${id}`, { method: "DELETE" });
