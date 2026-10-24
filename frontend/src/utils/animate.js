import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { createAnimatedComposer } from "./composeImage";
import { photoSlotPlan } from "./templatePhotos";
import { filterCss, getLutFilter } from "./filters";
import { applyLut, loadLut } from "./lut";
import { getClip } from "./clipStore";
import { composeImage } from "./composeImage";
import { dataUrlToImageData, encodeGif } from "./gif";

// ==========================================================
// Template Animasi — dari klip per foto jadi: (1) GIF/MP4 seluruh template yang bergerak, (2) klip mentah per foto.
// Semua angka (durasi, fps, lebar, ping-pong) dari Admin > Pengaturan > GIF & Video > Template Animasi.
// ==========================================================

const tick = () => new Promise((r) => setTimeout(r, 0));
const evenSize = (n) => Math.max(2, Math.round(n) & ~1);

/** Frame klip (JPEG) -> daftar ImageBitmap berjarak waktu SERAGAM (1/fps), dari (jepret - sebelum) sampai (jepret + sesudah). */
export async function clipBitmaps(clip, cfg) {
  const frames = clip?.frames ?? [];
  if (frames.length === 0) return [];
  const step = 1000 / cfg.fps;
  const start = Math.max(clip.shutterT - cfg.secondsBefore * 1000, frames[0].t);
  const end = Math.min(clip.shutterT + cfg.secondsAfter * 1000, frames[frames.length - 1].t);
  const n = Math.max(1, Math.floor((end - start) / step) + 1);
  const cache = new Map();
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const target = start + i * step;
    while (j + 1 < frames.length && Math.abs(frames[j + 1].t - target) <= Math.abs(frames[j].t - target)) j++;
    if (!cache.has(j)) cache.set(j, await createImageBitmap(frames[j].blob));
    out.push(cache.get(j));
  }
  return out;
}

/** Urutan indeks pemutaran. pingpong: maju lalu mundur tanpa mengulang frame ujung (loop mulus). */
export function playOrder(n, loop) {
  const fwd = Array.from({ length: n }, (_, i) => i);
  if (loop !== "pingpong" || n < 3) return fwd;
  return [...fwd, ...fwd.slice(1, -1).reverse()];
}

const toImageData = (bmp, scratch) => {
  scratch.width = bmp.width; scratch.height = bmp.height;
  const c = scratch.getContext("2d", { willReadFrequently: true });
  c.drawImage(bmp, 0, 0);
  return c.getImageData(0, 0, bmp.width, bmp.height);
};

/** GIF dengan SATU palet bersama (diambil dari beberapa frame) -> kedip warna antar frame hilang & lebih ringan. */
export async function encodeSharedGif(bitmaps, order, fps, onProgress) {
  const scratch = document.createElement("canvas");
  const imgs = [];
  for (const b of bitmaps) { imgs.push(toImageData(b, scratch)); await tick(); }
  const picks = [0, 0.25, 0.5, 0.75, 1].map((p) => imgs[Math.round(p * (imgs.length - 1))]);
  const stride = 4; // ambil tiap 4 piksel supaya cepat
  const sample = new Uint8ClampedArray(picks.reduce((a, im) => a + Math.ceil(im.data.length / 16) * 4, 0));
  let o = 0;
  for (const im of picks) for (let i = 0; i < im.data.length; i += 4 * stride) { sample[o++] = im.data[i]; sample[o++] = im.data[i + 1]; sample[o++] = im.data[i + 2]; sample[o++] = im.data[i + 3]; }
  const palette = quantize(sample.subarray(0, o), 256);
  const indexed = imgs.map((im) => applyPalette(im.data, palette)); // dihitung sekali per frame unik
  const gif = GIFEncoder();
  const delay = Math.round(1000 / fps);
  for (let k = 0; k < order.length; k++) {
    const im = imgs[order[k]];
    gif.writeFrame(indexed[order[k]], im.width, im.height, { palette: k === 0 ? palette : undefined, delay, repeat: 0 });
    if (k % 8 === 0) { onProgress?.(k / order.length); await tick(); }
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: "image/gif" });
}

