// ==========================================================
// Format template dslrBooth (file .zip hasil "Export" di Template Editor dslrBooth):
//
//   preview.png            gambar pratinjau template (ukuran kanvas)
//   <nama gambar>.png      gambar-gambar yang dipakai layer Image
//   template.xml           (UTF-8 + BOM, CRLF)
//       <Template Name IsFavorite Width Height Dimensions Resolution BackgroundColor(#AARRGGBB)
//                 print_2_per_page PrintToSecondaryPrinter LastSavedDate="MM/dd/yyyy HH:mm:ss">
//         <Elements>
//           <Image Name Opacity(0-100) ShadowEnabled ShadowColor ShadowDepth ShadowRadius ShadowDirection
//                  Width Height Top Left (piksel kanvas) ImagePath KeepAspect Thickness StrokeColor ZIndex />
//
// DIVERIFIKASI dari contoh file asli: atribut template + elemen <Image>.
// BELUM ada contoh untuk Photo / Text / Shape / rotasi, jadi impornya memakai tebakan (ditandai di laporan impor),
// dan ekspor TIDAK menulis elemen itu ke template.xml (supaya dslrBooth tidak salah baca). Seluruh layer POPSNAP
// disimpan utuh di popsnap.json di dalam ZIP yang sama, sehingga POPSNAP -> POPSNAP tidak kehilangan apa pun.
// ==========================================================
import { PAPERS, DPIS } from "./editorKit";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const bool = (b) => (b ? "True" : "False");
const argb = (hex, alpha = "FF") => `#${alpha}${String(hex || "#000000").replace("#", "").toUpperCase()}`;
const int = (n) => String(Math.round(Number(n) || 0));
const pad = (n) => String(n).padStart(2, "0");

export function formatDslrDate(d = new Date()) {
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** @param entries [{ layer, fileName }] hanya layer gambar, urut belakang -> depan */
export function buildTemplateXml({ meta, favorite, entries }) {
  const W = meta.canvasWidth, H = meta.canvasHeight;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Template Name="${esc(meta.name)}" IsFavorite="${bool(favorite)}" Width="${int(W)}" Height="${int(H)}" Dimensions="0" Resolution="${int(meta.dpi)}" BackgroundColor="${argb(meta.backgroundColor)}" print_2_per_page="False" PrintToSecondaryPrinter="False" LastSavedDate="${formatDslrDate()}">`,
    "  <Elements>",
  ];
  entries.forEach(({ layer: l, fileName }, z) => {
    const sh = l.shadow || {};
    lines.push(
      `    <Image Name="${esc(l.name || fileName)}" Opacity="${int((l.opacity ?? 1) * 100)}" ShadowEnabled="${bool(sh.enabled)}" ShadowColor="${argb(sh.color)}" ` +
      `ShadowDepth="${int(sh.distance ?? 10)}" ShadowRadius="${int(sh.spread ?? 20)}" ShadowDirection="${int(sh.angle ?? -45)}" ` +
      `Width="${int((l.widthPct / 100) * W)}" Height="${int((l.heightPct / 100) * H)}" Top="${int((l.yPct / 100) * H)}" Left="${int((l.xPct / 100) * W)}" ` +
      `ImagePath="${esc(fileName)}" KeepAspect="${bool(l.lockAspect)}" Thickness="${int(l.strokeWidth)}" StrokeColor="${argb(l.strokeColor)}" ZIndex="${z}" />`
    );
  });
  lines.push("  </Elements>", "</Template>");
  return "\uFEFF" + lines.join("\r\n"); // BOM + CRLF, persis seperti file asli dslrBooth
}

// ---------- IMPOR ----------

const num = (v, d = 0) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : d; };
const isTrue = (v) => String(v ?? "").trim().toLowerCase() === "true";
const hexFromArgb = (s, d) => {
  const m = /^#?([0-9a-f]{8}|[0-9a-f]{6})$/i.exec(String(s ?? "").trim());
  return m ? `#${m[1].slice(-6).toUpperCase()}` : d;
};
const lowerAttrs = (el) => Object.fromEntries(Array.from(el.attributes).map((a) => [a.name.toLowerCase(), a.value]));
const first = (a, names) => { for (const n of names) if (a[n.toLowerCase()] !== undefined) return a[n.toLowerCase()]; return undefined; };

const SIGS = [
  { mime: "image/png", ext: "png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];
export const sniffImage = (bytes) => SIGS.find((s) => s.test(bytes));

function toDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Gagal membaca gambar."));
    r.readAsDataURL(blob);
  });
}

