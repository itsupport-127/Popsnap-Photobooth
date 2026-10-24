// ==========================================================
// Import / Export / Print Test Copy untuk Template Editor.
//
// Ekspor menghasilkan ZIP dengan struktur SAMA seperti dslrBooth (template.xml + preview.png + gambar), plus
// popsnap.json berisi seluruh layer POPSNAP (foto, teks, bentuk, rotasi...) supaya POPSNAP -> POPSNAP tidak ada yang hilang.
// Impor menerima: ZIP dslrBooth, ZIP hasil ekspor POPSNAP, dan file .popsnap.json lama.
// File impor TIDAK dipercaya: setiap field divalidasi / dibatasi sebelum dipakai.
// ==========================================================
import appConfig from "../config/appConfig";
import { composeImage } from "../utils/composeImage";
import { photoSlotPlan } from "../utils/templatePhotos";
import { PAPERS, DPIS, FONTS } from "./editorKit";
import { readZip, writeZip } from "./zip";
import { buildTemplateXml, importDslrTemplate, sniffImage } from "./dslrTemplate";

const FORMAT = "popsnap-template";
const MAX_FILE_CHARS = 80 * 1024 * 1024; // ~60 MB data asli
const SHAPES = ["rectangle", "rounded", "circle"];

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Gagal membaca gambar."));
    r.readAsDataURL(blob);
  });
}

export function safeFileName(name) {
  return (String(name || "template").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "template").slice(0, 60);
}

const sanitizeName = (n) => String(n || "gambar").replace(/[\\/:*?"<>|\x00-\x1f]+/g, "").trim().slice(0, 80) || "gambar";

export const exportFileName = (meta) => `${sanitizeName(meta.name)}.zip`;

/**
 * Ekspor template jadi ZIP format dslrBooth. Mengembalikan { blob, filename, notes } — notes = hal yang tidak ikut
 * masuk ke template.xml (hanya ada di popsnap.json).
 */
export async function buildZipExport(doc, { favorite = false } = {}) {
  const { meta, layers } = doc;
  const files = [];                                   // [{ name, data }]
  const entries = [];                                 // layer gambar untuk template.xml
  const byUrl = new Map();                            // gambar yang sama dipakai banyak layer (hasil Copy) -> satu file
  const used = new Set(["preview.png", "template.xml", "popsnap.json"]);
  const nativeLayers = [];

  for (const l of layers) {
    const copy = { ...l };
    if (l.type === "image" && l.imageUrl) {
      let fileName = byUrl.get(l.imageUrl);
      if (!fileName) {
        const res = await fetch(l.imageUrl);
        if (!res.ok) throw new Error(`Gambar "${l.name || "layer"}" tidak bisa dibaca (${res.status}).`);
        const data = new Uint8Array(await res.arrayBuffer());
        const ext = (sniffImage(data) || { ext: "png" }).ext;
        let base = sanitizeName(l.fileName || l.name).replace(/\.(png|jpe?g)$/i, "");
        fileName = `${base}.${ext}`;
        for (let n = 2; used.has(fileName.toLowerCase()); n++) fileName = `${base} (${n}).${ext}`;
        used.add(fileName.toLowerCase());
        byUrl.set(l.imageUrl, fileName);
        files.push({ name: fileName, data });
      }
      entries.push({ layer: l, fileName });
      copy.imageFile = fileName;
      delete copy.imageUrl;
    }
    nativeLayers.push(copy);
  }

  const preview = await composeImage({ canvasWidth: meta.canvasWidth, canvasHeight: meta.canvasHeight, layers, photos: [], backgroundColor: meta.backgroundColor });
  const previewBytes = Uint8Array.from(atob(preview.split(",")[1]), (c) => c.charCodeAt(0));
  const enc = new TextEncoder();
  const native = { format: FORMAT, version: 2, exportedAt: new Date().toISOString(), template: { ...meta }, favorite, layers: nativeLayers };

  const ordered = [
    { name: "preview.png", data: previewBytes },
    ...files,
    { name: "template.xml", data: enc.encode(buildTemplateXml({ meta, favorite, entries })) },
    { name: "popsnap.json", data: enc.encode(JSON.stringify(native)) },
  ];

  const notes = [];
  const other = layers.filter((l) => l.type !== "image");
  if (other.length) notes.push(`${other.length} layer non-gambar (foto/teks/bentuk) hanya tersimpan di popsnap.json, tidak di template.xml.`);
  if (layers.some((l) => l.type === "image" && l.rotation)) notes.push("Rotasi layer gambar tidak ditulis ke template.xml.");
  return { blob: writeZip(ordered), filename: exportFileName(meta), notes };
}

export function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const num = (v, min, max, d) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : d);
const color = (v, d) => (typeof v === "string" && (/^#[0-9a-fA-F]{6}$/.test(v) || v === "transparent") ? v : d);
const text = (v, max, d = "") => (typeof v === "string" ? v.slice(0, max) : d);

/** File .popsnap.json (format lama). */
export function parseImport(raw) {
  if (raw.length > MAX_FILE_CHARS) throw new Error("File terlalu besar (maks. ± 60 MB).");
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error("File bukan template POPSNAP yang valid (bukan JSON)."); }
  if (data?.format !== FORMAT || !data.template || !Array.isArray(data.layers)) throw new Error("File ini bukan hasil Export dari Template Editor POPSNAP.");
  return sanitizeImported(data);
}

/**
 * Titik masuk impor: ZIP (dslrBooth atau POPSNAP) atau JSON lama.
 * @returns {{ meta, layers, favorite, report }}
 */
export async function parseImportFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (!isZip) return { ...parseImport(new TextDecoder().decode(buf)), favorite: false, report: [] };

  const files = await readZip(buf);
  const nativeBytes = files.get("popsnap.json");
  if (nativeBytes) {
    // ZIP hasil ekspor POPSNAP: pakai popsnap.json (lengkap); gambar diambil dari file di dalam ZIP
    let data;
    try { data = JSON.parse(new TextDecoder().decode(nativeBytes)); } catch { throw new Error("popsnap.json di dalam ZIP rusak."); }
    if (data?.format !== FORMAT || !data.template || !Array.isArray(data.layers)) throw new Error("popsnap.json di dalam ZIP tidak valid.");
    const layers = [];
    for (const l of data.layers) {
      if (l?.type === "image") {
        const bytes = files.get(String(l.imageFile || ""));
        const sig = bytes && sniffImage(bytes);
        if (!sig) continue; // gambar hilang / bukan PNG-JPEG -> dilewati oleh sanitizer juga
        l.imageData = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(new Blob([bytes], { type: sig.mime })); });
      }
      layers.push(l);
    }
    return { ...sanitizeImported({ template: data.template, layers }), favorite: !!data.favorite, report: [] };
  }

  // ZIP dslrBooth murni
  const parsed = await importDslrTemplate(files);
  const clean = sanitizeImported({ template: parsed.meta, layers: parsed.layers });
  return { ...clean, favorite: parsed.favorite, report: parsed.report };
}

