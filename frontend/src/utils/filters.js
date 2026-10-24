// Filter foto (Editor). Satu sumber untuk pratinjau (CSS) dan hasil akhir (canvas ctx.filter),
// supaya yang dilihat tamu di layar = hasil cetak. Daftar filter diatur admin (Pengaturan > Filter);
// nama lama (sepia/vivid/soft) tetap didukung.
export const NEUTRAL_FILTER = { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, sepia: 0, hue: 0, blur: 0 };

// Bawaan (dipakai kalau server belum mengirim daftar filter). Harus sama dengan DEFAULTS.editor.filters di backend/settings.js
export const DEFAULT_FILTERS = [
  { id: "bw", label: "Black & White", enabled: true, p: { ...NEUTRAL_FILTER, contrast: 105, grayscale: 100 } },
  { id: "f1", label: "Filter 1", enabled: true, p: { ...NEUTRAL_FILTER, brightness: 105, saturate: 115, sepia: 35 } },
  { id: "f2", label: "Filter 2", enabled: true, p: { ...NEUTRAL_FILTER, contrast: 105, saturate: 125, hue: -8 } },
  { id: "f3", label: "Filter 3", enabled: true, p: { ...NEUTRAL_FILTER, brightness: 90, contrast: 125, saturate: 120 } },
  { id: "f4", label: "Filter 4", enabled: true, p: { ...NEUTRAL_FILTER, brightness: 110, contrast: 90, saturate: 85 } },
];

let custom = DEFAULT_FILTERS;

/** Dipanggil saat pengaturan dimuat (loadRuntimeConfig). */
export function setFilters(list) {
  custom = Array.isArray(list) ? list : DEFAULT_FILTERS;
}

/** Daftar pilihan untuk tamu: "No Filter" + filter aktif buatan admin. */
export function getFilterOptions() {
  return [{ id: "none", label: "No Filter" }, ...custom.filter((f) => f.enabled !== false).map((f) => ({ id: f.id, label: f.label }))];
}

/** Ubah parameter filter menjadi string CSS/canvas. Parameter netral dilewati; semuanya netral -> "none". */
export function paramsToCss(p = {}) {
  const v = { ...NEUTRAL_FILTER, ...p };
  const out = [];
  if (v.grayscale) out.push(`grayscale(${v.grayscale / 100})`);
  if (v.sepia) out.push(`sepia(${v.sepia / 100})`);
  if (v.brightness !== 100) out.push(`brightness(${v.brightness / 100})`);
  if (v.contrast !== 100) out.push(`contrast(${v.contrast / 100})`);
  if (v.saturate !== 100) out.push(`saturate(${v.saturate / 100})`);
  if (v.hue) out.push(`hue-rotate(${v.hue}deg)`);
  if (v.blur) out.push(`blur(${v.blur}px)`);
  return out.length ? out.join(" ") : "none";
}

/** Filter LUT (.cube) milik id ini: { url, size, intensity } atau null. */
export function getLutFilter(name) {
  const f = custom.find((x) => x.id === name);
  return f?.lut?.url ? f.lut : null;
}

export function filterCss(name) {
  const f = custom.find((x) => x.id === name);
  if (f) return f.lut?.url ? "none" : paramsToCss(f.p); // filter LUT diproses terpisah (utils/lut.js)
  switch (name) {
    case "sepia": return "sepia(0.8)";
    case "vivid": return "saturate(1.6) contrast(1.1)";
    case "soft": return "brightness(1.1) contrast(0.9)";
    default: return "none";
  }
}
