// ==========================================================
// Aturan penomoran foto di template (sama persis dengan dslrBooth):
//  - Tiap slot foto punya "Photo #". Beberapa slot BOLEH punya nomor yang sama
//    (hasil Copy layer) -> slot-slot itu menampilkan FOTO YANG SAMA.
//  - Jumlah foto yang harus dipilih pelanggan = jumlah NOMOR BERBEDA, bukan jumlah slot.
//  - Foto pilihan ke-n mengisi slot dengan nomor terkecil ke-n (nomor boleh bolong, mis. 1, 3, 4).
// Dipakai bersama oleh: layar Editor, hasil akhir (composeImage), mesin state, dan Template Editor.
// ==========================================================

export function photoSlotPlan(layers = []) {
  const slots = layers.filter((l) => l.type === "photo-slot");
  const numbers = [...new Set(slots.map((l) => Number(l.photoOrder) || 0))].sort((a, b) => a - b);
  const indexByLayer = new Map(slots.map((l) => [l.id, numbers.indexOf(Number(l.photoOrder) || 0)]));
  return { slots, numbers, count: numbers.length, indexByLayer };
}
