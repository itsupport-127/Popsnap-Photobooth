import React from "react";

/** Lingkaran kuning kanan-atas: nomor langkah + hitung mundur (elemen khas tema). */
export default function StepBadge({ step, time }) {
  return (
    <div className="step-badge" role="timer">
      <span className="step-badge__num">{step}</span>
      {time !== undefined && time !== null && <span className="step-badge__timer">{time}</span>}
    </div>
  );
}
