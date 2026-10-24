import React, { useId, useState } from "react";
import appConfig from "../config/appConfig";
import { effectiveRotation } from "../utils/cameraRotation";

/**
 * Tampilan kamera (live view). Mengikuti pengaturan Admin > Kamera:
 *   - Enable   : kalau mati, video tetap berjalan (perlu untuk memotret) tapi disembunyikan
 *   - Mirror   : membalik tampilan seperti cermin. Prop `mirror` (sesi foto: pilihan tamu) menggantikan pengaturan admin. Foto mentah tidak dibalik; pembalikan dilakukan saat hasil dibuat.
 *   - Rotation : 0/90/180/270 untuk kamera yang dipasang miring; "Orientasi kamera" portrait/landscape memutar 90° otomatis bila perlu
 * `aspect` = rasio kotak tampil (lebar/tinggi). `crop` = potong sesuai kotak itu (Crop Liveview) atau tampilkan utuh.
 * `guide` = rasio (lebar/tinggi) area yang masuk ke template: bagian itu tampil terang, sisanya digelapkan (hanya saat tampil utuh).
 */
export default function LiveView({ camera, aspect, crop = true, fill = false, onAspect, mirror, guide = null, className = "" }) {
  const cfg = appConfig.settings?.camera ?? {};
  const lv = cfg.liveView ?? { enabled: true, mirror: true, rotation: 0 };
  const [dims, setDims] = useState({ w: 0, h: 0 });
  // Kecerahan live view = kurva gamma (mengangkat area gelap), BUKAN pengali linear brightness(): pengali linear ikut membesarkan
  // blok kompresi & noise di area gelap sehingga video tampak "pecah". Gamma menaikkan bayangan tanpa memperbesar blok / membakar highlight.
  const gid = "lvg" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const gain = camera.liveGain || 1;
  const useGamma = Math.abs(gain - 1) > 0.02;
  const exp = (1 / Math.max(0.1, gain)).toFixed(3);
  const rot = effectiveRotation(lv.rotation || 0, cfg.orientation, dims.w, dims.h);
  const sideways = rot === 90 || rot === 270;
  // Kotak ber-container-type:size supaya anak bisa memakai cqw/cqh untuk tukar lebar-tinggi saat dirotasi 90/270
  const boxStyle = fill ? { containerType: "size", width: "100%", height: "100%" } : { containerType: "size", aspectRatio: crop ? aspect : sideways ? "9 / 16" : "16 / 9", height: "100%" };
  // rasio tampilan setelah rotasi (supaya bingkai bisa menyesuaikan dengan kamera asli)
  const report = (w, h) => {
    if (!w || !h) return;
    setDims((d) => (d.w === w && d.h === h ? d : { w, h }));
    if (onAspect) {
      const r = effectiveRotation(lv.rotation || 0, cfg.orientation, w, h);
      onAspect(r === 90 || r === 270 ? h / w : w / h);
    }
  };
  const mediaStyle = {
    position: "absolute", left: "50%", top: "50%",
    width: sideways ? "100cqh" : "100cqw", height: sideways ? "100cqw" : "100cqh",
    transform: `translate(-50%, -50%) rotate(${rot}deg) scaleX(${(mirror ?? lv.mirror) ? -1 : 1})`,
    maxWidth: "none", maxHeight: "none", // Tailwind membatasi video/img ke 100%; saat dirotasi 90° lebar elemen = tinggi kotak, jadi batas itu harus dicabut
    objectFit: crop ? "cover" : "contain", opacity: lv.enabled ? 1 : 0, filter: useGamma ? `url(#${gid})` : undefined, willChange: lv.asIs === true ? undefined : "transform", imageRendering: "auto", // (mode "apa adanya": tanpa will-change supaya browser memperkecil gambar dengan kualitas tinggi, bukan bilinear cepat yang bergerigi/pecah) layer sendiri: frame baru tidak memaksa lukis ulang elemen lain
  };
  // Area potong: persegi panjang berrasio `guide`, di tengah gambar kamera yang tampil utuh (sama dengan pemotongan saat foto dimasukkan ke slot)
  const A = dims.w && dims.h ? (sideways ? dims.h / dims.w : dims.w / dims.h) : 0;
  const showGuide = !!guide && !crop && A > 0 && cfg.liveView?.guide !== false;
  const vwc = `min(100cqw, calc(100cqh * ${A}))`; // lebar gambar kamera yang tampil
  return (
    <div className={`relative overflow-hidden bg-black max-h-full max-w-full ${className}`} style={boxStyle}>
      {useGamma && (
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
          <filter id={gid} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
            <feComponentTransfer>
              <feFuncR type="gamma" amplitude="1" exponent={exp} offset="0" />
              <feFuncG type="gamma" amplitude="1" exponent={exp} offset="0" />
              <feFuncB type="gamma" amplitude="1" exponent={exp} offset="0" />
            </feComponentTransfer>
          </filter>
        </svg>
      )}
      {camera.isDslr ? (
        <img ref={camera.attachImg} crossOrigin="anonymous" src={camera.previewFrame} alt="live view" decoding="async" draggable={false} onError={() => camera.reopen?.()} style={mediaStyle} onLoad={(e) => report(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} />
      ) : (
        <video ref={camera.attachVideo} autoPlay playsInline muted style={mediaStyle}
          onLoadedMetadata={(e) => report(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
          onResize={(e) => report(e.currentTarget.videoWidth, e.currentTarget.videoHeight)} />
      )}
      {showGuide && (() => {
        // Bingkai area template. Dulu pakai box-shadow raksasa (200vmax) yang dilukis ulang di setiap frame live view -> patah-patah.
        // Sekarang: lapisan gelap berlubang (clip-path) yang digambar SEKALI sebagai layer sendiri.
        const gw = `min(${vwc}, calc(${vwc} / ${A} * ${guide}))`;
        const gh = `calc(${gw} / ${guide})`;
        const x1 = `calc(50% - ${gw} / 2)`, x2 = `calc(50% + ${gw} / 2)`, y1 = `calc(50% - ${gh} / 2)`, y2 = `calc(50% + ${gh} / 2)`;
        return (
          <>
            <div aria-hidden="true" style={{
              position: "absolute", inset: 0, pointerEvents: "none", background: "rgba(0,0,0,.5)", willChange: "transform",
              clipPath: `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x1} ${y1}, ${x1} ${y2}, ${x2} ${y2}, ${x2} ${y1}, ${x1} ${y1})`,
            }} />
            <div aria-hidden="true" style={{
              position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", pointerEvents: "none", willChange: "transform",
              width: gw, aspectRatio: String(guide), boxSizing: "border-box", border: "2px solid rgba(255,255,255,.9)", borderRadius: 6,
            }} />
          </>
        );
      })()}
    </div>
  );
}
