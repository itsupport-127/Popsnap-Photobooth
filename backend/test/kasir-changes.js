// Uji: perubahan (edit/hapus) dari kasir diterapkan ke tx_log booth, galeri cloud ikut dihapus, tidak ada kirim ulang.
//   node test/kasir-changes.js
const os = require("os"), fs = require("fs"), path = require("path"), http = require("http"), assert = require("assert");
process.env.POPSNAP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "booth-"));

(async () => {
  // kasir & galeri tiruan
  let kasirChanges = [], kasirCursor = null, kasirCalls = [], galleryDeletes = [], galleryFail = false;
  const kasir = http.createServer((req, res) => {
    kasirCalls.push(req.url);
    res.setHeader("Content-Type", "application/json");
    if (req.url.startsWith("/api/photobox/changes")) return res.end(JSON.stringify({ ok: true, changes: kasirChanges, cursor: kasirCursor }));
    if (req.url.startsWith("/api/photobox/transactions")) return res.end(JSON.stringify({ ok: true, results: [] }));
    res.statusCode = 404; res.end("{}");
  }).listen(0);
  const gallery = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "DELETE") {
      if (galleryFail) { res.statusCode = 500; return res.end(JSON.stringify({ error: "bucket error" })); }
      galleryDeletes.push(req.url); return res.end(JSON.stringify({ ok: true, deleted: true }));
    }
    res.statusCode = 404; res.end("{}");
  }).listen(0);

  const settings = require("../settings");
  settings.update({ payment: { cloud: { enabled: true, url: `http://127.0.0.1:${kasir.address().port}`, token: "tok", studioCode: "ABC", galleryEnabled: true, galleryUrl: `http://127.0.0.1:${gallery.address().port}` } } });
  const db = require("../db"), cloud = require("../cloudSync");

  // 2 transaksi lunas: A punya sesi galeri, B tidak
  db.prepare("INSERT INTO sessions (id, share_token) VALUES ('S-A', 'SHARETOKEN')").run();
  cloud.create({ orderNo: "PB-ABC-261026-0001", method: "qris", amount: 35000, status: "paid", sessionId: "S-A" });
  cloud.create({ orderNo: "PB-ABC-261026-0002", method: "qris", amount: 25000, status: "paid" });
  const row = (n) => db.prepare("SELECT * FROM tx_log WHERE order_no = ?").get(n);
  db.prepare("UPDATE tx_log SET synced_at = updated_at").run(); // anggap sudah terkirim

  // 1) edit dari kasir: amount berubah, TIDAK memicu kirim ulang (updated_at tetap)
  const t0 = row("PB-ABC-261026-0002").updated_at;
  kasirChanges = [{ order_no: "PB-ABC-261026-0002", deleted: false, template_name: "Paket Baru", method: "qris", amount: 20000, status: "paid", paid_at: "2026-10-26T10:00:00+07:00", changed_at: "2026-10-26T11:00:00+07:00" }];
  kasirCursor = "2026-10-26T11:00:00+07:00";
  let r = await cloud.pullChanges({ force: true }); assert(r.ok && r.applied === 1, JSON.stringify(r));
  assert.strictEqual(row("PB-ABC-261026-0002").amount, 20000);
  assert.strictEqual(row("PB-ABC-261026-0002").template_name, "Paket Baru");
  assert.strictEqual(row("PB-ABC-261026-0002").updated_at, t0, "updated_at tidak boleh berubah");
  assert.strictEqual(cloud.status().pending, 0, "edit dari kasir tidak boleh dikirim balik");
  // diulang (cursor memakai >=): tidak ada efek ganda
  r = await cloud.pullChanges({ force: true }); assert.strictEqual(r.applied, 0);
  assert(kasirCalls.some((u) => u.includes("since=2026-10-26T11%3A00%3A00%2B07%3A00")), "cursor harus dikirim sebagai ?since=");
  console.log("ok  edit dari kasir diterapkan, tidak dikirim balik, idempoten, cursor tersimpan");

  // 2) hapus dari kasir: galeri gagal dulu -> diulang; berhasil -> sesi galeri dihapus
  galleryFail = true;
  kasirChanges = [{ order_no: "PB-ABC-261026-0001", deleted: true, changed_at: "2026-10-26T12:00:00+07:00" }];
  kasirCursor = "2026-10-26T12:00:00+07:00";
  r = await cloud.pullChanges({ force: true }); assert(r.ok && r.applied === 1);
  assert(row("PB-ABC-261026-0001").kasir_deleted_at, "ditandai terhapus");
  assert.strictEqual(row("PB-ABC-261026-0001").gallery_purged, 0, "galeri gagal -> belum selesai");
  galleryFail = false;
  await cloud.pullChanges({ force: true });
  assert.deepStrictEqual(galleryDeletes, ["/api/v1/sessions/SHARETOKEN"]);
  assert.strictEqual(row("PB-ABC-261026-0001").gallery_purged, 1);
  assert(row("PB-ABC-261026-0001"), "baris tx_log tetap ada supaya nomor tidak dipakai ulang");
  assert.strictEqual(cloud.status().pending, 0);
  await cloud.pullChanges({ force: true }); assert.strictEqual(galleryDeletes.length, 1, "tidak menghapus galeri dua kali");
  console.log("ok  hapus dari kasir: ditandai, galeri cloud dihapus (diulang saat gagal), baris tetap ada");

  // 3) hapus transaksi tanpa sesi galeri -> langsung selesai
  kasirChanges = [{ order_no: "PB-ABC-261026-0002", deleted: true, changed_at: "2026-10-26T13:00:00+07:00" }]; kasirCursor = "2026-10-26T13:00:00+07:00";
  await cloud.pullChanges({ force: true });
  assert(row("PB-ABC-261026-0002").kasir_deleted_at && row("PB-ABC-261026-0002").gallery_purged === 1);
  // 4) edit lama setelah hapus tidak membatalkan hapus; order asing diabaikan
  kasirChanges = [{ order_no: "PB-ABC-261026-0002", deleted: false, amount: 1, changed_at: "2026-10-26T09:00:00+07:00" }, { order_no: "PB-LAIN-1", deleted: true, changed_at: "x" }];
  r = await cloud.pullChanges({ force: true }); assert.strictEqual(r.applied, 0);
  assert.strictEqual(row("PB-ABC-261026-0002").amount, 20000);
  console.log("ok  edit lama tidak membatalkan hapus; transaksi milik booth lain diabaikan");
  kasir.close(); gallery.close(); process.exit(0);
})().catch((e) => { console.error("GAGAL:", e); process.exit(1); });
