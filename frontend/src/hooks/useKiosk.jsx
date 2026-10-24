import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PinModal from "../components/PinModal";
import appConfig from "../config/appConfig";
import { logout } from "../services/authService";

// ==========================================================
// Mode kiosk: layar penuh (seperti F11) + PIN untuk keluar.
//
//  - Klik Start / tombol layar penuh  -> masuk layar penuh.
//  - Keluar layar penuh: ikon gembok atau tombol F11 -> minta PIN (kalau PIN diatur).
//  - Di aplikasi desktop (.exe) layar penuh dikendalikan Electron (window.electronAPI.kiosk).
//  - Di browser: Fullscreen API + Keyboard Lock. KETERBATASAN BROWSER: tombol Esc tidak bisa diblokir
//    sepenuhnya (di Chrome harus ditahan ±2 detik). Karena itu, begitu keluar tanpa PIN,
//    ketukan berikutnya di layar booth otomatis masuk layar penuh lagi. Untuk kunci yang benar-benar
//    rapat, pakai aplikasi desktop.
// ==========================================================

const KioskContext = createContext(null);
export const useKiosk = () => useContext(KioskContext);

const electronKiosk = () => (typeof window !== "undefined" ? window.electronAPI?.kiosk : undefined);

export function KioskProvider({ children }) {
  const [fullscreen, setFullscreen] = useState(false);
  const [pinRequest, setPinRequest] = useState(null); // { title, onSuccess }
  const suspendedRef = useRef(false); // true setelah admin sengaja membuka kunci (jangan paksa masuk layar penuh lagi)
  const fsRef = useRef(false);
  const pendingRef = useRef(false); // cegah permintaan layar penuh ganda (pointerdown + click) yang membuat browser menolak
  const { pathname } = useLocation();
  const navigate = useNavigate();
  fsRef.current = fullscreen;

  const refreshFs = useCallback(async () => {
    const k = electronKiosk();
    setFullscreen(k ? !!(await k.isFullscreen()) : !!document.fullscreenElement);
  }, []);

  useEffect(() => {
    refreshFs();
    const k = electronKiosk();
    document.addEventListener("fullscreenchange", refreshFs);
    const off = k?.onFullscreenChange?.(refreshFs);
    return () => { document.removeEventListener("fullscreenchange", refreshFs); off?.(); };
  }, [refreshFs]);

  const enterFullscreen = useCallback(async () => {
    suspendedRef.current = false;
    if (pendingRef.current) return;
    pendingRef.current = true;
    const k = electronKiosk();
    try {
      if (k) await k.setFullscreen(true);
      else if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen({ navigationUI: "hide" });
        navigator.keyboard?.lock?.(["Escape", "F11"]).catch(() => {}); // Chromium: tahan Esc 2 detik untuk keluar
      }
    } catch { /* browser menolak (butuh gestur pengguna) — abaikan */ }
    pendingRef.current = false;
    refreshFs();
  }, [refreshFs]);

  const exitFullscreen = useCallback(async () => {
    suspendedRef.current = true;
    const k = electronKiosk();
    try {
      if (k) await k.setFullscreen(false);
      else {
        navigator.keyboard?.unlock?.();
        if (document.fullscreenElement) await document.exitFullscreen();
      }
    } catch { /* abaikan */ }
    refreshFs();
  }, [refreshFs]);

  /** Jalankan onSuccess setelah PIN benar. Tanpa PIN terpasang -> langsung jalan. */
  const requestUnlock = useCallback((onSuccess, title) => {
    if (!appConfig.settings?.general?.pinSet) return onSuccess();
    setPinRequest({ onSuccess, title });
  }, []);

  // F11: tidak di layar penuh -> masuk; sedang di layar penuh -> minta PIN dulu baru keluar
  useEffect(() => {
    function toggle() {
      if (!fsRef.current) enterFullscreen();
      else requestUnlock(exitFullscreen, "PIN untuk keluar dari layar penuh");
    }
    function onKey(e) {
      if (e.key !== "F11") return;
      e.preventDefault();
      toggle();
    }
    window.addEventListener("keydown", onKey);
    const off = electronKiosk()?.onF11?.(toggle); // Electron meneruskan F11 ke sini (sudah dicegat di sisi main)
    return () => { window.removeEventListener("keydown", onKey); off?.(); };
  }, [enterFullscreen, exitFullscreen, requestUnlock]);

  // Tombol close / Alt+F4 / tray "Keluar" (aplikasi .exe): TIDAK langsung menutup. Wajib PIN admin; kalau PIN belum dibuat,
  // diarahkan ke halaman login admin (butuh username & password) — tamu tidak pernah bisa menutup aplikasi begitu saja.
  useEffect(() => {
    const k = electronKiosk();
    const off = k?.onRequestQuit?.(() => {
      if (appConfig.settings?.general?.pinSet) setPinRequest({ title: "PIN untuk keluar dari aplikasi", onSuccess: () => k.quit() });
      else { logout(); exitFullscreen(); navigate("/admin"); } // tanpa PIN: wajib login ulang, walau sebelumnya sudah login
    });
    return () => off?.();
  }, [exitFullscreen, navigate]);

  // Aplikasi .exe: dashboard admin otomatis tertutup & logout bila tidak disentuh 10 menit, lalu kembali ke layar booth penuh
  // (admin yang lupa menutup tidak membuka pintu ke pengaturan untuk pelanggan berikutnya)
  useEffect(() => {
    if (!electronKiosk() || !pathname.startsWith("/admin")) return undefined;
    let t;
    const arm = () => {
      clearTimeout(t);
      t = setTimeout(() => { logout(); navigate("/"); enterFullscreen(); }, 10 * 60 * 1000);
    };
    arm();
    const evs = ["pointerdown", "keydown", "wheel", "touchstart"];
    evs.forEach((e) => window.addEventListener(e, arm, true));
    return () => { clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, arm, true)); };
  }, [pathname, navigate, enterFullscreen]);

  // Keluar tanpa PIN (mis. Esc di browser) -> ketukan berikutnya di layar booth masuk layar penuh lagi
  useEffect(() => {
    if (pathname !== "/") return;
    function relock(e) {
      // Ketukan pada ikon gembok / layar penuh adalah aksi sengaja (membuka PIN), bukan "ketukan tamu" — jangan paksa layar penuh
      if (e?.target?.closest?.("[data-kiosk-control]")) return;
      if (!fsRef.current && !suspendedRef.current && appConfig.settings?.general?.pinSet && appConfig.settings?.display?.autoFullscreen) enterFullscreen();
    }
    window.addEventListener("pointerdown", relock, true);
    return () => window.removeEventListener("pointerdown", relock, true);
  }, [pathname, enterFullscreen]);

  return (
    <KioskContext.Provider value={{ fullscreen, enterFullscreen, exitFullscreen, requestUnlock, pinOpen: !!pinRequest }}>
      {children}
      {pinRequest && (
        <PinModal
          title={pinRequest.title}
          onCancel={() => setPinRequest(null)}
          onSuccess={() => { const fn = pinRequest.onSuccess; setPinRequest(null); fn(); }}
        />
      )}
    </KioskContext.Provider>
  );
}
