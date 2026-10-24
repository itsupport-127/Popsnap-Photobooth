// ==========================================================
// Warna placeholder slot "Photo From Booth" per nomor (Template Editor & pratinjau template).
// 5 warna pertama diambil dari logo PopSnap: biru, merah, pink, kuning, hijau.
// Nomor 6-12 warna pendamping yang selaras. Nomor 13+ mengulang palet dengan versi lebih gelap.
// Hanya memengaruhi placeholder; foto asli pelanggan tidak berubah.
// ==========================================================
export const SLOT_PALETTE = [
  { name: "Biru", bg: "#3374A5", fg: "#FFFFFF" },   // 1  biru logo
  { name: "Merah", bg: "#E52A3D", fg: "#FFFFFF" },  // 2  merah huruf O
  { name: "Pink", bg: "#E56AA1", fg: "#FFFFFF" },   // 3  pink telinga (dipekatkan agar angka putih terbaca)
  { name: "Kuning", bg: "#F7B538", fg: "#3A2E00" }, // 4  kuning huruf N
  { name: "Hijau", bg: "#36B27E", fg: "#FFFFFF" },  // 5  hijau pendamping
  { name: "Oranye", bg: "#F58634", fg: "#FFFFFF" }, // 6
  { name: "Ungu", bg: "#8C6FD6", fg: "#FFFFFF" },   // 7
  { name: "Langit", bg: "#3EB6DC", fg: "#FFFFFF" }, // 8
  { name: "Koral", bg: "#FF7468", fg: "#FFFFFF" },  // 9
  { name: "Lime", bg: "#9ACD3A", fg: "#22300A" },   // 10
  { name: "Tosca", bg: "#1F9AA0", fg: "#FFFFFF" },  // 11
  { name: "Indigo", bg: "#5B6ED0", fg: "#FFFFFF" }, // 12
];

export const SLOT_NEUTRAL = { name: "Netral", bg: "#9FB4C9", fg: "#FFFFFF" }; // slot tanpa nomor

/** { bg, fg, name } untuk nomor foto `order` (1, 2, 3, ...). */
export function slotColor(order) {
  const n = Math.round(Number(order));
  if (!Number.isFinite(n) || n < 1) return SLOT_NEUTRAL;
  const base = SLOT_PALETTE[(n - 1) % SLOT_PALETTE.length];
  const cycle = Math.floor((n - 1) / SLOT_PALETTE.length);
  if (cycle === 0) return base;
  return { ...base, bg: `color-mix(in srgb, ${base.bg} ${Math.max(45, 80 - (cycle - 1) * 15)}%, #000)` };
}
