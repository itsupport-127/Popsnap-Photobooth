import { useEffect, useRef, useState } from "react";
import { effectiveRotation } from "../utils/cameraRotation";
import appConfig from "../config/appConfig";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

// Slider "Faster Framerate <-> Higher Quality" (Admin > Kamera): 0..3
const RESOLUTIONS = [
  { width: 640, height: 480 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 3840, height: 2160 },
];

/**
 * useCamera — abstraksi kamera.
 *
 * Mode 'webcam': getUserMedia di browser. Resolusi, perangkat video/audio, dan rotasi diambil dari
 *                pengaturan admin (appConfig.settings.camera).
 * Mode 'dslr'  : hanya di Electron (window.electronAPI). Preview berupa frame gambar (`previewFrame`).
 *
 * @param {object} opts  { audio: boolean }  — audio dipakai mode Video
 */
export default function useCamera(orientation = "portrait", opts = {}) {
  const videoRef = useRef(null);
  const imgRef = useRef(null); // <img> aliran MJPEG saat DSLR (sumber frame untuk klip Template Animasi)
  const streamRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [previewFrame, setPreviewFrame] = useState(null);
  const reopenRef = useRef(() => {});

  const cam = appConfig.settings?.camera ?? {};
  const rotation = cam.liveView?.rotation ?? 0;
  const useDslr = appConfig.cameraMode === "dslr";
  const wantAudio = !!opts.audio;
  // Kecerahan live view: manual (admin) x otomatis. Otomatis (khusus DSLR) = live view dinaikkan sampai sama terangnya dengan
  // hasil jepret biasa: target kecerahan dipelajari dari foto-foto yang sudah diambil (disimpan di browser), lalu ~2x/detik
  // live view dibandingkan dengan target itu. Hanya menaikkan (tidak pernah menggelapkan) dan berubah halus.
  const readNum = (k, def, lo, hi) => { try { const v = Number(localStorage.getItem(k)); return v >= lo && v <= hi ? v : def; } catch { return def; } };
  const [autoGain, setAutoGainState] = useState(() => readNum("popsnap.liveGain", 1, 1, 3.5));
  const photoLumaRef = useRef(readNum("popsnap.photoLuma", 105, 60, 200)); // kecerahan rata-rata foto hasil jepret (0-255)
  const asIs = cam.liveView?.asIs === true; // "Apa adanya": tanpa gamma / auto-terang, seperti dslrBooth
  const autoOn = !asIs && (cam.liveView?.autoBright !== false) && useDslr;
  const liveGain = asIs ? 1 : ((cam.liveView?.brightness ?? 100) / 100) * (autoOn ? autoGain : 1);
  const gainRef = useRef(1);
  gainRef.current = liveGain;
  const scratch = useRef({}); // kanvas kerja yang dipakai ulang (membuat kanvas baru tiap frame membebani memori & CPU)
  /** Dipanggil setelah tiap jepretan dengan kecerahan fotonya, supaya live view belajar "seterang apa hasil foto". */
  const learnPhotoLuma = (luma) => {
    if (!(luma > 20)) return;
    const next = Math.min(200, Math.max(60, photoLumaRef.current * 0.5 + luma * 0.5));
    photoLumaRef.current = next;
    try { localStorage.setItem("popsnap.photoLuma", String(Math.round(next * 10) / 10)); } catch { /* abaikan */ }
  };

  // ---------- Mode DSLR (digiCamControl lewat backend — jalan di Chrome maupun .exe) ----------
  useEffect(() => {
    if (!useDslr) return;
    let cancelled = false;
    let wasUp = false, fails = 0, key = 0;
    let lastOpen = 0;
    const open = () => { lastOpen = Date.now(); setPreviewFrame(`${API_BASE}/api/camera/dslr/stream?k=${++key}`); }; // aliran MJPEG: browser menampilkan langsung, tanpa JS per frame
    reopenRef.current = () => { if (Date.now() - lastOpen > 2000) open(); }; // <img> gagal / putus -> sambung lagi (dibatasi supaya tidak beruntun)
    // Pantau status tiap ~1,5 detik: tandai siap, tampilkan error, dan sambung ulang aliran kalau kamera sempat putus
    (async () => {
      while (!cancelled) {
        let up = false;
        let stalled = false;
        try { const r = await fetch(`${API_BASE}/api/camera/dslr/status`).then((x) => x.json()); up = !!r.online && !r.sdkError && !r.virtualOnly && (r.cameras?.length ?? 0) > 0; stalled = !!r.stream?.stalled; } catch { up = false; }
        if (cancelled) break;
        if (up) {
          fails = 0;
          if (!wasUp) { open(); wasUp = true; setReady(true); setError(null); }
          else if (stalled && Date.now() - lastOpen > 6000) open(); // server melaporkan tidak ada frame baru: buka aliran baru
        } else {
          wasUp = false;
          if (++fails >= 3) setError("Kamera DSLR belum terbaca. Cek Pengaturan > Kamera (penghubung kamera, kabel USB, kamera menyala).");
        }
        await new Promise((r) => setTimeout(r, up ? 2500 : 1200));
      }
    })();
    return () => {
      cancelled = true;
      setPreviewFrame(null);
      fetch(`${API_BASE}/api/camera/dslr/liveview/stop`, { method: "POST" }).catch(() => {});
    };
  }, [useDslr]);

  // ---------- Kecerahan otomatis live view (DSLR) ----------
  useEffect(() => {
    if (!autoOn || !ready) return undefined;
    let g = autoGain;
    const id = setInterval(() => {
      if (document.hidden) return;
      const c = drawFrame(48, true, "read"); // frame MENTAH kecil (48 px) -> murah
      if (!c) return;
      const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const live = sum / (d.length / 4);
      if (live < 3) return; // layar hitam / belum ada gambar: jangan dikejar
      const want = Math.min(2.5, Math.max(1, photoLumaRef.current / live));
      g += (want - g) * 0.3; // halus: orang lewat / lampu berubah tidak membuat kecerahan "berdenyut"
      if (Math.abs(g - gainRef.current / ((cam.liveView?.brightness ?? 100) / 100)) > 0.04) {
        const v = Math.round(g * 100) / 100;
        setAutoGainState(v);
        try { localStorage.setItem("popsnap.liveGain", String(v)); } catch { /* abaikan */ }
      }
    }, 450);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOn, ready]);

  // ---------- Mode Webcam (browser getUserMedia) ----------
  useEffect(() => {
    if (useDslr) return;
    let cancelled = false;
    const res = RESOLUTIONS[cam.resolution ?? 2] ?? RESOLUTIONS[2];

    async function open() {
      const build = (withDevice) => ({
        video: {
          ...(withDevice && cam.videoDeviceId ? { deviceId: { exact: cam.videoDeviceId } } : { facingMode: "user" }),
          width: { ideal: res.width }, height: { ideal: res.height },
        },
        audio: wantAudio ? (withDevice && cam.audioDeviceId ? { deviceId: { exact: cam.audioDeviceId } } : true) : false,
      });
      try {
        return await navigator.mediaDevices.getUserMedia(build(true));
      } catch (err) {
        // Perangkat pilihan admin tidak ada lagi (dicabut / ID berubah) -> pakai kamera bawaan, jangan macet
        if (err.name === "OverconstrainedError" || err.name === "NotFoundError") return navigator.mediaDevices.getUserMedia(build(false));
        throw err;
      }
    }

    open()
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = s;
        setStream(s);
        if (videoRef.current) videoRef.current.srcObject = s;
        setReady(true);
      })
      .catch((err) => setError(err.message));

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orientation, useDslr, wantAudio, cam.resolution, cam.videoDeviceId, cam.audioDeviceId]);

  // <video> baru dipasang setelah stream siap (mis. tampil bergantian) -> sambungkan lagi
  const attachImg = (el) => { imgRef.current = el; };
  const attachVideo = (el) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) el.srcObject = streamRef.current;
  };

  /**
   * Gambar frame video saat ini ke canvas dengan rotasi pengaturan (TANPA mirror — mirror hanya untuk live view).
   * Kanvas dipakai ulang per `key` (jangan simpan hasilnya: isinya ditimpa pemanggilan berikutnya dengan key yang sama; salin / baca segera).
   * key "read" = akan dibaca piksel-nya (CPU), key lain = hanya digambar / di-encode (GPU, jauh lebih ringan, filter kecerahan ikut GPU).
   */
  function drawFrame(maxWidth, raw = false, key = "read") {
    const img = useDslr ? imgRef.current : null;
    // DSLR: sumber = <img> aliran MJPEG (sudah tampil di layar); webcam: <video>
    const video = useDslr ? (img && img.naturalWidth ? { videoWidth: img.naturalWidth, videoHeight: img.naturalHeight, el: img } : null) : (videoRef.current && videoRef.current.videoWidth ? { videoWidth: videoRef.current.videoWidth, videoHeight: videoRef.current.videoHeight, el: videoRef.current } : null);
    if (!video) return null;
    const rotation = effectiveRotation(cam.liveView?.rotation ?? 0, cam.orientation, video.videoWidth, video.videoHeight);
    const swap = rotation === 90 || rotation === 270;
    const sw = swap ? video.videoHeight : video.videoWidth;
    const sh = swap ? video.videoWidth : video.videoHeight;
    const k = maxWidth && sw > maxWidth ? maxWidth / sw : 1;
    const w = Math.round(sw * k), h = Math.round(sh * k);
    let slot = scratch.current[key];
    if (!slot) {
      const canvas = document.createElement("canvas");
      slot = scratch.current[key] = { canvas, ctx: canvas.getContext("2d", { willReadFrequently: key === "read" }) };
    }
    const { canvas, ctx } = slot;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = "none";
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    const dw = video.videoWidth * k, dh = video.videoHeight * k;
    if (!raw && gainRef.current !== 1) ctx.filter = `brightness(${gainRef.current})`;
    try { ctx.drawImage(video.el, -dw / 2, -dh / 2, dw, dh); } catch { return null; } // frame belum siap
    return canvas;
  }

  async function capture() {
    if (useDslr) { // foto FULL RESOLUSI dari DSLR lewat backend (digiCamControl)
      const res = await fetch(`${API_BASE}/api/camera/dslr/capture`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.image) throw new Error(data.error || "Gagal jepret dari kamera DSLR.");
      return data.image;
    }
    const canvas = drawFrame(undefined, false, "shot");
    return canvas ? canvas.toDataURL("image/jpeg", 0.92) : null;
  }

  /** Frame kamera saat ini (sudah dirotasi) sebagai canvas lebar `maxWidth` — dipakai perekam klip Template Animasi. */
  function grabCanvas(maxWidth, raw = false, key = "read") {
    return drawFrame(maxWidth, raw, key);
  }

  /** Frame kecil (ImageData) untuk GIF / boomerang. */
  function captureFrameData(maxWidth) {
    const canvas = drawFrame(maxWidth, false, "data");
    if (!canvas) return null;
    return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  }

  return { videoRef, attachVideo, attachImg, liveGain, autoGain, learnPhotoLuma, reopen: () => reopenRef.current(), ready, error, capture, captureFrameData, grabCanvas, isDslr: useDslr, previewFrame, stream, rotation };
}
