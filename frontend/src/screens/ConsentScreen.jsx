import React from "react";
import appConfig from "../config/appConfig";
import useCountdown from "../hooks/useCountdown";
import useShape from "../hooks/useShape";
import SesiDecor from "../components/SesiDecor";

const U = (n) => `calc(var(--u) * ${n})`;

// Izin foto = bit: 1 = boleh dibagikan di sosmed, 2 = boleh dipajang di mading / toko. 3 = keduanya, 0 = tidak boleh.
const OPTIONS = [
  { value: 3, label: "Keduanya", bg: "#ABDBAB", fg: "#3F4A3F" },
  { value: 1, label: "Sosmed saja", bg: "#FDB939", fg: "#3A2E00" },
  { value: 2, label: "Mading saja", bg: "#FFEAC5", fg: "#3A2E00" },
  { value: 0, label: "Tidak", bg: "#E02843", fg: "#fff" },
];
const DEFAULT_TEXT = "Hai kak! Fotonya boleh kami bagikan di sosmed atau dipajang di mading toko? Pilih yang kakak nyaman ya.";

/**
 * Izin foto — tampil SETELAH pembayaran, SEBELUM layar pengingat / sesi foto (Admin > Umum > Izin Foto).
 * Pilihan: Keduanya / Sosmed saja / Mading saja / Tidak. Folder sesi ditandai & yang diizinkan disalin ke folder khusus content creator.
 * Timer habis = Tidak (lebih aman untuk privasi).
 */
export default function ConsentScreen({ dispatch }) {
  const shape = useShape();
  const c = appConfig.settings?.general?.consent ?? {};
  const secs = c.seconds || 20;
  const answer = (consent) => dispatch({ type: "CONSENT_DONE", payload: { consent } });
  const { remaining } = useCountdown(secs, () => answer(0), true);
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0"), ss = String(remaining % 60).padStart(2, "0");

  const CW = shape === "portrait" ? 1080 : shape === "square" ? 1200 : 1728;
  const CH = shape === "portrait" ? 1800 : shape === "square" ? 1200 : 1117;
  const text = c.text || DEFAULT_TEXT;
  const pw = shape === "landscape" ? 882 : 820, x0 = CW / 2 - pw / 2;
  // Huruf mengecil & kotak teks memanjang mengikuti panjang kalimat, supaya teks tidak pernah terpotong
  const trayW = pw - 104, padX = 50, len = text.length;
  const fs = len <= 50 ? 46 : len <= 90 ? 40 : len <= 140 ? 36 : len <= 200 ? 32 : 28;
  const cpl = Math.max(8, Math.floor((trayW - padX * 2) / (fs * 0.56)));
  const lines = Math.ceil(len / cpl) + (len > 60 ? 1 : 0); // +1 baris cadangan (kata panjang turun baris)
  const trayH = Math.max(206, Math.round(lines * fs * 1.3 + 70));
  const ph = trayH + 194;
  const row = shape === "landscape"; // landscape: 4 tombol sebaris; lainnya: kotak 2x2
  const bw = row ? 300 : 380, bh = 78, gap = 24;
  const gridH = row ? bh : bh * 2 + gap;
  const y0 = CH / 2 - (ph + 48 + gridH) / 2 - 20;
  const by = y0 + ph + 48;
  const pos = (i) => row
    ? { left: CW / 2 - (4 * bw + 3 * gap) / 2 + i * (bw + gap), top: by }
    : { left: CW / 2 - (2 * bw + gap) / 2 + (i % 2) * (bw + gap), top: by + Math.floor(i / 2) * (bh + gap) };

  return (
    <div className="kiosk-screen strip-screen h-full w-full overflow-hidden" data-shape={shape}>
      <div className="absolute inset-0"><SesiDecor /></div>
      <div className="strip-stage">
        <div className="pay-timer" role="timer" style={{ left: U(CW / 2 - 95), top: U(y0 - 100), width: U(190), height: U(54), fontSize: U(32) }}>{mm}.{ss}</div>

        <div className="strip-panel" style={{ left: U(x0), top: U(y0), width: U(pw), height: U(ph), borderRadius: U(57) }} />
        <div className="pay-title" style={{ left: U(x0 + 104), top: U(y0 + 43), width: U(pw - 207), height: U(67), fontSize: U(40) }}>{c.title || "IZIN FOTO"}</div>
        <div className="strip-tray" style={{ left: U(x0 + 52), top: U(y0 + 138), width: U(trayW), height: U(trayH), borderRadius: U(60), display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: `0 ${U(padX)}` }}>
          <span style={{ fontSize: U(fs), fontWeight: 800, lineHeight: 1.25, color: "#000" }}>{text}</span>
        </div>

        {OPTIONS.map((o, i) => (
          <button key={o.value} type="button" className="strip-btn" onClick={() => answer(o.value)}
            style={{ left: U(pos(i).left), top: U(pos(i).top), width: U(bw), height: U(bh), fontSize: U(row ? 34 : 38), background: o.bg, color: o.fg, padding: 0 }}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}
