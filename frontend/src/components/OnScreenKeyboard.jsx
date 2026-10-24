import React from "react";

const ALNUM = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M", "⌫"],
];
const NUMERIC = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["C", "0", "⌫"]];

/** Keyboard layar untuk layar sentuh (kode voucher & PIN). Mengubah `value` lewat onChange(string baru). */
export default function OnScreenKeyboard({ value, onChange, maxLength = 20, numeric = false, light = false, scaled = false, keyW = 88, keyH = 58, keyGap = 10, keyFs = 28, keyR = 14, className = "" }) {
  // scaled = ukuran tombol mengikuti satuan desain --u (dipakai layar input voucher)
  const S = (n) => `calc(var(--u) * ${n})`;
  const rows = numeric ? NUMERIC : ALNUM;
  function press(k) {
    if (k === "⌫") return onChange(value.slice(0, -1));
    if (k === "C") return onChange("");
    if (value.length < maxLength) onChange(value + k);
  }
  return (
    <div className={`flex flex-col ${scaled ? "" : "gap-1.5 sm:gap-2"} ${className}`} style={scaled ? { gap: S(keyGap) } : undefined}>
      {rows.map((row, i) => (
        <div key={i} className={`flex justify-center ${scaled ? "" : "gap-1.5 sm:gap-2"}`} style={scaled ? { gap: S(keyGap) } : undefined}>
          {row.map((k) => (
            <button
              key={k}
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => press(k)}
              style={scaled ? { width: S(numeric ? 120 : keyW), height: S(keyH), fontSize: S(keyFs), borderRadius: S(keyR) } : undefined}
              className={`${scaled ? "" : numeric ? "w-16 h-14 sm:w-20 sm:h-16 text-2xl" : "w-8 h-10 sm:w-12 sm:h-12 text-base sm:text-xl"} ${scaled ? "" : "rounded-xl"} border font-bold ${light ? "bg-[#F4F7FA] hover:bg-[#E3EAF1] active:bg-[#D5DCE4] border-black/10 text-pop-dark" : "bg-white/40 hover:bg-white/50 active:bg-white/65 border-white/70 text-white shadow-[0_2px_0_rgba(0,0,0,.25)] [text-shadow:0_1px_2px_rgba(0,0,0,.55)]"}`}
            >
              {k}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
