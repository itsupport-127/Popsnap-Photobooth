import React, { useState } from "react";
import { setPaymentMode } from "../services/settingsService";
import { useOverview } from "./AdminApp";
import { Card, Notice } from "./ui";

const MODES = [
  { id: "voucher", title: "Voucher saja", desc: "Bayar di kasir, kasir memberi kode voucher. Tidak butuh internet." },
  { id: "auto", title: "Otomatis", desc: "Online: voucher + QRIS. Internet mati: otomatis voucher saja." },
  { id: "both", title: "Voucher + QRIS", desc: "Konsumen pilih sendiri. QRIS hilang otomatis kalau internet mati." },
  { id: "qris", title: "QRIS saja", desc: "Semua bayar lewat payment gateway. Butuh internet." },
];

const METHOD_LABEL = { voucher: "Voucher", qris: "QRIS" };

/** Dipakai di halaman depan admin DAN halaman Pembayaran. Admin & kasir boleh mengubahnya. */
export default function PaymentModeCard({ canEdit = true }) {
  const { overview, refresh } = useOverview();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pay = overview?.payment;

  async function choose(mode) {
    if (mode === pay?.mode) return;
    setBusy(true);
    setError(null);
    try {
      await setPaymentMode(mode);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="MODE PEMBAYARAN" hint="Berlaku langsung di booth — kasir bisa mengganti kapan saja, misalnya saat internet putus.">
      <div className="grid grid-cols-2 gap-2">
        {MODES.map((m) => {
          const active = pay?.mode === m.id;
          return (
            <button
              key={m.id}
              disabled={busy || !pay || !canEdit}
              onClick={() => choose(m.id)}
              className={`text-left p-3 border ${active ? "border-[#4082AE] bg-[#DCEBF6]" : "border-[#C7D0DA] bg-[#F4F7FA] hover:bg-[#FFFFFF]"} disabled:opacity-60`}
            >
              <div className="flex items-center gap-2 text-[14px] text-[#181B23]">
                <span className={`w-3.5 h-3.5 rounded-full border-2 ${active ? "border-[#4082AE] bg-[#4082AE]" : "border-[#C7D0DA]"}`} />
                {m.title}
              </div>
              <p className="text-[12px] text-[#55606E] mt-1">{m.desc}</p>
            </button>
          );
        })}
      </div>

      {!canEdit && <div className="mt-3"><Notice tone="info">Akunmu hanya bisa melihat mode pembayaran. Minta Super Admin untuk hak "Ganti mode pembayaran".</Notice></div>}
      {pay && (
        <p className="text-[13px] text-[#262A38] mt-3">
          Yang tampil di booth sekarang:{" "}
          <b className="text-[#181B23]">{pay.methods.map((x) => METHOD_LABEL[x]).join(" + ")}</b>
          <span className="text-[#6B7684]"> · internet {pay.online ? "tersambung" : "terputus"}</span>
        </p>
      )}
      {pay?.notice && <div className="mt-2"><Notice tone="warn">{pay.notice}</Notice></div>}
      {error && <div className="mt-2"><Notice tone="error">{error}</Notice></div>}
    </Card>
  );
}
