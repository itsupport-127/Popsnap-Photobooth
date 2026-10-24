import React, { useEffect, useRef, useState } from "react";
import appConfig from "../config/appConfig";
import useCamera from "../hooks/useCamera";
import useShotSequence from "../hooks/useShotSequence";
import LiveView from "../components/LiveView";
import CountdownOverlay from "../components/CountdownOverlay";
import { dataUrlToImageData, encodeGif, boomerangOrder } from "../utils/gif";
import { uploadMedia } from "../services/sessionService";

const TITLE = { gif: "GIF", boomerang: "Boomerang", video: "Video" };

/**
 * Sesi GIF / Boomerang / Video.
 *  - GIF       : N foto dengan hitung mundur (seperti sesi foto) -> digabung jadi GIF animasi.
 *  - Boomerang : hitung mundur, rekam beberapa detik gerakan, lalu diputar maju-mundur berulang (hasil: GIF loop).
 *  - Video     : hitung mundur, rekam sampai durasi maksimal (atau tekan Stop). Format MP4 jika browser mendukung, kalau tidak WebM.
 */
export default function MediaCaptureScreen({ session, dispatch }) {
  const mode = session.mode;
  const s = appConfig.settings ?? {};
  const cap = s.display?.capture ?? {};
  const camera = useCamera("landscape", { audio: mode === "video" && !!s.video?.audio });
  const [stage, setStage] = useState("shoot"); // shoot | recording | processing | error
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const frames = useRef([]);       // dataURL (GIF) / ImageData (boomerang)
  const [shotCount, setShotCount] = useState(0);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startedRef = useRef(false);

  const gifFrames = s.gif?.frames ?? 4;

  async function finish(blob, kind, previewUrl) {
    setStage("processing");
    try {
      const r = await uploadMedia(blob, kind, { paymentMethod: session.paymentMethod, orderNo: session.sessionId });
      dispatch({ type: "MEDIA_DONE", payload: { url: r.shareUrl || r.downloadUrl, previewUrl, kind: mode, sessionId: r.sessionId, uploadKey: r.uploadKey } });
    } catch (err) {
      setError(err.message);
      setStage("error");
    }
  }

  // ---------- GIF: pakai urutan jepret yang sama dengan sesi foto ----------
  const gifActive = mode === "gif" && camera.ready && stage === "shoot" && !confirmCancel;
  const seq = useShotSequence({
    active: gifActive,
    needed: mode === "gif" && shotCount < gifFrames,
    shotCount,
    autoSequence: true,
    autoTrigger: s.camera?.autoTrigger !== false,
    countdownFirst: cap.countdownFirst ?? 5,
    countdownOthers: cap.countdownOthers ?? 3,
    displaySeconds: Math.min(cap.displayPhotoSeconds ?? 2, 1),
    capture: camera.capture,
    onCaptured: async (photo) => {
      frames.current.push(photo);
      const n = frames.current.length;
      setShotCount(n);
      if (n >= gifFrames) {
        setStage("processing");
        try {
          const imgs = await Promise.all(frames.current.map((u) => dataUrlToImageData(u, s.gif?.width ?? 600)));
          const blob = await encodeGif(imgs, s.gif?.frameDelayMs ?? 600);
          await finish(blob, "gif", URL.createObjectURL(blob));
        } catch (err) { setError(err.message); setStage("error"); }
      }
    },
  });

  // ---------- Boomerang & Video: hitung mundur sendiri, lalu rekam ----------
  const [count, setCount] = useState(null);
  useEffect(() => {
    if (mode === "gif" || !camera.ready || confirmCancel || startedRef.current || stage !== "shoot") return;
    if (camera.isDslr) { setError("Mode ini hanya untuk webcam / kamera USB (bukan DSLR)."); setStage("error"); return; }
    setCount((c) => (c === null ? cap.countdownFirst ?? 5 : c));
  }, [camera.ready, confirmCancel, stage, mode, camera.isDslr]);

  useEffect(() => {
    if (count === null || confirmCancel || stage !== "shoot") return;
    if (count <= 0) { setCount(null); startRecording(); return; }
    const t = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, confirmCancel, stage]);

  function startRecording() {
    if (startedRef.current) return;
    startedRef.current = true;
    setStage("recording");
    if (mode === "boomerang") recordBoomerang();
    else recordVideo();
  }

  function recordBoomerang() {
    const { seconds = 3, fps = 10, width = 480 } = s.boomerang ?? {};
    const total = seconds * fps;
    const out = [];
    const timer = setInterval(async () => {
      const f = camera.captureFrameData(width);
      if (f) out.push(f);
      setProgress(out.length / total);
      if (out.length >= total) {
        clearInterval(timer);
        setStage("processing");
        try {
          const blob = await encodeGif(boomerangOrder(out), Math.round(1000 / fps));
          await finish(blob, "boomerang", URL.createObjectURL(blob));
        } catch (err) { setError(err.message); setStage("error"); }
      }
    }, 1000 / fps);
    recorderRef.current = { stop: () => clearInterval(timer) };
  }

  function recordVideo() {
    const type = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((t) => window.MediaRecorder?.isTypeSupported?.(t));
    if (!camera.stream || !type) { setError("Browser ini tidak mendukung perekaman video."); setStage("error"); return; }
    const rec = new MediaRecorder(camera.stream, { mimeType: type, videoBitsPerSecond: 4_000_000 });
    chunksRef.current = [];
    rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    rec.onstop = () => {
      clearInterval(tick);
      const blob = new Blob(chunksRef.current, { type: type.split(";")[0] });
      if (!blob.size) { setError("Rekaman kosong."); setStage("error"); return; }
      finish(blob, "video", URL.createObjectURL(blob));
    };
    const max = s.video?.seconds ?? 15;
    const t0 = Date.now();
    const tick = setInterval(() => {
      const el = (Date.now() - t0) / 1000;
      setProgress(Math.min(1, el / max));
      if (el >= max && rec.state === "recording") rec.stop();
    }, 200);
    rec.start(1000);
    recorderRef.current = { stop: () => rec.state === "recording" && rec.stop() };
  }

  // Berhenti merekam kalau layar ditutup
  useEffect(() => () => recorderRef.current?.stop?.(), []);

  const aspect = 16 / 9;
  const elapsedLabel = mode === "video" ? `${Math.round(progress * (s.video?.seconds ?? 15))}s / ${s.video?.seconds ?? 15}s` : `${Math.round(progress * 100)}%`;

  return (
    <div className="kiosk-screen kiosk-screen--dim h-full w-full flex flex-col relative">
      <div className="flex justify-between items-center px-3 sm:px-6 py-2 sm:py-4 gap-2">
        {cap.hideCancel || stage === "processing" ? <span className="w-20" /> : (
          <button onClick={() => setConfirmCancel(true)} className="btn-pop btn-outline text-xs sm:text-base px-4 py-1 whitespace-nowrap">✕ Batal</button>
        )}
        <span className="pill !text-base sm:!text-lg">{TITLE[mode]}{mode === "gif" ? ` ${Math.min(shotCount + 1, gifFrames)}/${gifFrames}` : ""}</span>
        <span className="w-20 flex justify-end text-sm font-mono">{stage === "recording" ? <span className="pill animate-pulse">● REC</span> : ""}</span>
      </div>

      <div className="flex-1 min-h-0 relative flex items-center justify-center p-2">
        <LiveView camera={camera} aspect={aspect} crop={cap.cropLiveview !== false} />
        {camera.error && <p className="absolute font-bold text-sm text-center px-4" style={{ color: "#FFD9DE" }}>{camera.error}</p>}

        {mode === "gif" && seq.phase === "countdown" && <CountdownOverlay count={seq.count} label={`Foto ${shotCount + 1} dari ${gifFrames}`} />}
        {mode === "gif" && seq.phase === "flash" && <div className="absolute inset-0 bg-white/90 flex items-center justify-center text-5xl">📸</div>}
        {mode !== "gif" && count !== null && stage === "shoot" && <CountdownOverlay count={count} label={mode === "video" ? "Bersiap merekam" : "Bersiap, mulai bergerak!"} />}

        {stage === "processing" && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-3">
            <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
            <p className="text-lg">Memproses {TITLE[mode]}...</p>
          </div>
        )}
        {stage === "error" && (
          <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <p className="font-bold text-lg" style={{ color: "#FFD9DE" }}>{error}</p>
            <button onClick={() => dispatch({ type: "CANCEL_SESSION" })} className="btn-pop btn-flash px-8 py-3">Kembali ke Awal</button>
          </div>
        )}
      </div>

      {stage === "recording" && (
        <div className="px-4 py-3 flex flex-col items-center gap-2">
          <div className="w-full max-w-xl h-2 bg-white/20 rounded-full overflow-hidden"><div className="h-full bg-pop-flash" style={{ width: `${progress * 100}%` }} /></div>
          <span className="text-sm font-mono">{elapsedLabel}</span>
          {mode === "video" && <button onClick={() => recorderRef.current?.stop()} className="btn-pop btn-flash px-8 py-3">■ Stop</button>}
        </div>
      )}
      {mode === "gif" && stage === "shoot" && (
        <div className="py-3 flex justify-center gap-2">
          {Array.from({ length: gifFrames }).map((_, i) => <span key={i} className={`w-3 h-3 rounded-full ${i < shotCount ? "bg-pop-flash" : "bg-white/25"}`} />)}
        </div>
      )}

      {confirmCancel && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-4 z-20">
          <div className="modal-card p-6 max-w-sm w-full text-center">
            <p className="display-h3 mb-2">Batalkan sesi?</p>
            <p className="mb-5 text-sm text-[#55606E]">Pembayaran tidak dikembalikan otomatis.</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setConfirmCancel(false)} className="btn-pop btn-outline !border-pop-dark !text-pop-dark px-5 py-2.5">Lanjutkan</button>
              <button onClick={() => { recorderRef.current?.stop?.(); dispatch({ type: "CANCEL_SESSION" }); }} className="btn-pop px-5 py-2.5">Ya, batalkan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
