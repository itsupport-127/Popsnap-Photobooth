// ==========================================================
// clipStore — tempat penampungan klip "live" per foto selama satu sesi (hanya di memori browser).
//   clips[n] = { frames: [{ t, blob }], shutterT, fps }   n = nomor foto di session.shots (0 = foto pertama)
// Klip baru selesai terkumpul beberapa detik SETELAH jepretan (merekam reaksi), jadi ada penghitung "pending"
// dan whenReady() supaya layar hasil menunggu klip terakhir.
// ==========================================================
const clips = new Map();
let pending = 0;
let waiters = [];

export const putClip = (index, clip) => { clips.set(index, clip); };
export const getClip = (index) => clips.get(index) ?? null;
export const hasClips = () => clips.size > 0;
export const clearClips = () => { clips.clear(); };
export const beginPending = () => { pending++; };
export const endPending = () => {
  pending = Math.max(0, pending - 1);
  if (pending === 0) { const w = waiters; waiters = []; w.forEach((f) => f()); }
};
/** Tunggu semua klip yang masih merekam "setelah jepret" selesai (batas waktu supaya tidak menggantung). */
export const whenClipsReady = (timeoutMs = 8000) =>
  pending === 0 ? Promise.resolve() : new Promise((res) => { const t = setTimeout(res, timeoutMs); waiters.push(() => { clearTimeout(t); res(); }); });
