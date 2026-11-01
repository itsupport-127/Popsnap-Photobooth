import React from "react";
import { Icon } from "./editorKit";

export function Page({ title, subtitle, children, right }) {
  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="display-h2 !text-[1.6rem] text-[#181B23]">{title}</h1>
          {subtitle && <p className="text-[13px] text-[#55606E] mt-1">{subtitle}</p>}
        </div>
        {right}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

export function Card({ title, hint, children, className = "" }) {
  return (
    <section data-card className={`bg-white border border-[#D5DCE4] rounded-[20px] overflow-hidden shadow-[0_2px_10px_rgba(24,27,35,0.06)] ${className}`}>
      {title && (
        <div className="px-4 py-3 border-b border-[#D5DCE4]">
          <h2 className="text-[14px] font-extrabold italic text-[#181B23] tracking-wide">{title}</h2>
          {hint && <p className="text-[12px] text-[#6B7684] mt-0.5">{hint}</p>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Btn({ children, onClick, disabled, variant = "default", className = "", type = "button" }) {
  const styles = {
    default: "bg-white hover:bg-[#F4F7FA] text-[#181B23] border border-[#C7D0DA]",
    primary: "bg-[#E02843] hover:bg-[#B81E36] text-white border border-black/50 shadow-pop",
    danger: "bg-[#181B23] hover:bg-[#262A38] text-white border border-black/50",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`px-4 py-2 text-[13px] font-bold italic rounded-full disabled:opacity-40 transition-colors ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Notice({ tone = "info", children }) {
  const tones = {
    info: "border-[#4082AE] bg-[#E3EEF6] text-[#305067]",
    warn: "border-[#FFD23F] bg-[#FFF6D6] text-[#3A2E00]",
    ok: "border-[#1FA997] bg-[#E6F6EE] text-[#0F5C52]",
    error: "border-[#E02843] bg-[#FDE8EB] text-[#B81E36]",
  }[tone];
  return <div className={`border-l-4 rounded-r-xl px-3 py-2 text-[13px] ${tones}`}>{children}</div>;
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1" />
      <span>
        <span className="text-[13px] text-[#181B23]">{label}</span>
        {hint && <span className="block text-[12px] text-[#6B7684]">{hint}</span>}
      </span>
    </label>
  );
}

export function StatusDot({ on, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px]">
      <span className={`w-2 h-2 rounded-full ${on ? "bg-[#1FA997]" : "bg-[#E02843]"}`} />
      {label}
    </span>
  );
}

export function useSavedFlag() {
  const [saved, setSaved] = React.useState(false);
  const flash = React.useCallback(() => { setSaved(true); setTimeout(() => setSaved(false), 1800); }, []);
  return [saved, flash];
}

export { Icon };
