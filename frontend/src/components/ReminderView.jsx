import React, { useEffect, useRef, useState } from "react";
import { shapeOf } from "../hooks/useShape";
import TemplateDecor from "./TemplateDecor";
import logo from "../assets/logo-popsnap.png";

/** Isi teks pengingat: {shots}, {retakes}, {frames}, {seconds} diganti angka sebenarnya. */
export function fillReminder(text, vars) {
  return String(text ?? "").replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}

/** Item bawaan untuk mode non-foto (GIF / Boomerang / Video). Mode foto memakai daftar yang diedit admin. */
export function builtinItems(mode, s) {
  const countdown = { text: "Countdown will start after this", sub: "Hitung mundur langsung dimulai setelah ini" };
  if (mode === "gif") return [{ text: `You will get ${s.gif?.frames ?? 4} snapshots for your GIF`, sub: `Kamu akan mendapat ${s.gif?.frames ?? 4} foto untuk GIF-mu` }, countdown];
  if (mode === "boomerang") return [{ text: `We will record ${s.boomerang?.seconds ?? 3} seconds of movement`, sub: `Kami merekam gerakanmu selama ${s.boomerang?.seconds ?? 3} detik — bergeraklah!` }, countdown];
  if (mode === "video") return [{ text: `Your video lasts up to ${s.video?.seconds ?? 15} seconds`, sub: `Videomu berdurasi maksimal ${s.video?.seconds ?? 15} detik` }, countdown];
  return [];
}

// Satuan desain: 1 = 1px pada kanvas 1728x1117, dihitung dari ukuran WADAH (container query) sehingga
// sama-sama benar di layar booth penuh dan di kotak pratinjau admin.
const U = (n) => `calc(var(--u) * ${n})`;

/** "00.08" untuk 8 detik */
export const fmtReminderTimer = (sec) => `${String(Math.floor(sec / 60)).padStart(2, "0")}.${String(sec % 60).padStart(2, "0")}`;

/**
 * Tampilan layar pengingat (dipakai layar booth DAN pratinjau di Admin) — desain "Scan Here / pengingat".
 * Tanpa gambar latar unggahan admin: latar bertekstur + dekorasi + logo PopSnap bawaan.
 * `timerText` = isi pil hitung mundur (opsional), `hint` = tulisan kecil di bawahnya (opsional).
 */
export default function ReminderView({ reminder, items, vars, timerText, hint, className = "" }) {
  const custom = !!reminder.backgroundImage;
  // Bentuk diukur dari WADAH (bukan layar) supaya pratinjau admin juga benar
  const ref = useRef(null);
  const [shape, setShape] = useState("landscape");
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setShape(shapeOf(el.clientWidth || 1, el.clientHeight || 1));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const portrait = shape === "portrait";
  const SW = portrait ? 1080 : shape === "square" ? 1200 : 1728, SH = portrait ? 1800 : shape === "square" ? 1200 : 1117;
  const L = shape === "square"
    ? { logo: { left: 470, top: 90, width: 260 }, panel: { left: 100, top: 590, width: 1000 }, pillMin: 130, title: 38, sub: 27, timer: { left: 520, top: 950 }, hint: { left: 150, width: 900, top: 1040 } }
    : portrait
    ? { logo: { left: 410, top: 90, width: 260 }, panel: { left: 90, top: 820, width: 900 }, pillMin: 150, title: 38, sub: 27, timer: { left: 460, top: 1240 }, hint: { left: 90, width: 900, top: 1330 } }
    : { logo: { left: 129, top: 98, width: 212 }, panel: { left: 237, top: 570, width: 1254 }, pillMin: 106, title: 41, sub: 28, timer: { left: 783, top: 888 }, hint: { left: 437, width: 854, top: 960 } };
  return (
    <div
      ref={ref}
      className={`relative w-full h-full overflow-hidden ${className}`}
      style={{ containerType: "size", background: custom ? `url(${reminder.backgroundImage}) center/cover no-repeat` : undefined }}
    >
      {!custom && <TemplateDecor />}
      <div className="rem-stage" style={{ "--sw": SW, "--sh": SH, "--u": `min(calc(100cqw / ${SW}), calc(100cqh / ${SH}))` }}>
        {(reminder.logoImage || !custom) && (
          <img src={reminder.logoImage || logo} alt="" draggable={false} className="rem-logo" style={{ left: U(L.logo.left), top: U(L.logo.top), width: U(L.logo.width), height: reminder.logoImage ? U(70) : "auto", objectFit: "contain" }} />
        )}

        <div className="rem-panel" style={{ left: U(L.panel.left), top: U(L.panel.top), width: U(L.panel.width), background: reminder.panelColor, color: reminder.textColor, padding: `${U(18)} ${U(22)} ${U(25)}`, gap: U(16.5) }}>
          {items.map((it, i) => (
            <div key={i} className="rem-pill" style={{ minHeight: U(L.pillMin), color: reminder.textColor, padding: `${U(8)} ${U(40)}` }}>
              <p className="rem-pill__title" style={{ fontSize: U(L.title) }}>{fillReminder(it.text, vars)}</p>
              {it.sub && <p className="rem-pill__sub" style={{ fontSize: U(L.sub) }}>{fillReminder(it.sub, vars)}</p>}
            </div>
          ))}
        </div>

        {timerText && <div className="pay-timer rem-timer" role="timer" style={{ left: U(L.timer.left), top: U(L.timer.top), width: U(161), height: U(56), fontSize: U(40) }}>{timerText}</div>}
        {hint && <p className="rem-hint" style={{ left: U(L.hint.left), width: U(L.hint.width), top: U(L.hint.top), fontSize: U(26) }}>{hint}</p>}
      </div>
    </div>
  );
}
