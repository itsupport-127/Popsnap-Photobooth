import React, { useState } from "react";
import { testExportDir, pickFolderNative } from "../../services/settingsService";
import { Field, NumInput, inputCls } from "../editorKit";
import { Btn, Card, Notice } from "../ui";
import FolderPicker from "../FolderPicker";
import { Check, Row, Select } from "./controls";

const MODES = [
  ["photo", "Photo", "Ambil foto untuk dicetak / dikirim", true],
  ["gif", "GIF", "Ambil beberapa foto jadi GIF animasi"],
  ["boomerang", "Boomerang", "Rekam gerakan singkat yang diputar maju-mundur berulang"],
  ["video", "Video", "Rekam klip video"],
];
const rupiah = (n) => `Rp ${Number(n || 0).toLocaleString("id-ID")}`;

export default function SettingsGeneral({ s, set, pin, setPin, outputDir }) {
  const [exportTest, setExportTest] = useState(null);
  const [picker, setPicker] = useState(null); // { title, start, onPick }
  // 1) Aplikasi desktop: dialog bawaan Electron. 2) Browser di PC booth: backend membuka dialog bawaan Windows/macOS/Linux.
  // 3) Dibuka dari perangkat lain / gagal: daftar folder dalam aplikasi (FolderPicker).
  async function browse(title, current, onPick) {
    if (window.electronAPI?.pickFolder) { const d = await window.electronAPI.pickFolder(); if (d) onPick(d); return; }
    try {
      const r = await pickFolderNative(current);
      if (r?.path) onPick(r.path);
      return; // path null = dibatalkan
    } catch { setPicker({ title, start: current, onPick }); }
  }

  const g = s.general;
  const ex = g.export;

  async function testDir() {
    setExportTest({ busy: true });
    try { await testExportDir(ex.dir); setExportTest({ ok: true }); }
    catch (err) { setExportTest({ error: err.message }); }
  }

  return (
    <>
      <Card title="BOOTH MODE" hint="Mode yang tampil sebagai tombol di layar Start. Mode foto selalu aktif.">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {MODES.map(([id, name, desc, always]) => {
            const m = g.modes[id];
            return (
              <div key={id} className="border border-[#C7D0DA] p-3">
                <Check checked={always ? true : m.enabled} disabled={always} onChange={(v) => set(["general", "modes", id, "enabled"], v)} label={name} hint={desc} />
                {id !== "photo" && m.enabled && (
                  <div className="mt-2 w-56">
                    <Field label={`Harga (Rp)${m.price ? ` — ${rupiah(m.price)}` : ""}`}>
                      <NumInput value={m.price} min={0} step={1000} onCommit={(v) => set(["general", "modes", id, "price"], Math.round(v))} />
                    </Field>
                    {m.price === 0 && <p className="text-[12px] text-amber-600 mt-1">Harga 0 = GRATIS (tanpa pembayaran).</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <Check checked={g.modes.showLabels} onChange={(v) => set(["general", "modes", "showLabels"], v)} label="Tampilkan label teks di bawah ikon" />
      </Card>

      <Card title="OPTIONS">
        <Row label="Virtual Keyboard" hint="Mengetik dari keyboard PC SELALU bisa langsung (tanpa mengklik kolom isian) di semua pilihan ini. Keyboard Windows: di aplikasi desktop, keyboard sentuh Windows dibuka otomatis saat kolom kode voucher tampil.">
          <Select value={g.virtualKeyboard} onChange={(v) => set(["general", "virtualKeyboard"], v)} className="max-w-md"
            options={[["off", "Keyboard fisik / bawaan perangkat (kolom bisa diketuk)"], ["builtin", "Keyboard layar POPSNAP"], ["windows", "Keyboard sentuh Windows"]]} />
        </Row>
        <Row label="Security Pin" hint={`PIN 4–8 angka yang diminta saat keluar dari layar penuh (ikon gembok atau tombol F11). ${g.security.pinSet ? (g.security.pinDefault ? "PIN masih BAWAAN (0808) — segera ganti dengan PIN milikmu." : "PIN sudah terpasang.") : "Belum ada PIN: layar penuh bisa dibuka siapa saja."}`}>
          <div className="flex items-center gap-2">
            <input className={`${inputCls} !w-40 tracking-[0.4em]`} type="password" inputMode="numeric" maxLength={8} autoComplete="new-password" placeholder={g.security.pinSet ? "•••• (ubah)" : "Buat PIN"} value={pin.value} onChange={(e) => setPin({ ...pin, value: e.target.value.replace(/\D/g, ""), clear: false })} />
            {g.security.pinSet && <Btn onClick={() => setPin({ value: "", clear: true })} variant={pin.clear ? "danger" : "default"}>{pin.clear ? "PIN akan dihapus" : "Hapus PIN"}</Btn>}
          </div>
          {pin.value && pin.value.length < 4 && <p className="text-[12px] text-red-600 mt-1">Minimal 4 angka.</p>}
        </Row>
      </Card>

      <Card title="IZIN FOTO (SOSMED & DIPAJANG DI TOKO)" hint="Layar tambahan setelah pembayaran dan sebelum pengumuman. Hasilnya bisa dilihat di menu Sosmed.">
        <Row label="Izin foto" hint="Setelah bayar (sebelum pengumuman), tamu memilih: Keduanya / Sosmed saja / Mading saja / Tidak. Folder sesi ditandai, dan yang diizinkan disalin ke folder _BOLEH-SOSMED dan/atau _BOLEH-MADING. Tidak dijawab = Tidak."><Check checked={g.consent.enabled} onChange={(v) => set(["general", "consent", "enabled"], v)} label="Tanya izin foto ke tamu" /></Row>
        {g.consent.enabled && (<>
          <Row label="Judul"><input className={inputCls} maxLength={40} value={g.consent.title} onChange={(e) => set(["general", "consent", "title"], e.target.value)} /></Row>
          <Row label="Pertanyaan"><input className={inputCls} maxLength={200} value={g.consent.text} onChange={(e) => set(["general", "consent", "text"], e.target.value)} /></Row>
          <Row label="Batas waktu (detik)" hint="5–120. Lewat batas dianggap Tidak."><div className="w-28"><NumInput value={g.consent.seconds} min={5} onCommit={(v) => set(["general", "consent", "seconds"], Math.round(v))} /></div></Row>
        </>)}
      </Card>

      <Card title="DISCLAIMER" hint="Ditampilkan setelah tamu menekan Start. Kalau tidak setuju, sesi dibatalkan sebelum pembayaran.">
        <Row label="Enable"><Check checked={g.disclaimer.enabled} onChange={(v) => set(["general", "disclaimer", "enabled"], v)} label="Wajibkan tamu menyetujui ketentuan sebelum mulai" /></Row>
        <Row label="Header"><input className={`${inputCls} ${g.disclaimer.enabled ? "" : "opacity-50"}`} maxLength={120} value={g.disclaimer.header} onChange={(e) => set(["general", "disclaimer", "header"], e.target.value)} /></Row>
        <Row label="Text"><textarea rows={5} maxLength={3000} className={`${inputCls} ${g.disclaimer.enabled ? "" : "opacity-50"}`} value={g.disclaimer.text} onChange={(e) => set(["general", "disclaimer", "text"], e.target.value)} /></Row>
      </Card>

      <Card title="DIRECTORIES">
        <Row label="Data Directory" hint="Semua foto & media tersimpan di sini (arsip permanen). Berlaku untuk sesi berikutnya — file lama tidak dipindahkan otomatis.">
          <div className="flex gap-2">
            <input className={inputCls} placeholder={outputDir || "Contoh: D:\\POPSNAP-Foto"} value={g.dataDir ?? ""} onChange={(e) => set(["general", "dataDir"], e.target.value)} />
            <Btn onClick={() => browse("Pilih Data Directory", g.dataDir || outputDir || "", (d) => set(["general", "dataDir"], d))}>Browse</Btn>
            {g.dataDir && <Btn onClick={() => set(["general", "dataDir"], "")}>Bawaan</Btn>}
          </div>
          <p className="text-[12px] text-[#6B7684] mt-1">Sedang dipakai: <span className="font-mono">{outputDir || "—"}</span>{!g.dataDir && " (bawaan)"}</p>
        </Row>
        <Row label="Real time Export" hint="Salin hasil ke folder lain begitu sesi selesai — berguna untuk flashdisk atau folder cloud (Google Drive, OneDrive).">
          <Check checked={ex.enabled} onChange={(v) => set(["general", "export", "enabled"], v)} label="Aktifkan ekspor real-time" />
          <div className={`flex gap-5 pt-1 ${ex.enabled ? "" : "opacity-40 pointer-events-none"}`}>
            {[["prints", "Prints"], ["originals", "Originals"], ["gifs", "GIFs"], ["videos", "Videos"]].map(([k, l]) => <Check key={k} checked={ex[k]} onChange={(v) => set(["general", "export", k], v)} label={l} />)}
          </div>
          <div className={`flex gap-2 mt-2 ${ex.enabled ? "" : "opacity-40 pointer-events-none"}`}>
            <input className={inputCls} placeholder="Contoh: D:\HASIL  atau  /home/user/hasil" value={ex.dir} onChange={(e) => { set(["general", "export", "dir"], e.target.value); setExportTest(null); }} />
            <Btn onClick={() => browse("Pilih folder ekspor", ex.dir || g.dataDir || outputDir || "", (d) => { set(["general", "export", "dir"], d); setExportTest(null); })}>Browse</Btn>
            <Btn onClick={testDir} disabled={!ex.dir}>Tes folder</Btn>
          </div>
          {exportTest?.ok && <div className="mt-2"><Notice tone="ok">Folder bisa ditulis.</Notice></div>}
          {exportTest?.error && <div className="mt-2"><Notice tone="error">{exportTest.error}</Notice></div>}
        </Row>
      </Card>

      <Card title="ATURAN SESI FOTO">
        <Row label="Jumlah foto per sesi"><div className="w-28"><NumInput value={s.session.totalShots} min={1} onCommit={(v) => set(["session", "totalShots"], Math.round(v))} /></div></Row>
        <Row label="Batas retake per sesi"><div className="w-28"><NumInput value={s.session.maxRetakes} min={0} onCommit={(v) => set(["session", "maxRetakes"], Math.round(v))} /></div></Row>
        <p className="text-[12px] text-[#6B7684] mt-3 mb-1 pl-[226px]">Batas waktu (detik)</p>
        {[["payment", "Pembayaran"], ["photoSession", "Sesi foto"], ["photoSessionExtend", "Tambahan waktu sesi foto"], ["editor", "Editor"]].map(([k, l]) => (
          <Row key={k} label={l}><div className="w-28"><NumInput value={s.session.timers[k]} min={1} onCommit={(v) => set(["session", "timers", k], Math.round(v))} /></div></Row>
        ))}
      </Card>

      <Card title="EVENT">
        <Row label="Nama event (judul layar Start)"><input className={inputCls} maxLength={60} value={s.event.name} onChange={(e) => set(["event", "name"], e.target.value)} /></Row>
        <Row label="Subjudul"><input className={inputCls} maxLength={100} value={s.event.subtitle} onChange={(e) => set(["event", "subtitle"], e.target.value)} /></Row>
      </Card>
      {picker && <FolderPicker title={picker.title} start={picker.start} onClose={() => setPicker(null)} onPick={(d) => { picker.onPick(d); setPicker(null); }} />}
    </>
  );
}
