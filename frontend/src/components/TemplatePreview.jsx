import { slotColor } from "../utils/slotColors";
import FilteredImg from "./FilteredImg";
import { STAR_POINTS } from "../utils/composeImage";
import React from "react";

// ==========================================================
// Renderer CSS bersama buat template. Semua ukuran (teks, garis tepi, radius)
// dinyatakan dalam "cqw" (1% lebar kanvas), jadi tampilannya SELALU proporsional
// dengan ukuran tampil berapa pun — dan sama dengan hasil composeImage.js
// (yang merender dalam piksel asli kanvas).
// Container pembungkus WAJIB punya `container-type: inline-size`.
// ==========================================================

export const containerStyle = { containerType: "inline-size" };

export const DEFAULT_SHADOW = { enabled: false, color: "#000000", angle: -45, distance: 10, spread: 20 };

/**
 * Drop shadow ala dslrBooth: angle (derajat, 0 = ke kanan, positif = berlawanan arah jarum jam,
 * jadi -45 = ke kanan-bawah), distance & spread (blur) dalam piksel kanvas.
 * Arah bayangan TETAP (tidak ikut berputar saat layer dirotasi), sama seperti hasil akhir di composeImage.
 */
export function shadowOffsets(shadow) {
  const rad = ((shadow.angle ?? -45) * Math.PI) / 180;
  const d = shadow.distance ?? 10;
  return { dx: Math.cos(rad) * d, dy: -Math.sin(rad) * d };
}

function shadowFilter(layer, canvasWidth) {
  const sh = layer.shadow;
  if (!sh?.enabled || !canvasWidth) return undefined;
  const { dx, dy } = shadowOffsets(sh);
  const cq = (v) => `${(v / canvasWidth) * 100}cqw`;
  return `drop-shadow(${cq(dx)} ${cq(dy)} ${cq(sh.spread ?? 20)} ${sh.color || "#000"})`;
}

/**
 * Pembungkus visual 1 layer. Dibuat 2 lapis supaya bayangan tidak ikut berputar:
 * lapis luar (tidak diputar) membawa opacity + drop-shadow, lapis dalam membawa rotasi.
 */
export function LayerBox({ layer, canvasWidth, children }) {
  return (
    <div style={{
      position: "absolute", left: `${layer.xPct}%`, top: `${layer.yPct}%`, width: `${layer.widthPct}%`, height: `${layer.heightPct}%`,
      opacity: layer.opacity ?? 1, filter: shadowFilter(layer, canvasWidth), pointerEvents: "none",
    }}>
      <div style={{ position: "relative", width: "100%", height: "100%", transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined }}>
        {children}
      </div>
    </div>
  );
}

/** Kotak posisi layer (dengan rotasi) — dipakai untuk area klik/seleksi di Template Editor. */
export function layerBoxStyle(layer) {
  return {
    position: "absolute",
    left: `${layer.xPct}%`,
    top: `${layer.yPct}%`,
    width: `${layer.widthPct}%`,
    height: `${layer.heightPct}%`,
    transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
    opacity: layer.opacity ?? 1,
  };
}

function radiusFor(layer, canvasWidth, canvasHeight) {
  if (layer.shapeKind === "circle") return "50%";
  if (layer.shapeKind === "rounded") {
    // Sama dengan composeImage: 15% dari sisi terpendek
    const minSidePx = Math.min((layer.widthPct / 100) * canvasWidth, (layer.heightPct / 100) * canvasHeight);
    return `${((minSidePx * 0.15) / canvasWidth) * 100}cqw`;
  }
  return "0";
}

/**
 * Isi 1 layer (memenuhi kotak layer). `photoUrl` opsional: kalau ada, slot foto
 * menampilkan foto itu; kalau tidak, menampilkan placeholder bernomor.
 */
