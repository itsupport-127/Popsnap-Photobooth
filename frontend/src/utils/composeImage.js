import { photoSlotPlan } from "./templatePhotos";
import { filterCss, getLutFilter } from "./filters";
import { applyLut, loadLut } from "./lut";

// ==========================================================
// composeImage — merender SEMUA layer template (gambar, slot foto,
// teks, shape) jadi satu gambar akhir, sesuai urutan depan-belakang
// yang diatur admin di Template Editor.
//
// Layer array: index 0 = PALING BELAKANG, index terakhir = PALING DEPAN
// (persis konsep layer di Photoshop/dslrBooth).
//
// Tipe layer yang didukung:
//   "image"      -> gambar statis (background/foreground/dekorasi)
//   "photo-slot" -> foto hasil sesi, dipotong sesuai shapeKind
//   "text"       -> teks custom (nama event, tanggal, dst)
//   "shape"      -> bentuk solid (kotak/rounded/lingkaran) buat dekorasi
//
// Posisi semua layer disimpan dalam PERSEN (0-100) terhadap ukuran
// template asli, supaya tetap akurat di ukuran render berapa pun.
// ==========================================================

/**
 * @param {object} params
 * @param {number} params.canvasWidth
 * @param {number} params.canvasHeight
 * @param {Array} params.layers - array layer, urutan index = urutan depan-belakang
 * @param {Array<string>} params.photos - dataURL foto terpilih. Foto ke-n mengisi slot dengan NOMOR foto terkecil ke-n
 *        (slot hasil Copy yang bernomor sama menampilkan foto yang sama) — lihat utils/templatePhotos.js
 * @param {object} params.editorState - { filter, mirror } — cuma berlaku ke layer "photo-slot"
 * @returns {Promise<string>} dataURL hasil akhir (PNG)
 */
export async function composeImage({ canvasWidth, canvasHeight, layers = [], photos = [], editorState = { filter: "none", mirror: false }, backgroundColor = "#ffffff" }) {
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = backgroundColor || "#ffffff";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const plan = photoSlotPlan(layers);
  const photoFor = async (layer) => {
    const photo = photos[plan.indexByLayer.get(layer.id)];
    return photo ? loadImage(photo) : null;
  };
  for (const layer of layers) await drawLayer(ctx, layer, canvasWidth, canvasHeight, editorState, photoFor);
  await drawStickers(ctx, editorState, canvasWidth, canvasHeight);

  return canvas.toDataURL("image/png");
}


/** Render SATU layer (gambar / slot foto / shape / teks) ke ctx. `photoFor(layer)` -> gambar/canvas untuk slot foto (atau null). */
async function drawLayer(ctx, layer, canvasWidth, canvasHeight, editorState, photoFor) {
  if (layer.visible === false) return; // layer disembunyikan (ikon mata) di Template Editor
  const x = (layer.xPct / 100) * canvasWidth;
  const y = (layer.yPct / 100) * canvasHeight;
  const w = (layer.widthPct / 100) * canvasWidth;
  const h = (layer.heightPct / 100) * canvasHeight;
  const sw = Math.max(0, Number(layer.strokeWidth) || 0);
  const shadow = layer.shadow?.enabled ? layer.shadow : null;

  ctx.save();
  ctx.globalAlpha = layer.opacity ?? 1;
  ctx.translate(x + w / 2, y + h / 2);
  if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);

  try {
    if (layer.type === "image" && layer.imageUrl) {
      const img = await loadImage(layer.imageUrl);
      // Gambar memenuhi seluruh kotak layer (melar bila kotak tidak proporsional) — SAMA dengan object-fit: fill di preview
      if (shadow) setShadow(ctx, shadow);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      clearShadow(ctx);
      if (sw > 0) strokeInside(ctx, "rectangle", w, h, sw, layer.strokeColor);
    } else if (layer.type === "photo-slot") {
      let img = photoFor ? await photoFor(layer) : null;
      if (img) {
        const lutF = getLutFilter(editorState.filter);
        if (lutF) { // filter LUT (.cube): diproses penuh resolusi sebelum digambar
          try { img = applyLut(img, await loadLut(lutF.url, lutF.size), lutF.intensity ?? 100); } catch { /* LUT gagal dimuat: pakai foto asli */ }
        }
        // Bayangan digambar dulu dari bentuk slot (tidak bisa dari foto yang di-clip, karena bayangan ikut terpotong)
        if (shadow) {
          ctx.save();
          setShadow(ctx, shadow);
          ctx.fillStyle = "#000000";
          buildShapePath(ctx, layer.shapeKind, -w / 2, -h / 2, w, h);
          ctx.fill();
          ctx.restore();
        }
        if (editorState.mirror) ctx.scale(-1, 1);
        if (editorState.filter && editorState.filter !== "none") ctx.filter = filterCss(editorState.filter);
        buildShapePath(ctx, layer.shapeKind, -w / 2, -h / 2, w, h);
        ctx.clip();
        drawImageCover(ctx, img, -w / 2, -h / 2, w, h);
        ctx.filter = "none"; // filter foto tidak boleh ikut mewarnai garis tepi
        if (sw > 0) strokeInside(ctx, layer.shapeKind, w, h, sw, layer.strokeColor);
      }
    } else if (layer.type === "shape") {
      buildShapePath(ctx, layer.shapeKind, -w / 2, -h / 2, w, h);
      if (layer.fillColor && layer.fillColor !== "transparent") {
        if (shadow) setShadow(ctx, shadow);
        ctx.fillStyle = layer.fillColor;
        ctx.fill();
        clearShadow(ctx);
      }
      if (sw > 0) strokeInside(ctx, layer.shapeKind, w, h, sw, layer.strokeColor, shadow);
    } else if (layer.type === "text") {
      if (shadow) setShadow(ctx, shadow);
      ctx.fillStyle = layer.color || "#000000";
      const weight = layer.bold ? "bold" : "normal";
      ctx.font = `${layer.italic ? "italic " : ""}${weight} ${layer.fontSize || 48}px ${layer.fontFamily || "sans-serif"}`;
      ctx.textAlign = layer.align || "center";
      ctx.textBaseline = "middle";
      // Origin (0,0) di sini itu TITIK TENGAH kotak layer (karena translate di atas), bukan pojok kiri atas
      const textX = layer.align === "left" ? -w / 2 : layer.align === "right" ? w / 2 : 0;
      ctx.fillText(layer.text || "", textX, 0);
    }
  } catch (err) {
    console.error(`[composeImage] Gagal render layer ${layer.type} (${layer.id}):`, err.message);
    // Lanjut ke layer berikutnya walau satu layer gagal, biar 1 gambar rusak gak bikin seluruh hasil gagal total.
  }

  ctx.restore();
}

