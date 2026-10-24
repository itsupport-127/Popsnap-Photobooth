import React from "react";

// Latar bertekstur (feTurbulence) dijadikan layer sendiri: digambar SEKALI, tidak dihitung ulang tiap ada perubahan di atasnya
// (kursor ketik berkedip, tombol ditekan). Tanpa ini PC booth yang lemah bisa macet ±1 detik tiap ketikan/klik.
const LAYER_STYLE = { willChange: "transform", contain: "strict" };
import decorHtml from "./sesiDecorSvg";

/** Latar layar sesi foto (desain "sesi_foto"): biru bertekstur + bintang kiri atas & kanan bawah. */
export default function SesiDecor() {
  return (
    <svg style={LAYER_STYLE}
      className="absolute inset-0 w-full h-full pointer-events-none z-0"
      viewBox="0 0 1728 1117"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: decorHtml }}
    />
  );
}
