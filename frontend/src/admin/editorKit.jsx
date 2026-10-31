import React, { useEffect, useState } from "react";

// ==========================================================
// Komponen kecil + helper untuk Template Editor (tampilan ala dslrBooth).
// ==========================================================

export const PAPERS = [
  { id: "2x6", label: "2 x 6 (strip)", w: 2, h: 6 },
  { id: "4x6", label: "4 x 6 (4R)", w: 4, h: 6 },
  { id: "5x7", label: "5 x 7", w: 5, h: 7 },
  { id: "6x8", label: "6 x 8", w: 6, h: 8 },
  { id: "8x10", label: "8 x 10", w: 8, h: 10 },
  { id: "a4", label: "A4", w: 8.27, h: 11.69 },
  { id: "custom", label: "Custom" },
];
export const DPIS = [150, 200, 300, 600];
export const FONTS = ["sans-serif", "serif", "monospace", "cursive", "Arial", "Georgia", "Impact", "Courier New", "Comic Sans MS"];
export const SHAPES = [
  { id: "rectangle", label: "Kotak" },
  { id: "rounded", label: "Rounded" },
  { id: "circle", label: "Lingkaran" },
  { id: "star", label: "Bintang" }, // hanya untuk layer Shape (slot foto tidak memakainya)
];

export function paperPx(paperId, orientation, dpi) {
  const p = PAPERS.find((x) => x.id === paperId);
  if (!p || !p.w) return null;
  const w = Math.round(p.w * dpi);
  const h = Math.round(p.h * dpi);
  return orientation === "landscape" ? { w: h, h: w } : { w, h };
}

export const UNITS = [
  { id: "px", label: "Pixels" },
  { id: "in", label: "Inches" },
  { id: "cm", label: "Centimeters" },
];
export function fromPx(px, unit, dpi) {
  if (unit === "in") return Math.round((px / dpi) * 100) / 100;
  if (unit === "cm") return Math.round(((px / dpi) * 2.54) * 100) / 100;
  return Math.round(px * 10) / 10;
}
export function toPx(v, unit, dpi) {
  if (unit === "in") return v * dpi;
  if (unit === "cm") return (v / 2.54) * dpi;
  return v;
}

export function layerName(l) {
  if (l.name) return l.name;
  if (l.type === "photo-slot") return `Photo ${l.photoOrder ?? ""}`.trim();
  if (l.type === "text") return `Text: ${(l.text || "").slice(0, 16)}`;
  if (l.type === "shape") return "Shape";
  return "Image";
}

const ICONS = {
  plus: "M3 3h18v18H3z M12 8v8 M8 12h8",
  copy: "M9 9h11v11H9z M5 15H4V4h11v1",
  trash: "M3 6h18 M8 6V4h8v2 M6 6l1 14h10l1-14 M10 10v6 M14 10v6",
  undo: "M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5 M20 9H10a6 6 0 0 0 0 12h3",
  save: "M5 3h11l3 3v15H5z M8 3v6h7V3 M8 21v-7h8v7",
  camera: "M3 7h4l2-3h6l2 3h4v13H3z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  lock: "M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4",
  unlock: "M6 11h12v10H6z M8 11V7a4 4 0 0 1 7-2.6",
  eye: "M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff: "M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z M3 3l18 18",
  image: "M3 4h18v16H3z M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M21 16l-5-5-9 9",
  text: "M5 5h14 M12 5v14 M9 19h6",
  shape: "M3 3h8v8H3z M17 21a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  chevD: "M6 9l6 6 6-6",
  chevR: "M9 6l6 6-6 6",
  up: "M12 19V5 M5 12l7-7 7 7",
  down: "M12 5v14 M5 12l7 7 7-7",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-4 4-6 8-6s8 2 8 6",
  star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.2 6.5 20.2l1-6.2L3 9.6l6.2-.9z",
  close: "M5 5l14 14 M19 5L5 19",
  download: "M12 3v12 M7 10l5 5 5-5 M4 20h16",
  upload: "M12 15V3 M7 8l5-5 5 5 M4 20h16",
  printer: "M6 9V3h12v6 M6 18H4v-7h16v7h-2 M6 14h12v7H6z",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5 M12 7v5l3 2",
  home: "M3 11l9-8 9 8 M5 10v10h5v-6h4v6h5V10",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z",
  wallet: "M3 7h16a2 2 0 0 1 2 2v10H5a2 2 0 0 1-2-2z M3 7V5a2 2 0 0 1 2-2h12v4 M16 14h2",
  sticker: "M20 12V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6 M20 12l-8 8v-6a2 2 0 0 1 2-2h6z",
  ticket: "M3 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v2h18v-2a2 2 0 0 1 0-4v0a2 2 0 0 0 0-4V6H3z M13 6v12",
  wrench: "M14 6a4 4 0 0 0 5 5l-9 9a2.1 2.1 0 0 1-3-3l9-9a4 4 0 0 0-2-2z",
  help: "M12 17v.01 M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
  logout: "M9 4H4v16h5 M16 8l4 4-4 4 M20 12H9",
  check: "M5 12l5 5L20 7",
  refresh: "M20 11a8 8 0 0 0-14-4L4 9 M4 4v5h5 M4 13a8 8 0 0 0 14 4l2-2 M20 20v-5h-5",
  // Align & distribute
  alignTop: "M3 3h18 M6 6h4v12H6z M14 6h4v7h-4z",
  alignMiddle: "M3 12h18 M6 5h4v14H6z M14 8h4v8h-4z",
  alignBottom: "M3 21h18 M6 7h4v14H6z M14 12h4v9h-4z",
  alignLeft: "M3 3v18 M6 6h12v4H6z M6 14h7v4H6z",
  alignCenter: "M12 3v18 M5 6h14v4H5z M8 14h8v4H8z",
  alignRight: "M21 3v18 M6 6h12v4H6z M11 14h7v4h-7z",
  distV: "M3 3h18 M3 21h18 M7 9h10v6H7z",
  distH: "M3 3v18 M21 3v18 M9 7h6v10H9z",
};

