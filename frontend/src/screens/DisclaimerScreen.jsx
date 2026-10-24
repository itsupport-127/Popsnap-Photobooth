import React from "react";
import appConfig from "../config/appConfig";

/** Persetujuan ketentuan. Menolak = sesi dibatalkan (belum ada pembayaran/foto yang terpakai). */
export default function DisclaimerScreen({ dispatch }) {
  const d = appConfig.settings?.general?.disclaimer ?? {};
  return (
    <div className="kiosk-screen h-full w-full flex items-center justify-center p-4 sm:p-8">
      <div className="modal-card w-full max-w-2xl p-6 sm:p-10 flex flex-col gap-5">
        <h2 className="display-h2 text-center">{d.header}</h2>
        <p className="text-sm sm:text-lg leading-relaxed whitespace-pre-line max-h-[45vh] overflow-y-auto text-[#55606E]">{d.text}</p>
        <div className="flex gap-4">
          <button onClick={() => dispatch({ type: "DISCLAIMER_DECLINE" })} className="btn-pop btn-outline !border-pop-dark !text-pop-dark flex-1 py-3 sm:py-4 text-base sm:text-xl">Tidak Setuju</button>
          <button onClick={() => dispatch({ type: "DISCLAIMER_ACCEPT" })} className="btn-pop flex-1 py-3 sm:py-4 text-base sm:text-xl">Setuju</button>
        </div>
      </div>
    </div>
  );
}
