import React, { useMemo } from "react";
import qrcode from "qrcode-generator";

// Gerbang QR bergaya "bulat" (sesuai desain layar hasil): modul data membulat di sudut luar, mata pojok berupa cincin bulat.
// Isi QR tetap standar (bisa dipindai pembaca QR biasa). Level koreksi default "Q" supaya aman dengan gaya bulat.
const fmt = (n) => Math.round(n * 1000) / 1000;

/** Persegi dengan radius tiap sudut berbeda: [tl, tr, br, bl] */
function rrect(x, y, w, h, [tl, tr, br, bl]) {
  return `M${fmt(x + tl)} ${fmt(y)}H${fmt(x + w - tr)}${tr ? `A${tr} ${tr} 0 0 1 ${fmt(x + w)} ${fmt(y + tr)}` : ""}`
    + `V${fmt(y + h - br)}${br ? `A${br} ${br} 0 0 1 ${fmt(x + w - br)} ${fmt(y + h)}` : ""}`
    + `H${fmt(x + bl)}${bl ? `A${bl} ${bl} 0 0 1 ${fmt(x)} ${fmt(y + h - bl)}` : ""}`
    + `V${fmt(y + tl)}${tl ? `A${tl} ${tl} 0 0 1 ${fmt(x + tl)} ${fmt(y)}` : ""}Z`;
}

export default function RoundedQR({ value, size = 428, level = "Q", color = "#000", rounded = true, style }) {
  const k = rounded ? 1 : 0; // 0 = QR standar persegi (cadangan kalau ada pemindai lama yang sulit membaca gaya bulat)
  const { n, d } = useMemo(() => {
    const qr = qrcode(0, level);
    qr.addData(String(value ?? ""));
    qr.make();
    const n = qr.getModuleCount();
    const dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c);
    const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    let d = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!dark(r, c) || finder(r, c)) continue;
        const up = dark(r - 1, c) && !finder(r - 1, c), dn = dark(r + 1, c) && !finder(r + 1, c);
        const lf = dark(r, c - 1) && !finder(r, c - 1), rt = dark(r, c + 1) && !finder(r, c + 1);
        const R = 0.5 * k;
        // sudut dibulatkan hanya kalau kedua tetangga di sisi sudut itu kosong (bentuk "cairan")
        d += rrect(c, r, 1, 1, [!up && !lf ? R : 0, !up && !rt ? R : 0, !dn && !rt ? R : 0, !dn && !lf ? R : 0]);
      }
    }
    for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      d += rrect(c0, r0, 7, 7, [1.7 * k, 1.7 * k, 1.7 * k, 1.7 * k]) + rrect(c0 + 1, r0 + 1, 5, 5, [0.9 * k, 0.9 * k, 0.9 * k, 0.9 * k]); // cincin (evenodd)
      d += rrect(c0 + 2, r0 + 2, 3, 3, [0.8 * k, 0.8 * k, 0.8 * k, 0.8 * k]);
    }
    return { n, d };
  }, [value, level, k]);

  return (
    <svg viewBox={`0 0 ${n} ${n}`} width={size} height={size} role="img" aria-label="Kode QR" style={style} shapeRendering="geometricPrecision">
      <path d={d} fill={color} fillRule="evenodd" stroke={color} strokeWidth="0.03" />
    </svg>
  );
}