/** Stiker (Editor > Add sticker) selalu paling atas. Posisi & ukuran dalam % kanvas, sama dengan pratinjau. */
async function drawStickers(ctx, editorState, canvasWidth, canvasHeight) {
  // Stiker (Editor > Add sticker) selalu paling atas. Posisi & ukuran dalam % kanvas, sama dengan pratinjau.
  for (const st of editorState.stickers ?? []) {
    if (!st || !st.src) continue; // data lama (emoji teks) dilewati
    try {
      const img = await loadImage(st.src);
      const w = ((Number(st.w) || 18) / 100) * canvasWidth;
      const ar = Number(st.ar) || img.width / img.height || 1;
      const h = w / ar;
      ctx.save();
      ctx.translate(((Number(st.x) || 0) / 100) * canvasWidth, ((Number(st.y) || 0) / 100) * canvasHeight);
      if (st.rot) ctx.rotate((st.rot * Math.PI) / 180);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    } catch (err) {
      console.error("[composeImage] Gagal menggambar stiker:", err?.message || err);
    }
  }
}

/**
 * Pembuat frame untuk TEMPLATE ANIMASI. Bagian statis (gambar, shape, teks, stiker) digambar SEKALI ke kanvas bantu,
 * lalu tiap frame hanya slot foto yang digambar ulang dengan frame klipnya (mirror + filter + LUT ikut pilihan tamu).
 * @returns {{ canvas, width, height, render(slotFrames: Array<drawable|null>) }}  slotFrames[n] = frame untuk foto ke-n
 */
