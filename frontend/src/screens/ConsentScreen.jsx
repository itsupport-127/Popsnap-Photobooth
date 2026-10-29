import React from "react";
import appConfig from "../config/appConfig";
import useCountdown from "../hooks/useCountdown";
import useShape from "../hooks/useShape";
import SesiDecor from "../components/SesiDecor";

const U = (n) => `calc(var(--u) * ${n})`;

/**
 * Izin foto (sosmed / dipajang di toko) — tampil SETELAH pembayaran, SEBELUM layar pengingat / sesi foto (Admin > Umum > Izin Sosmed).
 * Boleh -> folder sesi ditandai BOLEH-SOSMED dan disalin ke folder khusus content creator. Tidak / timer habis -> TIDAK.
 */
export default function ConsentScreen({ dispatch }) {
  const shape = useShape();
  const c = appConfig.settings?.general?.consent ?? {};
  const secs = c.seconds || 20;
  const answer = (allowed) => dispatch({ type: "CONSENT_DONE", payload: { allowed } });
  const { remaining } = useCountdown(secs, () => answer(false), true); // tidak dijawab = tidak boleh (lebih aman untuk privasi)
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0"), ss = String(remaining % 60).padStart(2, "0");

  const CW = shape === "portrait" ? 1080 : shape === "square" ? 1200 : 1728;
  const CH = shape === "portrait" ? 1800 : shape === "square" ? 1200 : 1117;
  const pw = shape === "landscape" ? 882 : 820, ph = 400, x0 = CW / 2 - pw / 2, y0 = CH / 2 - 250;

  return (
    <div className="kiosk-screen strip-screen h-full w-full overflow-hidden" data-shape={shape}>
      <div className="absolute inset-0"><SesiDecor /></div>
      <div className="strip-stage">
        <div className="pay-timer" role="timer" style={{ left: U(CW / 2 - 95), top: U(y0 - 130), width: U(190), height: U(54), fontSize: U(32) }}>{mm}.{ss}</div>

        <div className="strip-panel" style={{ left: U(x0), top: U(y0), width: U(pw), height: U(ph), borderRadius: U(57) }} />
        <div className="pay-title" style={{ left: U(x0 + 104), top: U(y0 + 43), width: U(pw - 207), height: U(67), fontSize: U(40) }}>{c.title || "IZIN FOTO"}</div>
        <div className="strip-tray" style={{ left: U(x0 + 52), top: U(y0 + 138), width: U(pw - 104), height: U(206), borderRadius: U(60), display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: `0 ${U(50)}` }}>
          <span style={{ fontSize: U(shape === "landscape" ? 44 : 40), fontWeight: 800, lineHeight: 1.25, color: "#000" }}>{c.text || "Hai kak! Boleh fotonya kami bagikan di sosmed atau dipajang di mading toko? Pilih saja, boleh atau tidak sama-sama tidak masalah."}</span>
        </div>

        <button type="button" className="strip-btn" onClick={() => answer(true)} style={{ left: U(CW / 2 - 290), top: U(y0 + ph + 48), width: U(260), height: U(69), fontSize: U(40), background: "#ABDBAB", color: "#565656" }}>Boleh</button>
        <button type="button" className="strip-btn" onClick={() => answer(false)} style={{ left: U(CW / 2 + 30), top: U(y0 + ph + 48), width: U(260), height: U(69), fontSize: U(40), background: "#E02843", color: "#fff" }}>Tidak</button>
      </div>
    </div>
  );
}