const CODECS = ["avc1.640028", "avc1.4d0028", "avc1.42001f"];
export async function pickMp4Codec(w, h, fps) {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
  for (const codec of CODECS) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate: 1_000_000, framerate: fps });
      if (r.supported) return codec;
    } catch { /* coba codec berikutnya */ }
  }
  return null;
}

/** MP4 (H.264) lewat WebCodecs + mp4-muxer. Mengembalikan null kalau browser tidak mendukung (pakai GIF saja). */
export async function encodeMp4(bitmaps, order, fps) {
  const w = bitmaps[0].width, h = bitmaps[0].height;
  const codec = await pickMp4Codec(w, h, fps);
  if (!codec) return null;
  try {
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: "avc", width: w, height: h }, fastStart: "in-memory" });
    let failed = null;
    const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failed = e; } });
    enc.configure({ codec, width: w, height: h, bitrate: Math.round(w * h * fps * 0.25), framerate: fps });
    const dur = 1e6 / fps;
    for (let k = 0; k < order.length; k++) {
      if (failed) throw failed;
      const vf = new VideoFrame(bitmaps[order[k]], { timestamp: Math.round(k * dur), duration: Math.round(dur) });
      enc.encode(vf, { keyFrame: k % Math.max(1, Math.round(fps)) === 0 });
      vf.close();
      if (enc.encodeQueueSize > 8) await tick();
    }
    await enc.flush();
    enc.close();
    if (failed) throw failed;
    muxer.finalize();
    return new Blob([target.buffer], { type: "video/mp4" });
  } catch (err) {
    console.warn("[animate] MP4 gagal, pakai GIF:", err?.message || err);
    return null;
  }
}

const stillBitmap = async (src) => {
  const blob = await (await fetch(src)).blob();
  return createImageBitmap(blob);
};

/**
 * Bangun semua file animasi sesi.
 * @returns {{ gif: Blob|null, mp4: Blob|null, clips: Array<{ n:number, blob:Blob, ext:string }> }}
 */