/** Gambar PNG/JPEG dipakai apa adanya; format lain (BMP, GIF, WEBP) dikonversi ke PNG lewat canvas. */
async function imageBytesToDataUrl(bytes) {
  const sig = sniffImage(bytes);
  if (sig) return toDataUrl(new Blob([bytes], { type: sig.mime }));
  const bmp = await createImageBitmap(new Blob([bytes]));
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  return c.toDataURL("image/png");
}

function findFile(files, path) {
  const want = String(path || "").replace(/\\/g, "/");
  if (files.has(want)) return files.get(want);
  const lower = want.toLowerCase();
  const base = lower.split("/").pop();
  for (const [name, data] of files) {
    const n = name.toLowerCase();
    if (n === lower || n.split("/").pop() === base) return data;
  }
  return null;
}

function derivePaper(w, h, dpi) {
  const landscape = w > h;
  for (const p of PAPERS) {
    if (!p.w) continue;
    const pw = Math.round(p.w * dpi), ph = Math.round(p.h * dpi);
    const [a, b] = landscape ? [ph, pw] : [pw, ph];
    if (Math.abs(a - w) <= 1 && Math.abs(b - h) <= 1) return p.id;
  }
  return "custom";
}
const nearestDpi = (v) => DPIS.reduce((best, d) => (Math.abs(d - v) < Math.abs(best - v) ? d : best), DPIS[0]);

/**
 * Terjemahkan template.xml dslrBooth + file gambarnya menjadi data template POPSNAP.
 * @returns {{ meta, favorite, layers, report }} report = [{ level: "info"|"warn", text }]
 */