function sanitizeImported(data) {
  if (data.layers.length > 200) throw new Error("Jumlah layer terlalu banyak.");

  const t = data.template;
  const paperSize = PAPERS.some((p) => p.id === t.paperSize) ? t.paperSize : "custom";
  const meta = {
    name: text(t.name, 60, "Template Impor") || "Template Impor",
    category: text(t.category, 40, ""), // kategori tak dikenal di booth ini -> backend memakai kategori pertama
    price: Math.round(num(t.price, 0, 100000000, 0)),
    canvasWidth: Math.round(num(t.canvasWidth, 50, 12000, 1200)),
    canvasHeight: Math.round(num(t.canvasHeight, 50, 12000, 1800)),
    paperSize,
    orientation: t.orientation === "landscape" ? "landscape" : "portrait",
    dpi: DPIS.includes(Number(t.dpi)) ? Number(t.dpi) : 300,
    backgroundColor: color(t.backgroundColor, "#ffffff"),
  };

  const layers = [];
  for (const l of data.layers) {
    if (!l || typeof l !== "object") continue;
    const base = {
      id: crypto.randomUUID(),
      xPct: num(l.xPct, -500, 600, 0), yPct: num(l.yPct, -500, 600, 0),
      widthPct: num(l.widthPct, 0.1, 1000, 20), heightPct: num(l.heightPct, 0.1, 1000, 20),
      rotation: num(l.rotation, -360, 360, 0), opacity: num(l.opacity, 0, 1, 1),
      visible: l.visible !== false, locked: !!l.locked, name: text(l.name, 60) || undefined,
      strokeColor: color(l.strokeColor, "#000000"), strokeWidth: num(l.strokeWidth, 0, 200, 0),
    };
    if (l.shadow && typeof l.shadow === "object") {
      base.shadow = { enabled: !!l.shadow.enabled, color: color(l.shadow.color, "#000000"), angle: num(l.shadow.angle, -180, 180, -45), distance: num(l.shadow.distance, 0, 500, 10), spread: num(l.shadow.spread, 0, 500, 20) };
    }
    if (l.type === "image") {
      // Hanya gambar PNG/JPEG yang ditanam; tautan luar tidak diikuti.
      if (typeof l.imageData !== "string" || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(l.imageData)) continue;
      layers.push({ ...base, type: "image", imageData: l.imageData, fileName: text(l.fileName, 80) || undefined, lockAspect: !!l.lockAspect });
    } else if (l.type === "photo-slot") {
      layers.push({ ...base, type: "photo-slot", photoOrder: Math.round(num(l.photoOrder, 1, 99, 1)), shapeKind: SHAPES.includes(l.shapeKind) ? l.shapeKind : "rectangle" });
    } else if (l.type === "shape") {
      layers.push({ ...base, type: "shape", shapeKind: SHAPES.includes(l.shapeKind) ? l.shapeKind : "rectangle", fillColor: color(l.fillColor, "#ff3e8e") });
    } else if (l.type === "text") {
      layers.push({
        ...base, type: "text", text: text(l.text, 200), fontSize: Math.round(num(l.fontSize, 4, 2000, 48)), color: color(l.color, "#000000"),
        fontFamily: FONTS.includes(l.fontFamily) ? l.fontFamily : "sans-serif", align: ["left", "center", "right"].includes(l.align) ? l.align : "center",
        bold: !!l.bold, italic: !!l.italic,
      });
    }
  }
  return { meta, layers };
}

