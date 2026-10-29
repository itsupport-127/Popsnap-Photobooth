import React, { useCallback, useEffect, useState } from "react";
import { Btn, Notice, Page } from "./ui";
import { Select } from "./settings/controls";
import { API_BASE } from "../services/settingsService";
import { authHeader } from "../services/authService";
import { writeZip } from "./zip";

const call = async (path, opts = {}) => {
  const r = await fetch(`${API_BASE}${path}`, { ...opts, headers: { "Content-Type": "application/json", ...authHeader() }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Gagal (${r.status})`);
  return d;
};

export default function SocialPage() {
  const [status, setStatus] = useState("allowed");
  const [days, setDays] = useState("30");
  const [data, setData] = useState({ items: [], root: "" });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => call(`/api/social/list?status=${status}&days=${days}`).then(setData).catch((e) => setErr(e.message)), [status, days]);
  useEffect(() => { setErr(null); load(); }, [load]);

  async function set(id, allowed) { try { await call(`/api/social/${id}`, { method: "POST", body: { allowed } }); load(); } catch (e) { setErr(e.message); } }
  async function zipAll() {
    setBusy(true); setErr(null);
    try {
      const entries = [];
      for (const it of data.items) {
        if (!it.previewUrl) continue;
        const buf = new Uint8Array(await (await fetch(it.previewUrl)).arrayBuffer());
        const ext = (it.previewUrl.match(/\.(\w{2,4})$/) || [, "png"])[1];
        entries.push({ name: `${it.createdAt.slice(0, 10)}_${it.id}.${ext}`, data: buf });
      }
      const url = URL.createObjectURL(writeZip(entries));
      const a = document.createElement("a"); a.href = url; a.download = `konten-sosmed-${new Date().toISOString().slice(0, 10)}.zip`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const label = { 1: "Boleh", 0: "Tidak", null: "Belum dijawab" };
  return (
    <Page title="Konten Sosmed & Pajangan" subtitle="Foto yang tamunya mengizinkan dibagikan di sosmed atau dipajang di toko (mading). Salinannya otomatis ada di folder khusus di PC booth.">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select value={status} onChange={setStatus} options={[["allowed", "Boleh dipakai"], ["denied", "Tidak boleh"], ["unknown", "Belum dijawab"], ["all", "Semua"]]} />
        <Select value={days} onChange={setDays} options={[["7", "7 hari"], ["30", "30 hari"], ["90", "90 hari"], ["365", "1 tahun"]]} />
        <Btn onClick={load}>Segarkan</Btn>
        <Btn variant="primary" onClick={zipAll} disabled={busy || !data.items.length}>{busy ? "Menyiapkan…" : `Unduh ZIP (${data.items.length})`}</Btn>
      </div>
      {err && <Notice tone="error">{err}</Notice>}
      {data.root && <p className="text-[12px] text-[#6B7684] mb-3">Folder content creator di PC booth: <span className="font-mono select-all">{data.root}</span></p>}
      {!data.items.length ? <p className="text-[13px] text-[#6B7684]">Belum ada sesi pada filter ini.</p> : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
          {data.items.map((it) => (
            <div key={it.id} className="bg-white border border-[#D5DCE4] p-2 flex flex-col gap-2">
              <div className="aspect-[2/3] bg-[#F4F7FA] flex items-center justify-center overflow-hidden">
                {it.previewUrl ? (it.isVideo ? <video src={it.previewUrl} muted loop autoPlay playsInline className="max-h-full max-w-full" /> : <img src={it.previewUrl} alt={it.id} className="max-h-full max-w-full object-contain" loading="lazy" />) : <span className="text-[12px] text-[#6B7684]">Tanpa gambar</span>}
              </div>
              <div className="text-[12px] text-[#181B23] break-all">{it.id}</div>
              <div className="text-[11px] text-[#6B7684]">{it.createdAt} · {label[it.consent] ?? "Belum dijawab"}</div>
              <div className="flex gap-1.5 flex-wrap">
                {it.previewUrl && <a className="text-[12px] underline text-[#4082AE]" href={it.previewUrl} download target="_blank" rel="noreferrer">Unduh</a>}
                {it.consent !== 1 && <button className="text-[12px] underline text-emerald-700" onClick={() => set(it.id, true)}>Tandai boleh</button>}
                {it.consent !== 0 && <button className="text-[12px] underline text-red-600" onClick={() => set(it.id, false)}>Cabut izin</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