export async function buildAnimatedAssets({ session, cfg, onProgress, onLive, onClip }) {
  const template = session.selectedTemplate;
  const editorState = session.editorState ?? { filter: "none", mirror: false };
  const plan = photoSlotPlan(template?.layers ?? []);
  const result = { gif: null, mp4: null, clips: [] };

  // --- Klip per nomor foto template ---
  const perSlot = [];
  for (let n = 0; n < plan.count; n++) {
    const shotIdx = session.photosForTemplate[n];
    const bmps = shotIdx == null ? [] : await clipBitmaps(getClip(shotIdx), cfg);
    perSlot.push({ shotIdx, bmps });
  }
  const withClip = perSlot.filter((p) => p.bmps.length > 0);
  if (withClip.length === 0) return result; // tidak ada klip terekam (kamera DSLR / fitur baru dinyalakan) -> hanya foto biasa
  const count = Math.min(...withClip.map((p) => p.bmps.length));
  const stills = await Promise.all(perSlot.map((p) => (p.bmps.length === 0 && p.shotIdx != null ? stillBitmap(session.shots[p.shotIdx]) : null)));

  // --- Template bergerak ---
  const composer = await createAnimatedComposer({
    canvasWidth: template?.canvasWidth ?? 1200, canvasHeight: template?.canvasHeight ?? 1800,
    backgroundColor: template?.backgroundColor, layers: template?.layers ?? [], editorState, outWidth: cfg.gifWidth,
  });
  const frames = [];
  for (let i = 0; i < count; i++) {
    const out = await composer.render(perSlot.map((p, n) => (p.bmps.length ? p.bmps[i] : stills[n])));
    frames.push(await createImageBitmap(out));
    onProgress?.("compose", (i + 1) / count);
    if (i % 4 === 0) await tick();
  }
  const order = playOrder(count, cfg.loop);
  // MP4 dulu (cepat, memakai encoder bawaan browser). GIF yang berat HANYA sebagai cadangan kalau MP4 tidak didukung.
  if (cfg.templateMp4 !== false) result.mp4 = await encodeMp4(frames, order, cfg.fps);
  if (!result.mp4) result.gif = await encodeSharedGif(frames, order, cfg.fps, (p) => onProgress?.("gif", p));
  frames.forEach((b) => b.close?.());
  // Tampilkan Live SEKARANG (jangan tunggu klip mentah): pemanggil menampilkan & mengunggah di latar
  await onLive?.(result);

  // --- Klip mentah per foto (yang dipakai di template, urut nomor foto) ---
  if (cfg.rawClips) {
    const lutF = getLutFilter(editorState.filter);
    let lut = null;
    if (lutF) { try { lut = await loadLut(lutF.url, lutF.size); } catch { lut = null; } }
    let done = 0;
    for (const p of perSlot) {
      if (p.bmps.length === 0) continue;
      const w = evenSize(p.bmps[0].width), h = evenSize(p.bmps[0].height);
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const cx = cv.getContext("2d");
      const rendered = [];
      for (const b of p.bmps) {
        cx.setTransform(1, 0, 0, 1, 0, 0);
        cx.clearRect(0, 0, w, h);
        if (editorState.mirror) { cx.translate(w, 0); cx.scale(-1, 1); }
        let src = b;
        if (lut) { try { src = applyLut(b, lut, lutF.intensity ?? 100, 1280); } catch { src = b; } }
        if (editorState.filter && editorState.filter !== "none") cx.filter = filterCss(editorState.filter);
        cx.drawImage(src, 0, 0, w, h);
        cx.filter = "none";
        rendered.push(await createImageBitmap(cv));
      }
      const ord = playOrder(rendered.length, cfg.loop);
      let blob = null, ext = "mp4";
      if (cfg.rawFormat === "mp4") blob = await encodeMp4(rendered, ord, cfg.fps);
      if (!blob) { blob = await encodeSharedGif(rendered, ord, cfg.fps); ext = "gif"; }
      rendered.forEach((b) => b.close?.());
      const item = { n: p.shotIdx + 1, blob, ext };
      result.clips.push(item);
      await onClip?.(item);
      onProgress?.("clips", ++done / withClip.length);
    }
  }
  return result;
}

/**
 * GIF "foto bergerak di dalam template": mulai dari template kosong, foto-foto muncul satu per satu mengisi slot,
 * lalu hasil akhir ditahan sebentar. Semua layer template ikut (bingkai, stiker, teks) karena dirender dengan composeImage.
 * @param {Array<string|undefined>} chosen  foto per slot template (undefined = kosong)
 */
export async function buildRevealGif({ template, chosen, editorState, width = 480, delayMs = 600, holdMs = 1800 }) {
  const slots = chosen.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
  if (slots.length < 2) return null;
  const imgs = [];
  for (let k = 0; k <= slots.length; k++) {
    const shown = new Set(slots.slice(0, k));
    const photos = chosen.map((p, i) => (shown.has(i) ? p : undefined));
    const url = await composeImage({
      canvasWidth: template?.canvasWidth ?? 1200, canvasHeight: template?.canvasHeight ?? 1800,
      backgroundColor: template?.backgroundColor, layers: template?.layers ?? [], photos, editorState,
    });
    imgs.push(await dataUrlToImageData(url, width));
    await tick();
  }
  const holdFrames = Math.max(0, Math.round(holdMs / delayMs) - 1);
  for (let h = 0; h < holdFrames; h++) imgs.push(imgs[imgs.length - 1]); // tahan hasil akhir
  return encodeGif(imgs, delayMs);
}
