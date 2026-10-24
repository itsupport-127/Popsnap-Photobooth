import React, { useEffect, useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";

const U = (n) => `calc(var(--u) * ${n})`;

/**
 * Bantuan scroll untuk daftar yang bisa digulung: tombol ▲ ▼ + penanda posisi (track).
 * Tombol hanya muncul kalau daftar memang bisa digulung ke arah itu. Ketuk = gulung ±80% tinggi daftar.
 * Dirender sebagai elemen-elemen absolut di dalam panggung (.strip-stage).
 * deps: ubah nilainya (mis. jumlah item) supaya status dihitung ulang.
 */
export default function ScrollButtons({ scrollRef, up, down, track, size = 52, deps }) {
  const [st, setSt] = useState({ canUp: false, canDown: false, thumb: 1, pos: 0 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const calc = () => {
      const max = el.scrollHeight - el.clientHeight;
      setSt({ canUp: el.scrollTop > 4, canDown: el.scrollTop < max - 4, thumb: max > 0 ? el.clientHeight / el.scrollHeight : 1, pos: max > 0 ? el.scrollTop / max : 0, scrollable: max > 4 });
    };
    calc();
    el.addEventListener("scroll", calc, { passive: true });
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", calc); ro.disconnect(); };
  }, [scrollRef, deps]);

  if (!st.scrollable) return null;
  const go = (dir) => { const el = scrollRef.current; if (el) el.scrollBy({ top: dir * el.clientHeight * 0.8, behavior: "smooth" }); };
  const btn = (dir, pos, enabled, Icon, label) => (
    <button type="button" aria-label={label} disabled={!enabled} onClick={() => go(dir)}
      style={{ left: U(pos.left), top: U(pos.top), width: U(size), height: U(size), padding: 0, borderRadius: "50%", background: "#E02843", border: "1px solid #000",
        display: "flex", alignItems: "center", justifyContent: "center", opacity: enabled ? 1 : 0.3, boxShadow: "0 2px 4px rgba(0,0,0,.25)", touchAction: "manipulation" }}>
      <Icon color="#fff" strokeWidth={3.4} style={{ width: U(size * 0.6), height: U(size * 0.6) }} />
    </button>
  );
  return (
    <>
      {btn(-1, up, st.canUp, ChevronUp, "Gulung ke atas")}
      {btn(1, down, st.canDown, ChevronDown, "Gulung ke bawah")}
      {track && (
        <div aria-hidden="true" style={{ left: U(track.left), top: U(track.top), width: U(8), height: U(track.height), borderRadius: 9999, background: "#D9D9D9", pointerEvents: "none" }}>
          <div style={{ position: "absolute", left: 0, width: "100%", borderRadius: 9999, background: "#E02843",
            height: `${Math.max(st.thumb, 0.12) * 100}%`, top: `${st.pos * (1 - Math.max(st.thumb, 0.12)) * 100}%` }} />
        </div>
      )}
    </>
  );
}
