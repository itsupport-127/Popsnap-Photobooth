import React, { useCallback, useEffect, useState } from "react";
import { generateVouchers, getAdminSettings, listVouchers, voidVoucher } from "../services/settingsService";
import { inputCls, Field, NumInput } from "./editorKit";
import { Btn, Card, Notice, Page } from "./ui";
import { copyText } from "./clipboard";

const STATUS = {
  active: { label: "Belum dipakai", cls: "text-emerald-600" },
  used: { label: "Terpakai", cls: "text-[#6B7684]" },
  expired: { label: "Kedaluwarsa", cls: "text-amber-600" },
  voided: { label: "Dibatalkan", cls: "text-red-600" },
};

function fmt(iso) {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  return d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function VoucherPage() {
  const [list, setList] = useState([]);
  const [note, setNote] = useState("");
  const [count, setCount] = useState(1);
  const [days, setDays] = useState(1);          // masa berlaku (hari)
  const [forever, setForever] = useState(false); // selamanya = tanpa kedaluwarsa
  const [uses, setUses] = useState(1);          // boleh dipakai berapa kali
  const [unlimited, setUnlimited] = useState(false);
  const [latest, setLatest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);

  const load = useCallback(() => listVouchers().then((l) => l && setList(l)).catch(() => {}), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  // Nilai awal masa berlaku ikut Pengaturan > Pembayaran (jam -> hari), supaya konsisten dengan kebiasaan lama
  useEffect(() => {
    getAdminSettings().then((s) => {
      const h = s?.payment?.voucherExpiryHours;
      if (h === 0) setForever(true);
      else if (h > 0) setDays(Math.max(1, Math.ceil(h / 24)));
    }).catch(() => {});
  }, []);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const r = await generateVouchers({ count, note, expiryDays: forever ? 0 : days, maxUses: unlimited ? 0 : uses });
      setLatest(r);
      setNote("");
      load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  // Klik kode (di kotak hasil buat voucher MAUPUN di tabel) = langsung tersalin
  async function copy(code) {
    const ok = await copyText(code);
    setCopied(ok ? code : `gagal:${code}`);
    setTimeout(() => setCopied(null), 1600);
  }

  async function cancel(code) {
    if (!confirm(`Batalkan voucher ${code}? Kode ini tidak bisa dipakai lagi.`)) return;
    try { await voidVoucher(code); load(); } catch (err) { alert(err.message); }
  }

  return (
    <Page title="Voucher Kasir" subtitle="Alur: pelanggan bayar di kasir → buat voucher di sini → berikan kodenya ke pelanggan → pelanggan memasukkannya di booth.">
      <Card title="BUAT VOUCHER">
        <div className="flex items-end gap-3">
          <Field label="Catatan / nomor struk (opsional)" className="flex-1">
            <input className={inputCls} value={note} maxLength={100} placeholder="Contoh: Struk #124 / Meja 3" onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && generate()} />
          </Field>
          <Field label="Jumlah" className="w-24"><NumInput value={count} min={1} onCommit={(v) => setCount(Math.min(20, Math.max(1, Math.round(v))))} /></Field>
        </div>
        <div className="flex items-end gap-6 mt-3 flex-wrap">
          <div className="flex items-end gap-3">
            <Field label="Masa berlaku (hari)" className="w-32"><NumInput value={days} min={1} disabled={forever} onCommit={(v) => setDays(Math.min(3650, Math.max(1, Math.round(v))))} /></Field>
            <label className="flex items-center gap-2 text-[13px] text-[#181B23] pb-2 cursor-pointer"><input type="checkbox" checked={forever} onChange={(e) => setForever(e.target.checked)} />Selamanya</label>
          </div>
          <div className="flex items-end gap-3">
            <Field label="Bisa dipakai (kali)" className="w-32"><NumInput value={uses} min={1} disabled={unlimited} onCommit={(v) => setUses(Math.min(999, Math.max(1, Math.round(v))))} /></Field>
            <label className="flex items-center gap-2 text-[13px] text-[#181B23] pb-2 cursor-pointer"><input type="checkbox" checked={unlimited} onChange={(e) => setUnlimited(e.target.checked)} />Tak terbatas</label>
          </div>
          <Btn variant="primary" onClick={generate} disabled={busy} className="h-[34px] ml-auto">{busy ? "Membuat..." : "Buat Voucher"}</Btn>
        </div>
        {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}

        {latest && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {latest.codes.map((c) => (
              <button key={c} onClick={() => copy(c)} className="bg-[#F4F7FA] border border-[#C7D0DA] hover:border-[#4082AE] py-4 text-center">
                <div className="text-3xl tracking-[0.35em] font-mono text-[#181B23] pl-[0.35em]">{c}</div>
                <div className="text-[12px] text-[#6B7684] mt-1">{copied === c ? "Tersalin ✓" : "Klik untuk menyalin"} · {latest.expiresAt ? `berlaku s/d ${fmt(latest.expiresAt)}` : "berlaku selamanya"} · {latest.maxUses === 0 ? "dipakai tanpa batas" : `${latest.maxUses}x pakai`}</div>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card title="VOUCHER TERBARU" hint="100 terakhir · diperbarui otomatis">
        <table className="w-full text-[13px]">
          <thead className="text-left text-[#6B7684] text-[12px]">
            <tr><th className="pb-2">Kode</th><th>Status</th><th>Dipakai</th><th>Berlaku s/d</th><th>Dibuat</th><th>Oleh</th><th>Catatan</th><th /></tr>
          </thead>
          <tbody>
            {list.map((v) => {
              const st = STATUS[v.status];
              return (
                <tr key={v.code} className="border-t border-[#D5DCE4]">
                  <td className="py-2">
                    <button onClick={() => copy(v.code)} title="Klik untuk menyalin" className="font-mono tracking-widest text-[#181B23] hover:text-[#4082AE] cursor-copy text-left">
                      {v.code}
                    </button>
                    {copied === v.code && <span className="ml-2 text-[11px] text-emerald-600 font-sans tracking-normal">Tersalin ✓</span>}
                    {copied === `gagal:${v.code}` && <span className="ml-2 text-[11px] text-red-600 font-sans tracking-normal">Gagal menyalin</span>}
                  </td>
                  <td className={st.cls}>{v.status === "active" && v.useCount > 0 ? "Aktif" : st.label}{v.status === "used" && v.usedAt ? ` · ${fmt(v.usedAt)}` : ""}</td>
                  <td className="text-[#55606E] font-mono text-[12px]">{v.maxUses === 0 ? `${v.useCount}x / ∞` : `${v.useCount} / ${v.maxUses}`}</td>
                  <td className="text-[#55606E]">{v.expiresAt ? fmt(v.expiresAt) : "Selamanya"}</td>
                  <td className="text-[#55606E]">{fmt(v.createdAt)}</td>
                  <td className="text-[#55606E]">{v.source === "api" ? "Aplikasi kasir" : v.createdBy || "—"}</td>
                  <td className="text-[#55606E] max-w-[220px] truncate" title={v.note || v.reference || ""}>{v.note || v.reference || "—"}</td>
                  <td className="text-right">{v.status === "active" && <button onClick={() => cancel(v.code)} className="text-red-600 hover:text-red-600 text-[12px]">Batalkan</button>}</td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-[#6B7684]">Belum ada voucher.</td></tr>}
          </tbody>
        </table>
      </Card>
    </Page>
  );
}
