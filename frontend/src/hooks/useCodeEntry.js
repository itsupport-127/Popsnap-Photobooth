import { useEffect, useRef } from "react";

/**
 * Pengisian kode (voucher) dari keyboard fisik TANPA harus mengklik kolom isian.
 * Dipakai bersama keyboard layar POPSNAP / keyboard sentuh Windows — semuanya mengisi nilai yang sama.
 *
 *  - Huruf & angka  : ditambahkan ke kode (otomatis huruf besar), sampai maxLength
 *  - Backspace      : hapus satu karakter
 *  - Enter          : kirim (onSubmit)
 *  - Tempel (Ctrl+V / Shift+Insert / klik kanan > Paste): kode ditempel utuh, tanpa harus mengklik kolom
 *
 * Kalau kolom isian sedang fokus dan BISA diketik (mode keyboard Windows / bawaan perangkat), karakter berikutnya
 * dibiarkan ditangani kolom itu sendiri supaya tidak terisi dobel. Popup PIN menahan semua tombol di fase capture,
 * jadi tidak ikut terketik ke sini.
 */
/**
 * Ambil kode dari teks tempelan. Tahan terhadap teks di sekelilingnya (spasi, baris baru, "Kode: ABCD1234").
 * Prioritas: token 8 karakter (panjang kode voucher), lalu token terpanjang yang masih muat, lalu gabungan semuanya.
 */
export function extractCode(text, maxLength = 12) {
  const tokens = String(text ?? "").match(/[A-Za-z0-9]+/g) ?? [];
  if (!tokens.length) return "";
  const pick = tokens.find((t) => t.length === 8) ?? [...tokens].filter((t) => t.length <= maxLength).sort((a, b) => b.length - a.length)[0] ?? tokens.join("");
  return pick.toUpperCase().slice(0, maxLength);
}

export default function useCodeEntry({ active, setValue, maxLength = 12, onSubmit, inputRef }) {
  const latest = useRef({});
  latest.current = { setValue, maxLength, onSubmit };

  useEffect(() => {
    if (!active) return;
    function onKey(e) {
      if (e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
      const input = inputRef.current;
      const focused = input && document.activeElement === input && !input.readOnly;
      const other = document.activeElement?.closest?.("input, textarea, select, [contenteditable]");
      if (other && other !== input) return; // pengguna sedang mengetik di kolom lain

      const { setValue, maxLength, onSubmit } = latest.current;
      if (e.key === "Enter") {
        if (!focused) { e.preventDefault(); onSubmit(); } // saat fokus, onKeyDown kolom yang menangani
      } else if (e.key === "Backspace") {
        if (focused) return;
        e.preventDefault();
        setValue((v) => v.slice(0, -1));
      } else if (/^[a-zA-Z0-9]$/.test(e.key)) {
        if (focused) return;
        e.preventDefault();
        setValue((v) => (v.length < maxLength ? v + e.key.toUpperCase() : v));
        if (input && !input.readOnly) input.focus(); // kolom bisa diketik -> fokuskan supaya ketikan berikutnya langsung ke sana
      }
    }
    function onPaste(e) {
      if (document.querySelector("[role=dialog]")) return; // ada popup (mis. PIN) -> jangan isi kolom di belakangnya
      const other = document.activeElement?.closest?.("input, textarea, select, [contenteditable]");
      if (other && other !== inputRef.current) return;
      const code = extractCode(e.clipboardData?.getData("text"), latest.current.maxLength);
      e.preventDefault(); // kita yang mengisi (kolom bisa readOnly / punya maxLength) — cegah tempel ganda
      if (code) latest.current.setValue(() => code);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("paste", onPaste); };
  }, [active, inputRef]);
}
