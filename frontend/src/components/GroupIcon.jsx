import React from "react";
import { TYPE_ICONS } from "./typeIcons";
import { PRESET_ICONS } from "./categoryIcons";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

// Ikon untuk kategori yang belum punya ikon (buatan admin): bingkai foto sederhana, gaya garis putih seperti ikon lain
const FALLBACK = '<g fill="none" stroke="#fff" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"><rect x="62" y="60" width="143" height="190" rx="14"/><circle cx="110" cy="112" r="15"/><path d="M62 215 L112 165 L150 198 L205 140"/></g>';

/**
 * Ikon kartu tipe template. Menutupi seluruh kartu (koordinat = ukuran kartu di desain),
 * jadi posisinya persis seperti di desain dan ikut membesar/mengecil bersama kartu.
 * `category` = { id, icon?, iconWhite? }. Urutan: gambar unggahan > ikon galeri > ikon desain bawaan (per id) > bingkai foto.
 */
export default function GroupIcon({ category }) {
  const { id, icon, iconWhite = true } = category || {};

  if (typeof icon === "string" && icon.startsWith("upload:")) {
    return (
      <img
        className="type-card__upload"
        src={`${API_BASE}${icon.slice(7)}`}
        alt=""
        draggable={false}
        style={iconWhite ? { filter: "brightness(0) invert(1)" } : undefined}
      />
    );
  }
  const preset = typeof icon === "string" && icon.startsWith("preset:") ? PRESET_ICONS[icon.slice(7)] : null;
  return (
    <svg
      className="type-card__icon"
      viewBox="0 0 267.371 365.432"
      fill="none"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: preset ?? TYPE_ICONS[id] ?? FALLBACK }}
    />
  );
}
