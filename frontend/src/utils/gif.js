import { GIFEncoder, quantize, applyPalette } from "gifenc";

/** Muat dataURL jadi ImageData berukuran maxWidth (tinggi proporsional). */
export async function dataUrlToImageData(url, maxWidth) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Gagal memuat gambar untuk GIF."));
    i.src = url;
  });
  const k = img.naturalWidth > maxWidth ? maxWidth / img.naturalWidth : 1;
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return ctx.getImageData(0, 0, c.width, c.height);
}

/**
 * Susun GIF animasi dari frame-frame ImageData (semua ukuran sama). Mengembalikan Blob image/gif.
 * Diberi jeda antar frame supaya layar tidak membeku saat memproses.
 */
export async function encodeGif(frames, delayMs) {
  const gif = GIFEncoder();
  for (const f of frames) {
    const palette = quantize(f.data, 256);
    gif.writeFrame(applyPalette(f.data, palette), f.width, f.height, { palette, delay: delayMs, repeat: 0 });
    await new Promise((r) => setTimeout(r, 0));
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: "image/gif" });
}

/** Boomerang: maju lalu mundur (tanpa mengulang frame ujung) supaya loop-nya mulus. */
export const boomerangOrder = (frames) => (frames.length < 3 ? frames : [...frames, ...frames.slice(1, -1).reverse()]);
