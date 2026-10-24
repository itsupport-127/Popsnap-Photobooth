import { createContext, useContext } from "react";

/** Pengaturan publik dari backend (event, kamera, tampilan, mode booth, dll). null selama belum dimuat. */
export const KioskSettingsContext = createContext(null);
export const useKioskSettings = () => useContext(KioskSettingsContext);

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

/** Terapkan warna tema dari pengaturan admin ke seluruh aplikasi lewat CSS variable. */
export function applyTheme(colors) {
  if (!colors) return;
  const root = document.documentElement.style;
  const set = (name, hex) => /^#[0-9a-fA-F]{6}$/.test(hex || "") && root.setProperty(name, rgb(hex));
  set("--pop-dark", colors.background);
  set("--pop-pink", colors.primary);
  set("--pop-purple", colors.secondary);
  set("--pop-on-pink", colors.buttonText);
}
