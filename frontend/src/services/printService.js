import appConfig from "../config/appConfig";
import { API_BASE } from "./settingsService";

// Cetak ke printer Windows lewat aplikasi desktop (Electron). Di browser biasa tidak ada akses printer -> fallback dialog cetak browser.
const el = () => (typeof window !== "undefined" ? window.electronAPI?.print : null);
export const canSilentPrint = () => !!el();
export const printingCfg = () => appConfig.settings?.printing ?? null;

export async function listPrinters() {
  const p = el();
  if (!p) return { ok: false, error: "Daftar printer hanya tersedia di aplikasi desktop POPSNAP (.exe).", printers: [] };
  return p.list();
}
export const addSharedPrinter = (unc) => (el() ? el().addShare(unc) : Promise.resolve({ ok: false, error: "Hanya di aplikasi desktop." }));

const unitOf = (u) => ({ printer: u.name || "", scale: u.scale, x: u.x, y: u.y });

export async function printTestPage(cfg, which = "main") {
  const p = el();
  if (!p) return { ok: false, error: "Cetak tes hanya di aplikasi desktop POPSNAP (.exe)." };
  return p.test(unitOf(cfg[which]));
}

// Printer berikutnya untuk cetak bergantian (printer utama & kedua)
let flip = 0;
function pickUnit(cfg, template) {
  const second = cfg.second.name;
  if (cfg.both && second) return flip++ % 2 === 0 ? cfg.main : cfg.second;
  return cfg.main;
}

export async function getQuota(sessionId) {
  try { return await fetch(`${API_BASE}/api/print/quota?sessionId=${encodeURIComponent(sessionId || "")}`).then((r) => r.json()); } catch { return { allowed: 99 }; }
}

/** Cetak hasil akhir. copies = jumlah salinan. Mengembalikan { ok, error? }. Hitungan cetak dicatat di backend (untuk batas per sesi / event). */
export async function printFinal({ dataUrl, sessionId, copies = 1, template }) {
  const cfg = printingCfg();
  if (!cfg?.enabled) return { ok: false, error: "Cetak belum diaktifkan." };
  const q = await getQuota(sessionId);
  if (q.allowed < 1) return { ok: false, error: "Batas cetak tercapai." };
  copies = Math.min(copies, q.allowed);
  const unit = pickUnit(cfg, template);
  const dup = cfg.strip2x6 && (template?.canvasWidth ?? 0) > 0 && (template.canvasHeight / template.canvasWidth) >= 2.5;
  const p = el();
  let r;
  if (p) r = await p.image({ dataUrl, ...unitOf(unit), copies, sharpening: cfg.sharpening, fit: cfg.fit, autorotate: cfg.autorotate, dup });
  else r = browserPrint(dataUrl);
  if (r.ok) {
    fetch(`${API_BASE}/api/print/record`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, copies, printer: unit.name }) }).catch(() => {});
  }
  return r;
}

function browserPrint(dataUrl) {
  const w = window.open("", "_blank", "width=800,height=1000");
  if (!w) return { ok: false, error: "Browser memblokir jendela cetak." };
  w.document.write(`<style>@page{margin:0}html,body{margin:0}img{width:100%;display:block}</style><img src="${dataUrl}" onload="setTimeout(()=>{print();close()},300)">`);
  w.document.close();
  return { ok: true };
}
