import React, { useCallback, useEffect, useRef, useState } from "react";
import OnScreenKeyboard from "./OnScreenKeyboard";
import { verifyKioskPin } from "../services/settingsService";

const MAX_LEN = 8;

/**
 * Popup PIN untuk keluar dari layar penuh / membuka menu admin.
 * Bisa diisi DUA cara, tanpa perlu mengklik apa pun dulu:
 *   - keyboard PC : ketik angka (baris atas atau numpad), Backspace = hapus satu, Delete = hapus semua, Enter = Buka, Esc = Batal
 *   - layar sentuh: tombol angka di layar
 */
export default function PinModal({ title = "Masukkan PIN", onSuccess, onCancel }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const pinRef = useRef("");
  const busyRef = useRef(false);
  pinRef.current = pin;
  busyRef.current = busy;

  const submit = useCallback(async () => {
    const value = pinRef.current;
    if (!value || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const r = await verifyKioskPin(value);
    busyRef.current = false;
    setBusy(false);
    if (r.ok) return onSuccess();
    setError(r.error || "PIN salah.");
    setPin("");
  }, [onSuccess]);

  useEffect(() => {
    function onKey(e) {
      // Selama popup terbuka, SEMUA tombol dicegat di fase capture: tombol pemicu Start di layar belakang
      // (Spasi, S, PageUp, PageDown, F13) tidak boleh memulai sesi, dan F11 tidak boleh mengubah layar penuh.
      if (e.ctrlKey || e.altKey || e.metaKey) return; // pintasan sistem tidak diganggu
      e.stopImmediatePropagation();
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        if (busyRef.current) return;
        setError(null);
        setPin((p) => (p.length < MAX_LEN ? p + e.key : p));
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setError(null);
        setPin((p) => p.slice(0, -1));
      } else if (e.key === "Delete") {
        e.preventDefault();
        setPin("");
      } else if (e.key === "Enter") {
        e.preventDefault();
        submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "F11" || e.key === " " || e.key === "PageUp" || e.key === "PageDown" || e.key === "F13") {
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [submit, onCancel]);

  return (
    <div className="fixed inset-0 z-[100] bg-pop-dark/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-card p-6 w-full max-w-xs flex flex-col items-center gap-4">
        <p className="display-h3 text-center">{title}</p>
        <div className="flex gap-2 h-6 items-center" aria-label="PIN">
          {pin.length === 0 ? <span className="text-black/30 text-sm">••••</span> : [...pin].map((_, i) => <span key={i} className="w-3 h-3 rounded-full bg-pop-dark" />)}
        </div>
        <p className={`text-sm h-4 ${error ? "text-pop-pink font-bold" : ""}`} role="alert">{error}</p>
        <OnScreenKeyboard numeric light value={pin} maxLength={MAX_LEN} onChange={(v) => { setPin(v); setError(null); }} />
        <p className="text-[11px] text-black/45 text-center -mt-1">Bisa ketik dari keyboard · Enter = Buka · Esc = Batal</p>
        <div className="flex gap-3 w-full">
          <button onClick={onCancel} className="btn-pop btn-outline !border-pop-dark !text-pop-dark flex-1 py-3">Batal</button>
          <button onClick={submit} disabled={!pin || busy} className="btn-pop btn-flash flex-1 py-3">{busy ? "..." : "Buka"}</button>
        </div>
      </div>
    </div>
  );
}
