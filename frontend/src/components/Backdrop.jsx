import React from "react";

// Latar bertekstur (feTurbulence) dijadikan layer sendiri: digambar SEKALI, tidak dihitung ulang tiap ada perubahan di atasnya
// (kursor ketik berkedip, tombol ditekan). Tanpa ini PC booth yang lemah bisa macet ±1 detik tiap ketikan/klik.
const LAYER_STYLE = { willChange: "transform", contain: "strict" };

/**
 * Tekstur grain yang dipakai SEMUA layar kiosk (resep feTurbulence yang sama dengan tema),
 * jadi seluruh aplikasi duduk di satu latar biru bertekstur. Diletakkan sekali di root kiosk.
 */
export default function Backdrop() {
  return (
    <svg style={LAYER_STYLE} className="absolute inset-0 w-full h-full pointer-events-none z-0" aria-hidden="true">
      <defs>
        <filter id="noiseDarkGlobal">
          <feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves="2" result="noise" />
          <feColorMatrix type="matrix" values="0 0 0 0 0.17  0 0 0 0 0.33  0 0 0 0 0.47  0 0 0 0.75 0" />
        </filter>
        <filter id="noiseLightGlobal">
          <feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves="2" result="noise" />
          <feColorMatrix type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.66  0 0 0 0 0.83  0 0 0 0.55 0" />
        </filter>
      </defs>
      <rect width="100%" height="100%" filter="url(#noiseDarkGlobal)" style={{ mixBlendMode: "multiply" }} />
      <rect width="100%" height="100%" filter="url(#noiseLightGlobal)" style={{ mixBlendMode: "soft-light" }} />
    </svg>
  );
}
