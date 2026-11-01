import React, { useEffect, useState } from "react";
import { NumInput, inputCls } from "../editorKit";
import { Btn, Card, Notice } from "../ui";
import { Check, Range, Row, Select } from "./controls";
import { addSharedPrinter, canSilentPrint, listPrinters, printTestPage } from "../../services/printService";
import { getPrintStats, resetPrintCount } from "../../services/settingsService";

const N = ({ value, min, onCommit }) => <div className="w-28"><NumInput value={value} min={min} onCommit={(v) => onCommit(Math.round(v))} /></div>;

// Penjajaran cetak (skala + geser) satu printer, gaya dslrBooth "Printer Alignment"
function Alignment({ s, set, which, label }) {
  const u = s.printing[which];
  const [msg, setMsg] = useState(null);
  async function test() {
    setMsg(null);
    const r = await printTestPage(s.printing, which);
    setMsg(r.ok ? { tone: "info", t: "Halaman uji dikirim ke printer." } : { tone: "error", t: r.error });
  }
  return (
    <div className="border border-[#D5DCE4] bg-[#F4F7FA] p-3 mt-2">
      <div className="text-[12px] font-semibold text-[#55606E] mb-1">PENJAJARAN CETAK — {label}</div>
      <p className="text-[12px] text-[#6B7684] mb-1">Dipakai untuk menengahkan hasil di kertas kalau cetakan bergeser atau terpotong.</p>
      <Row label="Skala" hint="Kecilkan kalau hasil terpotong; besarkan kalau ada tepi putih."><Range value={u.scale} min={50} max={150} unit="%" onChange={(v) => set(["printing", which, "scale"], v)} /></Row>
      <Row label="Geser horizontal"><Range value={u.x} min={-100} max={100} onChange={(v) => set(["printing", which, "x"], v)} /></Row>
      <Row label="Geser vertikal"><Range value={u.y} min={-100} max={100} onChange={(v) => set(["printing", which, "y"], v)} /></Row>
      <Row label=""><div className="flex items-center gap-3"><Btn onClick={test} disabled={!canSilentPrint()}>Cetak halaman uji</Btn>{msg && <span className={`text-[12px] ${msg.tone === "error" ? "text-red-600" : "text-emerald-600"}`}>{msg.t}</span>}</div></Row>
    </div>
  );
}

