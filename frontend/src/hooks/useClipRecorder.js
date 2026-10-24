import { useCallback, useEffect, useRef } from "react";
import { putClip, beginPending, endPending } from "../utils/clipStore";

const toBlob = (canvas, q) => new Promise((res) => canvas.toBlob(res, "image/jpeg", q));

/**
 * useClipRecorder — merekam "momen sebelum & sesudah jepret" untuk Template Animasi.
 *
 * Selama aktif, tiap 1/fps detik satu frame kamera (lebar `clipWidth`, sudah dirotasi) disimpan sebagai JPEG kecil di
 * buffer bergulir (hanya `secondsBefore` terakhir). Saat mark(n) dipanggil tepat sebelum jepret, frame di buffer
 * disalin lalu perekaman dilanjutkan `secondsAfter` detik -> klip foto ke-n disimpan di clipStore.
 *
 * @param {boolean}  p.enabled  template animasi + fitur aktif + bukan DSLR
 * @param {Function} p.grab     (maxWidth) => canvas | null   (useCamera.grabCanvas)
 * @param {object}   p.cfg      settings.animated  { secondsBefore, secondsAfter, fps, clipWidth }
 */
export default function useClipRecorder({ enabled, grab, cfg }) {
  const grabRef = useRef(grab);
  grabRef.current = grab;
  const ring = useRef([]);
  const collectors = useRef([]);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const finish = useCallback((col) => {
    if (col.done) return;
    col.done = true;
    clearTimeout(col.timer);
    collectors.current = collectors.current.filter((c) => c !== col);
    putClip(col.index, { frames: col.frames, shutterT: col.T, fps: cfgRef.current.fps });
    endPending();
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const { fps, clipWidth } = cfgRef.current;
    let busy = false, skip = 0;
    const period = 1000 / fps;
    const id = setInterval(async () => {
      if (busy || document.hidden) return; // pengambilan sebelumnya belum selesai: lewati supaya tidak menumpuk
      if (skip > 0) { skip--; return; }
      busy = true;
      try {
        const t0 = performance.now();
        // key "clip": kanvas GPU yang dipakai ulang (bukan kanvas CPU baru tiap frame) -> live view di layar tetap mulus
        const c = grabRef.current?.(clipWidth, false, "clip");
        if (!c) return;
        const t = performance.now();
        const blob = await toBlob(c, 0.78);
        if (!blob) return;
        // Komputer lambat: kalau satu frame butuh >60% waktu antar-frame, kurangi laju perekaman otomatis (live view lebih penting)
        const cost = performance.now() - t0;
        if (cost > period * 0.6) skip = Math.min(4, Math.ceil(cost / period) - 1);
        const f = { t, blob };
        const keepFrom = t - (cfgRef.current.secondsBefore + 1) * 1000;
        ring.current.push(f);
        while (ring.current.length && ring.current[0].t < keepFrom) ring.current.shift();
        for (const col of collectors.current) if (t <= col.end) col.frames.push(f);
      } finally { busy = false; }
    }, 1000 / fps);
    return () => {
      clearInterval(id);
      collectors.current.slice().forEach(finish); // pindah layar: simpan apa adanya
      ring.current = [];
    };
  }, [enabled, cfg.fps, cfg.clipWidth, finish]);

  /** Panggil TEPAT sebelum jepret. index = nomor foto di session.shots yang akan dibuat. */
  const mark = useCallback((index) => {
    if (!enabled) return;
    const T = performance.now();
    const { secondsBefore, secondsAfter, fps } = cfgRef.current;
    const col = { index, T, end: T + secondsAfter * 1000, frames: ring.current.filter((f) => f.t >= T - secondsBefore * 1000) };
    beginPending();
    col.timer = setTimeout(() => finish(col), secondsAfter * 1000 + (2000 / fps) + 150);
    collectors.current.push(col);
  }, [enabled, finish]);

  return { mark };
}
