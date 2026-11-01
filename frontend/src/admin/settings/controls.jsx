import React, { useRef, useState } from "react";
import { uploadSettingsAsset, API_BASE } from "../../services/settingsService";
import { inputCls } from "../editorKit";
import { Btn } from "../ui";

/** Baris pengaturan gaya dslrBooth: label di kiri (rata kanan), kontrol di kanan, keterangan kecil di bawahnya. */
export function Row({ label, hint, children }) {
  return (
    <div data-row className="grid grid-cols-[210px_1fr] gap-x-4 items-start py-1.5">
      <div className="text-[13px] text-[#181B23] text-right pt-1.5">{label}</div>
      <div className="min-w-0">
        {children}
        {hint && <p className="text-[12px] text-[#6B7684] mt-1">{hint}</p>}
      </div>
    </div>
  );
}

export function Check({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={`flex items-start gap-2 cursor-pointer pt-1.5 ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
      <input type="checkbox" className="mt-0.5" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-[13px] text-[#181B23]">{label}{hint && <span className="block text-[12px] text-[#6B7684]">{hint}</span>}</span>
    </label>
  );
}

export function Select({ value, onChange, options, className = "" }) {
  return (
    <select className={`${inputCls} ${className}`} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export function Color({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-8 w-20 bg-transparent border border-[#C7D0DA] p-0.5 cursor-pointer" />
      <span className="text-[12px] text-[#6B7684] font-mono">{value}</span>
    </div>
  );
}

export function Range({ value, min, max, step = 1, unit = "", onChange, width = "w-72" }) {
  return (
    <div className="flex items-center gap-3 pt-1.5">
      <input type="range" className={width} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="text-[13px] text-[#181B23] tabular-nums w-14">{value}{unit}</span>
    </div>
  );
}

/** Pilih gambar dari komputer -> diunggah ke backend -> disimpan sebagai alamat /uploads/... (tombol Browse / Clear). */
export function ImagePicker({ value, onChange, onError }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  async function pick(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const r = await uploadSettingsAsset(file);
      if (r) onChange(r.url);
    } catch (err) { onError?.(err.message); }
    finally { setBusy(false); }
  }
  const src = value ? (value.startsWith("http") ? value : `${API_BASE}${value}`) : null;
  return (
    <div className="flex items-center gap-2">
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={pick} className="hidden" />
      {src && <img src={src} alt="" className="h-10 w-16 object-cover border border-[#C7D0DA]" />}
      <input readOnly className={inputCls} value={value ? decodeURIComponent(value.split("/").pop()) : ""} placeholder="(belum ada gambar)" />
      <Btn onClick={() => ref.current.click()} disabled={busy}>{busy ? "..." : "Browse"}</Btn>
      <Btn onClick={() => onChange("")} disabled={!value}>Clear</Btn>
    </div>
  );
}
