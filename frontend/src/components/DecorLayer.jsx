import React from "react";

const STAR_L = "M 0 -115 L 14 -22 L 95 -75 L 24 0 L 110 32 L 20 20 L 38 105 L 0 24 L -38 105 L -20 20 L -110 32 L -24 0 L -95 -75 L -14 -22 Z";
const STAR_R = "M 0 -140 L 18 -28 L 120 -85 L 30 0 L 135 42 L 24 24 L 46 130 L 0 28 L -46 130 L -24 24 L -135 42 L -30 0 L -120 -85 L -18 -28 Z";

/**
 * Dekorasi vektor tema (blob oranye, bintang, pita pink, lengkung putih, blob kuning).
 * `variant="full"` untuk layar Start; `variant="soft"` = lebih transparan untuk layar lain.
 */
export default function DecorLayer({ variant = "full", className = "" }) {
  const soft = variant === "soft";
  const id = soft ? "S" : "F";
  return (
    <svg className={`absolute inset-0 w-full h-full pointer-events-none z-0 ${className}`} viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id={`gradOrangeBlob${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#E75026" /><stop offset="50%" stopColor="#EF892A" /><stop offset="100%" stopColor="#F7CE46" />
        </linearGradient>
        <radialGradient id={`gradStarLeft${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" /><stop offset="40%" stopColor="#FFF3BA" /><stop offset="100%" stopColor="#F5A422" />
        </radialGradient>
        <radialGradient id={`gradStarRight${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" /><stop offset="30%" stopColor="#FFF5BE" /><stop offset="100%" stopColor="#F6AC23" />
        </radialGradient>
      </defs>
      <g opacity={soft ? 0.9 : 1}>
        <path d="M -50 -50 L 190 -50 C 240 60, 180 180, 110 260 C 40 340, 90 470, -50 470 Z" fill={`url(#gradOrangeBlob${id})`} />
        <g transform="translate(110, 240) rotate(-5)"><path d={STAR_L} fill={`url(#gradStarLeft${id})`} /></g>
        <g transform="translate(850, 0)">
          <path d="M 0 50 C 140 -20, 260 90, 360 20 C 420 -20, 380 140, 290 120 C 230 110, 260 220, 380 180 C 460 150, 480 250, 560 200" stroke="#F4ACDB" strokeWidth="12" strokeLinecap="round" fill="none" />
          <path d="M 120 40 C 200 80, 280 10, 420 50" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" fill="none" />
        </g>
        <g transform="translate(0, 620)">
          <path d="M -20 160 Q 140 210, 180 90 T 310 140" stroke="#FFFFFF" strokeWidth="9" strokeLinecap="round" fill="none" />
          <path d="M 10 210 Q 110 110, 220 200" stroke="#F5B5E1" strokeWidth="11" strokeLinecap="round" fill="none" />
        </g>
        <g transform="translate(1000, 420)">
          <path d="M 500 80 C 350 80, 260 200, 280 320 C 300 400, 380 480, 500 480 Z" fill="#F8DF63" opacity="0.95" />
          <g transform="translate(260, 270) rotate(-18)"><path d={STAR_R} fill={`url(#gradStarRight${id})`} /></g>
        </g>
      </g>
    </svg>
  );
}