export async function createAnimatedComposer({ canvasWidth, canvasHeight, layers = [], editorState = { filter: "none", mirror: false }, backgroundColor = "#ffffff", outWidth = 480 }) {
  const scale = outWidth / canvasWidth;
  const W = Math.max(2, Math.round(canvasWidth * scale) & ~1);
  const H = Math.max(2, Math.round(canvasHeight * scale) & ~1);
  const sx = W / canvasWidth, sy = H / canvasHeight;
  const plan = photoSlotPlan(layers);
  const visible = layers.filter((l) => l.visible !== false);

  const makeCanvas = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; };
  // Pecah layer jadi urutan: [bagian statis][slot][bagian statis][slot]...[stiker]
  const parts = [];
  let cur = null;
  const flush = () => { if (cur) { parts.push(cur); cur = null; } };
  for (const l of visible) {
    if (l.type === "photo-slot") { flush(); parts.push({ slot: l }); }
    else (cur ??= { layers: [] }).layers.push(l);
  }
  flush();
  for (const p of parts) {
    if (p.slot) continue;
    p.canvas = makeCanvas();
    const c = p.canvas.getContext("2d");
    c.scale(sx, sy);
    for (const l of p.layers) await drawLayer(c, l, canvasWidth, canvasHeight, editorState, null);
  }
  const stickers = makeCanvas();
  {
    const c = stickers.getContext("2d");
    c.scale(sx, sy);
    await drawStickers(c, editorState, canvasWidth, canvasHeight);
  }
  // Bagian paling bawah: warna latar
  const out = makeCanvas();
  const octx = out.getContext("2d");

  let lut = null;
  const lutF = getLutFilter(editorState.filter);
  if (lutF) { try { lut = await loadLut(lutF.url, lutF.size); } catch { lut = null; } }

  async function render(slotFrames) {
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.globalAlpha = 1;
    octx.fillStyle = backgroundColor || "#ffffff";
    octx.fillRect(0, 0, W, H);
    // Tiap frame sumber diberi filter LUT sekali per slot-nomor (slot bernomor sama berbagi hasil)
    const lutCache = new Map();
    const photoFor = async (layer) => {
      const n = plan.indexByLayer.get(layer.id);
      let f = slotFrames[n];
      if (!f) return null;
      if (lut) {
        if (!lutCache.has(n)) { try { lutCache.set(n, applyLut(f, lut, lutF.intensity ?? 100, 640)); } catch { lutCache.set(n, f); } }
        f = lutCache.get(n);
      }
      return f;
    };
    for (const p of parts) {
      if (p.canvas) { octx.drawImage(p.canvas, 0, 0); continue; }
      octx.save();
      octx.scale(sx, sy);
      await drawLayer(octx, p.slot, canvasWidth, canvasHeight, editorState, photoFor);
      octx.restore();
    }
    octx.drawImage(stickers, 0, 0);
    return out;
  }
  return { canvas: out, width: W, height: H, render };
}

/** Bayangan: offset kanvas TIDAK ikut rotasi layer, jadi arahnya tetap (sama dengan preview CSS). */
function setShadow(ctx, sh) {
  const rad = ((sh.angle ?? -45) * Math.PI) / 180;
  const d = sh.distance ?? 10;
  ctx.shadowColor = sh.color || "#000000";
  ctx.shadowOffsetX = Math.cos(rad) * d;
  ctx.shadowOffsetY = -Math.sin(rad) * d;
  ctx.shadowBlur = sh.spread ?? 20;
}
function clearShadow(ctx) {
  ctx.shadowColor = "transparent";
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.shadowBlur = 0;
}

/** Garis tepi di DALAM kotak layer (sama dengan border-box di preview CSS). */
function strokeInside(ctx, shapeKind, w, h, sw, color, shadow) {
  const i = sw / 2;
  buildShapePath(ctx, shapeKind, -w / 2 + i, -h / 2 + i, w - sw, h - sw, shapeKind === "rounded" ? Math.max(0, Math.min(w, h) * 0.15 - i) : undefined);
  ctx.strokeStyle = color || "#000000";
  ctx.lineWidth = sw;
  if (shadow) setShadow(ctx, shadow);
  ctx.stroke();
  clearShadow(ctx);
}

/**
 * Bangun path shape (dipakai untuk clip foto ATAU fill/stroke shape dekorasi).
 */
/** Titik bintang 5 sudut (0..1 dalam kotak): jari-jari luar 0,5 dan dalam 0,5 x 0,382, lalu diregangkan memenuhi kotak. */
export const STAR_POINTS = (() => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 === 0 ? 1 : 0.382;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return pts.map(([px, py]) => [(px - x0) / (x1 - x0), (py - y0) / (y1 - y0)]);
})();

function buildShapePath(ctx, shapeKind, x, y, w, h, radiusOverride) {
  ctx.beginPath();
  if (shapeKind === "circle") {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (shapeKind === "star") {
    // Bintang 5 sudut yang memenuhi kotak (sama dengan preview CSS: starPoints)
    STAR_POINTS.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(x + px * w, y + py * h) : ctx.lineTo(x + px * w, y + py * h)));
  } else if (shapeKind === "rounded") {
    const radius = radiusOverride ?? Math.min(w, h) * 0.15;
    roundedRectPath(ctx, x, y, w, h, radius);
  } else {
    ctx.rect(x, y, w, h);
  }
  ctx.closePath();
}

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
function drawImageCover(ctx, img, x, y, w, h) {
  const imgRatio = img.width / img.height;
  const boxRatio = w / h;
  let sx, sy, sw, sh;

  if (imgRatio > boxRatio) {
    sh = img.height;
    sw = sh * boxRatio;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / boxRatio;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