export async function dataUrlToFile(dataUrl, name) {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], name, { type: blob.type });
}

// ---------- Print Test Copy ----------

function samplePhoto(n) {
  const c = document.createElement("canvas");
  c.width = 1600; c.height = 1067;
  const g = c.getContext("2d");
  const hue = (n * 57) % 360;
  const grad = g.createLinearGradient(0, 0, 1600, 1067);
  grad.addColorStop(0, `hsl(${hue} 70% 62%)`);
  grad.addColorStop(1, `hsl(${(hue + 50) % 360} 70% 38%)`);
  g.fillStyle = grad; g.fillRect(0, 0, 1600, 1067);
  g.fillStyle = "rgba(255,255,255,.22)";
  g.beginPath(); g.arc(800, 430, 190, 0, Math.PI * 2); g.fill();            // kepala
  g.beginPath(); g.ellipse(800, 980, 380, 330, 0, Math.PI, 0); g.fill();   // bahu
  g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = "bold 420px sans-serif"; g.fillText(String(n), 800, 470);
  g.font = "bold 70px sans-serif"; g.fillText(`FOTO ${n}`, 800, 880);
  return c.toDataURL("image/jpeg", 0.9);
}

/** Render template dengan foto contoh lalu buka dialog cetak sesuai ukuran kertas template. */
export async function printTestCopy(doc) {
  const { layers, meta } = doc;
  const plan = photoSlotPlan(layers);
  const dataUrl = await composeImage({
    canvasWidth: meta.canvasWidth, canvasHeight: meta.canvasHeight, layers,
    photos: plan.numbers.map(samplePhoto), backgroundColor: meta.backgroundColor,
  });
  const wIn = (meta.canvasWidth / meta.dpi).toFixed(3), hIn = (meta.canvasHeight / meta.dpi).toFixed(3);

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(iframe);
  const d = iframe.contentDocument;
  d.open();
  d.write(`<!doctype html><html><head><title>Print Test Copy</title><style>@page{size:${wIn}in ${hIn}in;margin:0}html,body{margin:0;padding:0}img{display:block;width:${wIn}in;height:${hIn}in}</style></head><body><img id="i" src="${dataUrl}"></body></html>`);
  d.close();
  await new Promise((resolve) => {
    const img = d.getElementById("i");
    if (img.complete) resolve(); else { img.onload = resolve; img.onerror = resolve; }
  });
  iframe.contentWindow.focus();
  iframe.contentWindow.print();
  setTimeout(() => iframe.remove(), 60000);
  return dataUrl;
}
