import React from "react";
import appConfig from "../config/appConfig";

/** Angka hitung mundur besar di tengah layar (warna dari Admin > Tampilan > Countdown Color). */
export default function CountdownOverlay({ count, label }) {
  const color = appConfig.settings?.display?.capture?.countdownColor ?? "#FFFFFF";
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
      <span key={count} className="font-extrabold leading-none animate-[pop_0.9s_ease-out]" style={{ color, fontSize: "clamp(6rem, 30vmin, 20rem)", textShadow: "0 4px 30px rgba(0,0,0,.6)" }}>
        {count}
      </span>
      {label && <span className="mt-2 text-white text-lg sm:text-2xl font-semibold drop-shadow">{label}</span>}
      <style>{`@keyframes pop{0%{transform:scale(1.6);opacity:0}30%{opacity:1}100%{transform:scale(1);opacity:.9}}`}</style>
    </div>
  );
}