export default function SettingsPrinting({ s, set, only }) {
  const vis = (t) => !only || only.includes(t); // tampilkan hanya kartu yang diminta halaman Pengaturan (pengelompokan baru)
  const pr = s.printing;
  const [printers, setPrinters] = useState([]);
  const [err, setErr] = useState(null);
  const [share, setShare] = useState("");
  const [shareMsg, setShareMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState(null);

  async function refresh() {
    const r = await listPrinters();
    setPrinters(r.printers || []);
    setErr(r.ok ? null : r.error);
  }
  useEffect(() => { refresh(); getPrintStats().then(setStats).catch(() => {}); }, []);

  async function add() {
    setBusy(true); setShareMsg(null);
    const r = await addSharedPrinter(share);
    setBusy(false);
    if (r.ok) { setShareMsg({ ok: true, t: "Printer ditambahkan. Pilih di daftar printer di atas." }); setShare(""); await refresh(); }
    else setShareMsg({ ok: false, t: r.error });
  }

  const opts = (cur) => {
    const list = printers.map((p) => [p.name, p.name + (p.isDefault ? " (bawaan Windows)" : "")]);
    if (cur && !printers.some((p) => p.name === cur)) list.unshift([cur, `${cur} (tidak terdeteksi)`]);
    return [["", "— belum dipilih —"], ...list];
  };

  return (
    <>
      {vis("CETAK (PRINTING)") && (
      <Card title="CETAK (PRINTING)" hint="Mencetak hasil foto ke printer yang dikenal Windows. Bisa printer yang dicolok ke PC booth ini, atau printer PC lain yang di-share lewat jaringan.">
        <Row label="Aktifkan cetak"><Check checked={pr.enabled} onChange={(x) => set(["printing", "enabled"], x)} label="Aktifkan fitur cetak di booth" /></Row>
        {err && <Notice tone="info">{err}</Notice>}
        <Row label="Printer utama" hint="Daftar diambil dari Windows. Printer dari PaperCut Mobility Print (client) otomatis muncul di sini setelah terpasang di Windows — tinggal pilih, tekan Segarkan kalau belum tampil.">
          <div className="flex gap-2 items-center">
            <Select className="max-w-md" value={pr.main.name} onChange={(v) => set(["printing", "main", "name"], v)} options={opts(pr.main.name)} />
            <Btn onClick={refresh}>Segarkan</Btn>
          </div>
        </Row>
        <Row label="Tambah printer sharing" hint="Opsional. Kalau memakai Mobility Print, tidak perlu. Hanya untuk printer sharing Windows biasa dari PC lain: ketik alamatnya lalu Tambahkan.">
          <div className="flex gap-2 items-center">
            <input className={`${inputCls} max-w-xs`} placeholder="\\NAMA-PC\NAMA-PRINTER" value={share} onChange={(e) => setShare(e.target.value)} />
            <Btn onClick={add} disabled={busy || !share.trim() || !canSilentPrint()}>{busy ? "Menambahkan…" : "Tambahkan"}</Btn>
          </div>
          {shareMsg && <p className={`text-[12px] mt-1 ${shareMsg.ok ? "text-emerald-600" : "text-red-600"}`}>{shareMsg.t}</p>}
        </Row>
        <Alignment s={s} set={set} which="main" label="PRINTER UTAMA" />
        <Row label="Printer kedua" hint="Dipakai bersama printer utama bila 'Cetak ke kedua printer' dicentang.">
          <div className="flex gap-2 items-center">
            <Select className="max-w-md" value={pr.second.name} onChange={(v) => set(["printing", "second", "name"], v)} options={opts(pr.second.name)} />
            <Btn onClick={() => set(["printing", "second", "name"], "")} disabled={!pr.second.name}>Hapus</Btn>
          </div>
        </Row>
        {pr.second.name && <Alignment s={s} set={set} which="second" label="PRINTER KEDUA" />}
      </Card>)}

      {vis("PERILAKU CETAK") && (
      <Card title="PERILAKU CETAK">
        <Row label="Cetak otomatis" hint="Hasil langsung dicetak begitu sesi selesai, tanpa tamu menekan apa pun (sudah termasuk harga sesi)."><Check checked={pr.auto} onChange={(x) => set(["printing", "auto"], x)} label="Langsung cetak saat hasil keluar" /></Row>
        {pr.auto && <Row label="Salinan otomatis" hint="1–3 salinan."><N value={pr.autoCopies} min={1} onCommit={(x) => set(["printing", "autoCopies"], Math.min(3, x))} /></Row>}
        <Row label="Tombol Add Print" hint="Tamu bisa menambah cetakan di layar akhir. Boleh dinyalakan bersama atau tanpa cetak otomatis."><Check checked={pr.showButton} onChange={(x) => set(["printing", "showButton"], x)} label="Tampilkan tombol Add Print di akhir sesi" /></Row>
        {pr.showButton && <Row label="Harga per salinan (Rp)" hint="0 = gratis (langsung cetak). Lebih dari 0 = tamu scan QRIS lagi, lunas baru dicetak. Butuh QRIS aktif & internet."><div className="w-40"><NumInput value={pr.price} min={0} step={500} onCommit={(x) => set(["printing", "price"], Math.round(x))} /></div></Row>}
        <Row label="Cetak ke kedua printer"><Check checked={pr.both} disabled={!pr.second.name} onChange={(x) => set(["printing", "both"], x)} label="Cetak bergantian ke printer utama dan kedua" /></Row>
        <Row label="Putar otomatis"><Check checked={pr.autorotate} onChange={(x) => set(["printing", "autorotate"], x)} label="Orientasi kertas mengikuti orientasi template" /></Row>
        <Row label="Ukuran di kertas"><Select value={pr.fit} onChange={(x) => set(["printing", "fit"], x)} options={[["fill", "Penuhi kertas (tepi bisa terpotong sedikit)"], ["fit", "Utuh (bisa ada bingkai putih)"]]} /></Row>
        <Row label="Batasi cetak"><Check checked={pr.limit.enabled} onChange={(x) => set(["printing", "limit", "enabled"], x)} label="Batasi jumlah cetak per event dan per sesi" /></Row>
        {pr.limit.enabled && (<>
          <Row label="Per event" hint={stats ? `Sudah tercetak: ${stats.total}` : ""}>
            <div className="flex items-center gap-3"><N value={pr.limit.perEvent} min={1} onCommit={(x) => set(["printing", "limit", "perEvent"], x)} />
              <Btn onClick={async () => { if (confirm("Reset hitungan cetak event menjadi 0?")) setStats(await resetPrintCount()); }}>Reset hitungan</Btn></div>
          </Row>
          <Row label="Per sesi"><N value={pr.limit.perSession} min={1} onCommit={(x) => set(["printing", "limit", "perSession"], x)} /></Row>
        </>)}
        <Row label="Pilihan salinan" hint="Jumlah salinan maksimum yang bisa dipilih tamu setelah menekan PRINT (1–9)."><N value={pr.copies} min={1} onCommit={(x) => set(["printing", "copies"], Math.min(9, x))} /></Row>
        <Row label="Ketajaman cetak" hint="Mempertajam gambar akhir sebelum dicetak."><Select value={pr.sharpening} onChange={(x) => set(["printing", "sharpening"], x)} options={[["none", "Tidak ada"], ["low", "Rendah"], ["medium", "Sedang"], ["high", "Tinggi"]]} /></Row>
        <Row label="Cetak 2x6"><Check checked={pr.strip2x6} onChange={(x) => set(["printing", "strip2x6"], x)} label="Template strip 2x6 dicetak dobel berdampingan di kertas 4x6 (lalu dipotong jadi dua)" /></Row>
        <Notice tone="info">Cetak diam-diam (tanpa dialog) hanya jalan di aplikasi desktop POPSNAP. Tombol Simpan di bawah berlaku untuk semua pengaturan di tab ini.</Notice>
      </Card>)}
    </>
  );
}
