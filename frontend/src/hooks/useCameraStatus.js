import { useCallback, useEffect, useRef, useState } from "react";
import appConfig from "../config/appConfig";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

/**
 * Status kamera buat layar depan (Welcome).
 *   checking | ready | notready | denied
 *
 * Webcam: coba buka kamera sekali (memastikan izin + tidak dipakai app lain), langsung dilepas.
 *         Setelah itu cukup pantau lewat enumerateDevices + event devicechange (tanpa menyalakan
 *         lampu kamera berulang-ulang).
 * DSLR (Electron): tanya jembatan DSLR tiap 5 detik.
 */
export default function useCameraStatus() {
  const [state, setState] = useState({ status: "checking", detail: "Mencari kamera..." });
  const aliveRef = useRef(true);
  const modeRef = useRef(appConfig.cameraMode);
  modeRef.current = appConfig.cameraMode;

  const set = (status, detail) => aliveRef.current && setState({ status, detail });

  const probeWebcam = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      return set("notready", "Browser ini tidak mendukung kamera (butuh https atau localhost).");
    }
    try {
      const id = appConfig.settings?.camera?.videoDeviceId;
      const stream = await navigator.mediaDevices.getUserMedia({ video: id ? { deviceId: { ideal: id } } : true, audio: false });
      stream.getTracks().forEach((t) => t.stop());
      set("ready", "Kamera siap");
    } catch (err) {
      if (err.name === "NotAllowedError" || err.name === "SecurityError") set("denied", "Izin kamera ditolak. Izinkan akses kamera di browser.");
      else if (err.name === "NotFoundError" || err.name === "OverconstrainedError") set("notready", "Kamera tidak terdeteksi. Cek kabel USB.");
      else if (err.name === "NotReadableError") set("notready", "Kamera sedang dipakai aplikasi lain.");
      else set("notready", err.message || "Kamera belum siap.");
    }
  }, []);

  const probeDslr = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/camera/dslr/status`).then((x) => x.json());
      if (!r.online) return set("notready", "digiCamControl tidak terdeteksi. Jalankan digiCamControl & aktifkan web server.");
      if (r.virtualOnly) return set("notready", "digiCamControl hanya melihat \"Virtual Webcam\", belum kamera DSLR. Di digiCamControl pilih kamera fisik (mis. Canon EOS) lalu cabut-colok USB.");
      if (r.cameras.length === 0 && r.raw !== undefined && !r.raw) return set("ready", "digiCamControl aktif");
      set(r.cameras.length ? "ready" : "notready", r.cameras.length ? "Kamera DSLR siap" : "Kamera DSLR tidak terdeteksi. Cek kabel USB & nyalakan kamera.");
    } catch {
      set("notready", "Gagal memeriksa kamera DSLR.");
    }
  }, []);

  const check = useCallback(() => {
    set("checking", "Mencari kamera...");
    return modeRef.current === "dslr" ? probeDslr() : probeWebcam();
  }, [probeDslr, probeWebcam]);

  useEffect(() => {
    aliveRef.current = true;
    check();

    let timer;
    const md = navigator.mediaDevices;
    const onChange = async () => {
      if (modeRef.current === "dslr") return;
      try {
        const cams = (await md.enumerateDevices()).filter((d) => d.kind === "videoinput");
        if (cams.length === 0) set("notready", "Kamera tidak terdeteksi. Cek kabel USB.");
        else setState((s) => (s.status === "ready" ? s : (check(), s)));
      } catch { /* abaikan */ }
    };
    md?.addEventListener?.("devicechange", onChange);
    timer = setInterval(() => {
      if (modeRef.current === "dslr") probeDslr(); else onChange();
    }, 5000);

    return () => {
      aliveRef.current = false;
      clearInterval(timer);
      md?.removeEventListener?.("devicechange", onChange);
    };
  }, [check, probeDslr]);

  return { ...state, retry: check };
}
