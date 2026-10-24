import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useKiosk } from "../hooks/useKiosk";
import appConfig from "../config/appConfig";
import { logout } from "../services/authService";

const DEFAULT_LOCK = { position: "top-right", style: "always", opacity: 30, hideAfterSeconds: 4, zoneSize: 96 };

const inCorner = (e, position, zone) => {
  const x = e.clientX, y = e.clientY, w = window.innerWidth, h = window.innerHeight;
  const left = position.endsWith("left"), top = position.startsWith("top");
  return (left ? x <= zone : x >= w - zone) && (top ? y <= zone : y >= h - zone);
};

/**
 * Tombol kunci (gembok) -> PIN. Dipasang di KioskApp, jadi muncul di SEMUA layar booth (Start, template, bayar,
 * sesi foto, editor, hasil, dll), bukan hanya layar Start. Pengaturan di Admin > Tampilan > Tombol Kunci:
 *   - Posisi : 4 pojok layar
 *   - Gaya   : always = selalu terlihat (opasitas diatur) | fade = muncul sebentar tiap pindah layar lalu menghilang
 *              | hidden = tersembunyi total. Gaya fade & hidden dimunculkan dengan mengetuk / menyeret di pojok layar.
 *
 * Area pojok dideteksi lewat pendengar global (BUKAN elemen penutup), jadi tombol lain yang kebetulan ada di pojok
 * (Back, Next, Batal...) tetap bisa ditekan seperti biasa.
 */
export default function KioskLock({ screenKey, inSession }) {
  const navigate = useNavigate();
  const kiosk = useKiosk();
  const lock = { ...DEFAULT_LOCK, ...(appConfig.settings?.display?.lock ?? {}) };
  const [revealed, setRevealed] = useState(false);
  const [choice, setChoice] = useState(false); // pilihan setelah PIN benar (aplikasi .exe)
  const timer = useRef(null);
  const pinOpenRef = useRef(false);
  const revealedAt = useRef(0);
  const shownRef = useRef(false);
  pinOpenRef.current = kiosk.pinOpen;

  const reveal = useCallback(() => {
    // Cap waktu hanya saat gembok BARU muncul. Mengetuk gembok yang sudah terlihat (juga berada di area pojok)
    // hanya memperpanjang waktu tampil, dan tidak boleh membuat ketukan itu dianggap "tembus".
    if (!shownRef.current) revealedAt.current = Date.now();
    shownRef.current = true;
    setRevealed(true);
    clearTimeout(timer.current);
    const arm = () => {
      timer.current = setTimeout(() => {
        if (pinOpenRef.current) return arm(); // selama popup PIN terbuka, gembok tetap ada
        shownRef.current = false;
        setRevealed(false);
      }, lock.hideAfterSeconds * 1000);
    };
    arm();
  }, [lock.hideAfterSeconds]);

  // Gaya "fade": tampil sebentar setiap pindah layar supaya petugas tahu letaknya
  useEffect(() => {
    if (lock.style === "fade") reveal();
    else { clearTimeout(timer.current); shownRef.current = false; setRevealed(false); }
  }, [screenKey, lock.style, reveal]);

  // Ketuk / klik / seret di pojok -> munculkan gembok (gaya fade & hidden)
  useEffect(() => {
    if (lock.style === "always") return;
    function down(e) {
      if (inCorner(e, lock.position, lock.zoneSize)) reveal();
    }
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, [lock.style, lock.position, lock.zoneSize, reveal]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function open() {
    // Di layar sentuh, ketukan yang memunculkan gembok bisa "menembus" ke gembok yang baru muncul di bawah jari
    // dan langsung membuka PIN. Dua langkah yang jelas: ketuk pojok (gembok muncul), baru ketuk gembok (PIN).
    if (!always && Date.now() - revealedAt.current < 450) return;
    // Belum ada PIN: jangan pernah menampilkan menu petugas/tutup aplikasi tanpa pemeriksaan -> arahkan ke login admin (username & password)
    // Login lama dihapus dulu: walau admin sudah login sebelumnya, petugas WAJIB memasukkan username & password lagi.
    if (!appConfig.settings?.general?.pinSet) { logout(); goAdmin(); return; }
    kiosk.requestUnlock(() => {
      // Aplikasi .exe: setelah PIN benar, petugas memilih — buka dashboard admin ATAU tutup aplikasi
      if (window.electronAPI?.kiosk?.quit) setChoice(true);
      else goAdmin();
    }, "PIN untuk membuka menu admin");
  }

  function goAdmin() {
    if (inSession && !confirm("Ada sesi yang sedang berjalan. Membuka menu admin akan membatalkan sesi ini. Lanjutkan?")) return;
    kiosk.exitFullscreen();
    navigate("/admin");
  }

  const always = lock.style === "always";
  const visible = always || revealed;
  const pos = {
    "top-left": { top: 12, left: 12 }, "top-right": { top: 12, right: 12 },
    "bottom-left": { bottom: 12, left: 12 }, "bottom-right": { bottom: 12, right: 12 },
  }[lock.position] ?? { top: 12, right: 12 };

  return (
    <>
    <button
      data-kiosk-control
      onClick={open}
      aria-label="Menu admin"
      tabIndex={visible ? 0 : -1}
      style={{
        position: "fixed", zIndex: 90, width: 44, height: 44, ...pos,
        opacity: visible ? (always ? Math.max(0.05, lock.opacity / 100) : 1) : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity .25s",
      }}
      className="rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center hover:!opacity-100 backdrop-blur-sm"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 11h12v10H6z" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
    </button>

      {choice && (
        <div role="dialog" aria-label="Menu petugas" style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(0,0,0,.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 24, padding: 28, width: "100%", maxWidth: 420, textAlign: "center", boxShadow: "0 12px 40px rgba(0,0,0,.4)" }}>
            <p style={{ margin: "0 0 18px", fontSize: 22, fontWeight: 800, fontStyle: "italic", color: "#181B23" }}>Menu petugas</p>
            <div style={{ display: "grid", gap: 12 }}>
              <button type="button" onClick={() => { setChoice(false); goAdmin(); }} style={{ padding: "14px 0", borderRadius: 999, border: "2px solid #000", background: "#FDB533", fontWeight: 800, fontSize: 18, color: "#3A2E00" }}>Buka dashboard admin</button>
              <button type="button" onClick={() => window.electronAPI.kiosk.quit()} style={{ padding: "14px 0", borderRadius: 999, border: "2px solid #000", background: "#E02843", fontWeight: 800, fontSize: 18, color: "#fff" }}>Tutup aplikasi</button>
              <button type="button" onClick={() => setChoice(false)} style={{ padding: "12px 0", borderRadius: 999, border: "2px solid #C7D0DA", background: "#fff", fontWeight: 700, fontSize: 16, color: "#55606E" }}>Batal</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
