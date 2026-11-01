import React from "react";
import useShape from "../hooks/useShape";
import TemplateDecor from "./TemplateDecor";
import logo from "../assets/logo-popsnap.png";

// Satuan desain: 1 = 1px pada kanvas desain (lihat .strip-screen di index.css)
const U = (n) => `calc(var(--u) * ${n})`;

/**
 * Layar pemberitahuan bergaya "strip" (logo + kartu kuning/putih + tombol besar), responsif di
 * layar lanskap, tegak, dan persegi. Dipakai mis. untuk "Waktu pembayaran habis".
 */
export default function StripNotice({ title, message, actionLabel, onAction, icon = "↩" }) {
  const shape = useShape();
  const L = {
    landscape: { logo: { left: 757, top: 60, width: 214 }, card: { left: 314, top: 230, w: 1100, h: 700 }, fs: 62, ms: 32, btn: { w: 720, h: 104, fs: 42 } },
    portrait: { logo: { left: 410, top: 150, width: 260 }, card: { left: 60, top: 520, w: 960, h: 780 }, fs: 62, ms: 34, btn: { w: 800, h: 120, fs: 46 } },
    square: { logo: { left: 480, top: 60, width: 240 }, card: { left: 100, top: 290, w: 1000, h: 740 }, fs: 58, ms: 32, btn: { w: 760, h: 108, fs: 44 } },
  }[shape];
  const c = L.card;
  return (
    <div className="kiosk-screen strip-screen h-full w-full overflow-hidden" data-shape={shape}>
      <TemplateDecor />
      <div className="strip-stage">
        <img src={logo} alt="PopSnap" draggable={false} className="strip-logo" style={{ left: U(L.logo.left), top: U(L.logo.top), width: U(L.logo.width) }} />
        <div className="strip-panel" style={{ left: U(c.left), top: U(c.top), width: U(c.w), height: U(c.h) }} />
        <div className="strip-tray notice-tray" style={{ left: U(c.left + 18), top: U(c.top + 18), width: U(c.w - 36), height: U(c.h - 36), borderRadius: U(56), gap: U(34), padding: `0 ${U(48)}` }}>
          <div className="notice-clock" style={{ width: U(120), height: U(120), fontSize: U(66) }} aria-hidden="true">⏱</div>
          <h2 className="notice-title" style={{ fontSize: U(L.fs) }}>{title}</h2>
          {message && <p className="notice-msg" style={{ fontSize: U(L.ms) }}>{message}</p>}
          <button onClick={onAction} className="strip-btn strip-btn--back" style={{ width: U(L.btn.w), height: U(L.btn.h), fontSize: U(L.btn.fs), marginTop: U(10) }}>
            <span className="strip-btn__icon" style={{ width: U(L.btn.h * 0.62), height: U(L.btn.h * 0.62), fontSize: U(L.btn.fs * 0.9) }}>{icon}</span>
            <span>{actionLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