export function Icon({ name, size = 18, className = "", fill = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {(ICONS[name] || "").split(" M").map((d, i) => <path key={i} d={(i === 0 ? "" : "M") + d} />)}
    </svg>
  );
}

export const inputCls = "bg-[#F4F7FA] border border-[#C7D0DA] text-[#181B23] px-2 py-1 text-[13px] w-full outline-none focus:border-[#4082AE] disabled:opacity-40";

export function PanelHeader({ children }) {
  return <div className="px-4 py-2.5 text-[13px] text-[#262A38] tracking-wide">{children}</div>;
}

export function Field({ label, children, className = "" }) {
  return (
    <label className={`flex flex-col gap-1 text-[12px] text-[#262A38] ${className}`}>
      {label}
      {children}
    </label>
  );
}

/** Input angka yang tetap bisa diketik bebas (kosong/sementara tidak valid), commit tiap angka valid. */
export function NumInput({ value, onCommit, step = 1, min, disabled, className = "" }) {
  const [text, setText] = useState(String(value));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(String(value)); }, [value, focus]);

  function commit(n) {
    if (min !== undefined && n < min) n = min;
    onCommit(n);
  }
  return (
    <input
      type="text" inputMode="decimal" disabled={disabled}
      value={focus ? text : String(value)}
      onFocus={() => { setText(String(value)); setFocus(true); }}
      onBlur={() => setFocus(false)}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseFloat(e.target.value);
        if (!isNaN(n)) commit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const n = (parseFloat(text) || 0) + (e.key === "ArrowUp" ? step : -step);
          setText(String(Math.round(n * 100) / 100));
          commit(n);
        }
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={`${inputCls} ${className}`}
    />
  );
}

export function ToolbarButton({ icon, label, onClick, disabled, active }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex flex-col items-center gap-1 px-2.5 py-1 text-[13px] hover:text-[#E02843] disabled:opacity-30 disabled:hover:text-[#262A38] ${active ? "text-[#181B23]" : "text-[#262A38]"}`}>
      <Icon name={icon} size={26} />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

export function Modal({ title, onClose, children, width = "w-[460px]" }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onPointerDown={onClose}>
      <div className={`${width} max-w-full max-h-[90vh] overflow-y-auto bg-[#F4F7FA] border border-[#C7D0DA] text-[#181B23]`} onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#D5DCE4]">
          <h3 className="text-sm">{title}</h3>
          <button onClick={onClose} className="text-[#55606E] hover:text-[#E02843]"><Icon name="close" size={16} /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

/** Baris slider ala dslrBooth: label di kiri, slider, nilai + satuan di kanan. */
export function SliderRow({ label, value, min, max, step = 1, unit = "px", onChange, disabled }) {
  return (
    <div className={`flex items-center gap-2 text-[12px] ${disabled ? "opacity-40" : ""}`}>
      <span className="w-[74px] flex-shrink-0 text-[#262A38]">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 min-w-0" />
      <span className="w-[52px] text-right text-[#181B23] tabular-nums">{value}{unit}</span>
    </div>
  );
}

export function ColorRow({ label, value, onChange, disabled }) {
  return (
    <div className={`flex items-center gap-2 text-[12px] ${disabled ? "opacity-40" : ""}`}>
      <span className="w-[74px] flex-shrink-0 text-[#262A38]">{label}</span>
      <input type="color" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="h-8 flex-1 min-w-0 bg-transparent border border-[#C7D0DA] p-0.5 cursor-pointer" />
    </div>
  );
}