export function LayerContent({ layer, canvasWidth, canvasHeight, photoUrl, filter, filterId, mirror }) {
  const radius = radiusFor(layer, canvasWidth, canvasHeight);

  // Garis tepi (Stroke) untuk gambar & slot foto: digambar DI DALAM kotak layer, di atas isinya
  const stroke = (layer.type === "image" || layer.type === "photo-slot") && layer.strokeWidth > 0 ? (
    <div style={{
      position: "absolute", inset: 0, boxSizing: "border-box", pointerEvents: "none", borderRadius: layer.type === "photo-slot" ? radius : 0,
      border: `${(layer.strokeWidth / canvasWidth) * 100}cqw solid ${layer.strokeColor || "#000000"}`,
    }} />
  ) : null;

  if (layer.type === "image") {
    return (
      <>
        {/* objectFit "fill": gambar SELALU memenuhi kotaknya (melar kalau kotak ditarik tidak proporsional), sama seperti dslrBooth.
            Garis seleksi, Stroke, dan Drop Shadow jadi pas dengan tepi gambar. */}
        <img src={layer.imageUrl} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "fill", display: "block", pointerEvents: "none" }} />
        {stroke}
      </>
    );
  }

  if (layer.type === "photo-slot") {
    if (photoUrl) {
      return (
        <>
          {filterId !== undefined ? (
            <FilteredImg src={photoUrl} filterId={filterId} mirror={mirror} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: radius, pointerEvents: "none" }} />
          ) : (
            <img src={photoUrl} alt="" draggable={false}
              style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: radius, filter, transform: mirror ? "scaleX(-1)" : undefined, pointerEvents: "none" }} />
          )}
          {stroke}
        </>
      );
    }
    const sc = slotColor(layer.photoOrder); // warna per nomor foto (palet PopSnap)
    return (
      <>
        <div style={{
          width: "100%", height: "100%", borderRadius: radius, background: sc.bg,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: sc.fg, fontWeight: 700, fontSize: `${(Math.min(layer.widthPct, layer.heightPct) / 100) * 0.35 * 100}cqw`,
        }}>
          {layer.photoOrder}
        </div>
        {stroke}
      </>
    );
  }

  if (layer.type === "shape" && layer.shapeKind === "star") {
    const pts = STAR_POINTS.map(([px, py]) => `${(px * 100).toFixed(2)},${(py * 100).toFixed(2)}`).join(" ");
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}>
        <polygon points={pts} fill={layer.fillColor === "transparent" ? "none" : layer.fillColor} stroke={layer.strokeWidth > 0 ? layer.strokeColor : "none"}
          strokeWidth={layer.strokeWidth > 0 ? `${(layer.strokeWidth / canvasWidth) * 100}cqw` : 0} vectorEffect="non-scaling-stroke" strokeLinejoin="miter" />
      </svg>
    );
  }

  if (layer.type === "shape") {
    return (
      <div style={{
        width: "100%", height: "100%", boxSizing: "border-box", borderRadius: radius,
        background: layer.fillColor === "transparent" ? undefined : layer.fillColor,
        border: layer.strokeWidth > 0 ? `${(layer.strokeWidth / canvasWidth) * 100}cqw solid ${layer.strokeColor}` : undefined,
      }} />
    );
  }

  if (layer.type === "text") {
    return (
      <div style={{
        width: "100%", height: "100%", display: "flex", alignItems: "center", overflow: "visible", whiteSpace: "nowrap",
        justifyContent: layer.align === "left" ? "flex-start" : layer.align === "right" ? "flex-end" : "center",
        color: layer.color, fontFamily: layer.fontFamily, fontWeight: layer.bold ? "bold" : "normal",
        fontStyle: layer.italic ? "italic" : "normal",
        fontSize: `${((layer.fontSize || 48) / canvasWidth) * 100}cqw`, lineHeight: 1,
      }}>
        {layer.text}
      </div>
    );
  }
  return null;
}

/** Preview read-only seluruh template (dipakai di layar pilih template konsumen). */
export default function TemplatePreview({ template, className = "", style }) {
  const w = template?.canvasWidth || 1200;
  const h = template?.canvasHeight || 1800;
  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ ...containerStyle, aspectRatio: `${w} / ${h}`, background: template?.backgroundColor || "#fff", ...style }}
    >
      {(template?.layers ?? []).filter((l) => l.visible !== false).map((layer) => (
        <LayerBox key={layer.id} layer={layer} canvasWidth={w}>
          <LayerContent layer={layer} canvasWidth={w} canvasHeight={h} />
        </LayerBox>
      ))}
    </div>
  );
}