export async function importDslrTemplate(files) {
  const xmlBytes = findFile(files, "template.xml");
  if (!xmlBytes) throw new Error("template.xml tidak ditemukan di dalam ZIP.");
  const xml = new DOMParser().parseFromString(new TextDecoder("utf-8").decode(xmlBytes).replace(/^\uFEFF/, ""), "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("template.xml rusak (bukan XML yang valid).");
  const root = xml.documentElement;
  if (root.tagName !== "Template") throw new Error("Ini bukan template dslrBooth (elemen akar bukan <Template>).");

  const report = [];
  const t = lowerAttrs(root);
  const W = Math.round(num(t.width, 1200)), H = Math.round(num(t.height, 1800));
  const dpi = nearestDpi(Math.round(num(t.resolution, 300)));
  if (Math.round(num(t.resolution, 300)) !== dpi) report.push({ level: "warn", text: `Resolusi ${t.resolution} dpi tidak ada di daftar POPSNAP, dipakai ${dpi} dpi.` });
  if (t.backgroundcolor && /^#?[0-9a-f]{8}$/i.test(t.backgroundcolor) && t.backgroundcolor.replace("#", "").slice(0, 2).toLowerCase() !== "ff") {
    report.push({ level: "warn", text: "Latar template transparan di dslrBooth; di POPSNAP dipakai warna latar solid." });
  }
  if (isTrue(t.print_2_per_page)) report.push({ level: "warn", text: "Pengaturan 'print 2 per halaman' dari dslrBooth tidak didukung dan diabaikan." });

  const meta = {
    name: t.name || "Template Impor", category: undefined, price: 0,
    canvasWidth: W, canvasHeight: H, dpi, paperSize: derivePaper(W, H, dpi), orientation: W > H ? "landscape" : "portrait",
    backgroundColor: hexFromArgb(t.backgroundcolor, "#FFFFFF"),
  };

  const elements = Array.from(root.getElementsByTagName("Elements")[0]?.children ?? []).map((el, i) => ({ el, i, a: lowerAttrs(el) }));
  elements.sort((p, q) => num(p.a.zindex, p.i) - num(q.a.zindex, q.i) || p.i - q.i); // ZIndex naik = makin ke depan (perkiraan)

  const layers = [];
  let seq = 0;
  for (const { el, a } of elements) {
    const tag = el.tagName;
    const name = a.name || tag;
    const w = num(a.width), h = num(a.height);
    if (w <= 0 || h <= 0) { report.push({ level: "warn", text: `Layer "${name}" dilewati: ukuran tidak valid.` }); continue; }

    const base = {
      name, xPct: (num(a.left) / W) * 100, yPct: (num(a.top) / H) * 100, widthPct: (w / W) * 100, heightPct: (h / H) * 100,
      rotation: num(first(a, ["Rotation", "Rotate", "Angle"]), 0),
      opacity: (() => { const v = num(a.opacity, 100); return v <= 1 && String(a.opacity).includes(".") ? v : v / 100; })(),
      visible: !["false"].includes(String(first(a, ["IsVisible", "Visible"]) ?? "true").toLowerCase()),
      locked: isTrue(first(a, ["IsLocked", "Locked"])),
      strokeColor: hexFromArgb(a.strokecolor, "#000000"), strokeWidth: num(a.thickness, 0),
    };
    if (a.shadowenabled !== undefined) {
      base.shadow = { enabled: isTrue(a.shadowenabled), color: hexFromArgb(a.shadowcolor, "#000000"), angle: num(a.shadowdirection, -45), distance: num(a.shadowdepth, 10), spread: num(a.shadowradius, 20) };
    }

    const lt = tag.toLowerCase();
    if (lt === "image") {
      const bytes = a.imagepath ? findFile(files, a.imagepath) : null;
      if (!bytes) { report.push({ level: "warn", text: `Gambar "${a.imagepath || name}" tidak ada di dalam ZIP; layer "${name}" dilewati.` }); continue; }
      try {
        layers.push({ ...base, type: "image", imageData: await imageBytesToDataUrl(bytes), fileName: String(a.imagepath).split(/[\\/]/).pop(), lockAspect: isTrue(a.keepaspect) });
      } catch { report.push({ level: "warn", text: `Gambar "${a.imagepath}" tidak bisa dibaca; layer "${name}" dilewati.` }); }
    } else if (lt.includes("photo")) {
      const n = parseInt(first(a, ["PhotoNumber", "PhotoIndex", "PhotoNo", "Number", "Index", "Photo"]), 10);
      const hasNum = Number.isFinite(n) && n > 0;
      seq += 1;
      if (!hasNum) report.push({ level: "warn", text: `Slot foto "${name}": nomor foto tidak terbaca dari XML, dipakai urutan ${seq}. Periksa kolom Photo #.` });
      const hint = (tag + " " + Object.values(a).join(" ")).toLowerCase();
      layers.push({ ...base, type: "photo-slot", photoOrder: hasNum ? n : seq, shapeKind: /ellipse|circle|oval/.test(hint) ? "circle" : /round/.test(hint) ? "rounded" : "rectangle" });
      report.push({ level: "warn", text: `Layer foto "${name}" diimpor berdasarkan perkiraan format dslrBooth — periksa posisi & nomornya.` });
    } else if (lt.includes("text")) {
      layers.push({
        ...base, type: "text", text: first(a, ["Text", "Content"]) ?? "", fontSize: Math.round(num(first(a, ["FontSize", "Size"]), 48)),
        color: hexFromArgb(first(a, ["Foreground", "FontColor", "TextColor", "Color"]), "#000000"), fontFamily: first(a, ["FontFamily", "Font"]) || "sans-serif",
        bold: /bold/i.test(String(first(a, ["FontWeight", "Bold"]))), italic: /italic/i.test(String(first(a, ["FontStyle", "Italic"]))),
        align: /right/i.test(a.textalignment || "") ? "right" : /left/i.test(a.textalignment || "") ? "left" : "center",
      });
      report.push({ level: "warn", text: `Teks "${name}" diimpor berdasarkan perkiraan format dslrBooth — periksa ukuran & font.` });
    } else if (/(rect|ellipse|circle|shape)/.test(lt)) {
      layers.push({ ...base, type: "shape", shapeKind: /ellipse|circle/.test(lt) ? "circle" : "rectangle", fillColor: hexFromArgb(first(a, ["Fill", "FillColor", "Background"]), "#FF3E8E") });
      report.push({ level: "warn", text: `Bentuk "${name}" diimpor berdasarkan perkiraan format dslrBooth — periksa tampilannya.` });
    } else {
      report.push({ level: "warn", text: `Layer "${name}" bertipe <${tag}> belum didukung dan dilewati.` });
    }
  }

  return { meta, favorite: isTrue(t.isfavorite), layers, report };
}
