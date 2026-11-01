import React, { useRef, useState } from "react";
import { Btn, Card, Notice } from "../ui";
import { Check } from "./controls";
import { DEFAULT_FILTERS, NEUTRAL_FILTER } from "../../utils/filters";
import FilteredImg from "../../components/FilteredImg";
import { parseCube, cubeToStrip, canvasToPngBlob } from "../../utils/lut";
import { uploadSettingsAsset } from "../../services/settingsService";

// Gambar contoh (berwarna-warni) untuk melihat efek filter
const SAMPLE = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7EC8F5"/><stop offset="1" stop-color="#E9F6FF"/></linearGradient></defs><rect width="240" height="160" fill="url(#g)"/><circle cx="196" cy="34" r="20" fill="#FFC93C"/><rect y="118" width="240" height="42" fill="#5FB36B"/><circle cx="96" cy="74" r="30" fill="#F2B38E"/><rect x="62" y="102" width="68" height="58" rx="22" fill="#E02843"/><circle cx="86" cy="70" r="4" fill="#3A2E00"/><circle cx="106" cy="70" r="4" fill="#3A2E00"/><path d="M84 84q12 10 24 0" stroke="#3A2E00" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="30" cy="120" r="14" fill="#FDB533"/><rect x="150" y="90" width="44" height="40" fill="#4082AE"/></svg>`
);

const SLIDERS = [
  ["brightness", "Kecerahan", 0, 200, "%"],
  ["contrast", "Kontras", 0, 200, "%"],
  ["saturate", "Saturasi warna", 0, 250, "%"],
  ["grayscale", "Hitam-putih", 0, 100, "%"],
  ["sepia", "Sepia (hangat)", 0, 100, "%"],
  ["hue", "Geser warna", -180, 180, "°"],
  ["blur", "Blur lembut", 0, 6, "px"],
];

const MAX_FILTERS = 24;

export default function SettingsFilters({ s, set, only }) {
  const vis = (t) => !only || only.includes(t); // tampilkan hanya kartu yang diminta halaman Pengaturan (pengelompokan baru)
  const list = s.editor?.filters ?? DEFAULT_FILTERS;
  const [open, setOpen] = useState(null);
  const save = (next) => set(["editor"], { ...(s.editor ?? {}), filters: next });
  const patch = (i, ch) => save(list.map((f, k) => (k === i ? { ...f, ...ch } : f)));
  const patchP = (i, key, v) => save(list.map((f, k) => (k === i ? { ...f, p: { ...f.p, [key]: v } } : f)));
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [importErr, setImportErr] = useState(null);
  const thumb = (f, className) => <FilteredImg src={SAMPLE} filterId={f.id} lut={f.lut ?? null} params={f.p} maxSide={400} className={className} style={{ objectFit: "cover" }} />;

  // Impor LUT .cube: parse -> strip PNG -> unggah -> jadi filter baru
  async function importCube(e) {
    const files = [...e.target.files];
    e.target.value = "";
    setImportErr(null);
    if (!files.length) return;
    setBusy(true);
    const added = [];
    const errs = [];
    for (const file of files) {
      if (list.length + added.length >= MAX_FILTERS) { errs.push(`${file.name}: batas ${MAX_FILTERS} filter tercapai.`); break; }
      try {
        if (file.size > 30 * 1024 * 1024) throw new Error("terlalu besar (maks 30 MB)");
        const cube = parseCube(await file.text());
        const blob = await canvasToPngBlob(cubeToStrip(cube));
        const up = await uploadSettingsAsset(new File([blob], "lut.png", { type: "image/png" }));
        if (!up) return;
        const name = (cube.title || file.name.replace(/\.cube$/i, "")).slice(0, 24) || "LUT";
        added.push({ id: newId(), label: name, enabled: true, p: { ...NEUTRAL_FILTER }, lut: { url: up.fullUrl, size: cube.size, intensity: 100 } });
      } catch (err) { errs.push(`${file.name}: ${err.message}`); }
    }
    if (added.length) { save([...list, ...added]); setOpen(added[0].id); }
    if (errs.length) setImportErr(errs.join(" • "));
    setBusy(false);
  }
  const newId = () => "c" + Math.random().toString(36).slice(2, 8);
  const add = (base) => {
    const f = { id: newId(), label: base ? `${base.label} (salinan)`.slice(0, 24) : `Filter ${list.length + 1}`, enabled: true, p: { ...NEUTRAL_FILTER, ...(base?.p ?? { saturate: 120 }) }, ...(base?.lut ? { lut: { ...base.lut } } : {}) };
    save([...list, f]);
    setOpen(f.id);
  };
  const remove = (i) => { if (window.confirm(`Hapus filter "${list[i].label}"?`)) save(list.filter((_, k) => k !== i)); };
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const n = [...list];
    [n[i], n[j]] = [n[j], n[i]];
    save(n);
  };

  return (
    <>
      {vis("Filter foto") && (
      <Card title="Filter foto" hint="Filter yang bisa dipilih tamu di layar Pilih & Edit Foto. “No Filter” selalu ada di urutan pertama. Tambah, ubah nama, atur efeknya, urutkan, atau matikan sesuai kebutuhan.">
        <div className="flex flex-col gap-2">
          {list.map((f, i) => {
            const isOpen = open === f.id;
            return (
              <div key={f.id} className={`border ${isOpen ? "border-[#4082AE]" : "border-[#D5DCE4]"} bg-white rounded-lg`}>
                <div className="flex items-center gap-3 p-2.5">
                  <div className="w-20 h-[53px] rounded overflow-hidden flex-shrink-0 bg-[#ddd]" style={{ opacity: f.enabled ? 1 : 0.4 }}>{thumb(f, "w-full h-full")}</div>
                  <input className="flex-1 min-w-0 bg-[#F4F7FA] border border-[#C7D0DA] text-[#181B23] px-2 py-1 text-[13px] outline-none focus:border-[#4082AE]" value={f.label} maxLength={24} onChange={(e) => patch(i, { label: e.target.value })} aria-label="Nama filter" />
                  <Check checked={f.enabled} onChange={(v) => patch(i, { enabled: v })} label="Tampil" />
                  <div className="flex items-center gap-1">
                    <button type="button" className="px-2 py-1 border border-[#C7D0DA] rounded disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Naik">▲</button>
                    <button type="button" className="px-2 py-1 border border-[#C7D0DA] rounded disabled:opacity-30" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="Turun">▼</button>
                  </div>
                  <Btn onClick={() => setOpen(isOpen ? null : f.id)}>{isOpen ? "Tutup" : "Atur efek"}</Btn>
                </div>
                {isOpen && (
                  <div className="border-t border-[#D5DCE4] p-3 grid md:grid-cols-[260px_1fr] gap-4">
                    <div>
                      <div className="rounded overflow-hidden bg-[#ddd]">{thumb(f, "w-full")}</div>
                      <p className="text-[11px] text-[#6B7684] mt-1">{f.lut ? `LUT .cube (${f.lut.size}³)` : "Filter manual"}</p>
                    </div>
                    <div className="flex flex-col gap-1">
                      {f.lut ? (
                        <label className="grid grid-cols-[130px_1fr_56px] items-center gap-2 text-[13px] text-[#181B23]">
                          Kekuatan LUT
                          <input type="range" min={0} max={100} value={f.lut.intensity} onChange={(e) => patch(i, { lut: { ...f.lut, intensity: Number(e.target.value) } })} />
                          <span className="tabular-nums text-right">{f.lut.intensity}%</span>
                        </label>
                      ) : SLIDERS.map(([k, label, min, max, unit]) => (
                        <label key={k} className="grid grid-cols-[130px_1fr_56px] items-center gap-2 text-[13px] text-[#181B23]">
                          {label}
                          <input type="range" min={min} max={max} value={f.p[k]} onChange={(e) => patchP(i, k, Number(e.target.value))} />
                          <span className="tabular-nums text-right">{f.p[k]}{unit}</span>
                        </label>
                      ))}
                      <div className="flex gap-2 mt-2">
                        {!f.lut && <Btn onClick={() => patch(i, { p: { ...NEUTRAL_FILTER } })}>Reset efek</Btn>}
                        <Btn onClick={() => add(f)}>Duplikat</Btn>
                        <Btn variant="danger" onClick={() => remove(i)}>Hapus filter</Btn>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex gap-2 mt-3">
          <Btn variant="primary" onClick={() => add(null)} disabled={list.length >= MAX_FILTERS}>+ Tambah filter</Btn>
          <Btn onClick={() => fileRef.current?.click()} disabled={busy || list.length >= MAX_FILTERS}>{busy ? "Mengimpor..." : "Impor LUT (.cube)"}</Btn>
          <input ref={fileRef} type="file" accept=".cube" multiple className="hidden" onChange={importCube} />
          <Btn onClick={() => { if (window.confirm("Kembalikan daftar filter ke bawaan?")) { save(DEFAULT_FILTERS.map((f) => ({ ...f, p: { ...f.p } }))); setOpen(null); } }}>Kembalikan bawaan</Btn>
        </div>
        {importErr && <div className="mt-2"><Notice tone="error">{importErr}</Notice></div>}
        <p className="text-[12px] text-[#6B7684] mt-2">LUT .cube = format standar warna (DaVinci Resolve, Lightroom, Photoshop, dll). Bisa pilih banyak file sekaligus; dukung LUT 3D (disarankan) dan 1D. {list.length}/{MAX_FILTERS} filter. Jangan lupa tekan “Simpan” di bawah. Kalau lebih dari 6 filter aktif, daftar di layar tamu bisa digulir.</p>
      </Card>)}
      <Notice tone="info">Filter yang sama dipakai untuk pratinjau di layar dan hasil akhir (cetak/unduh), jadi tampilannya selalu sama.</Notice>
    </>
  );
}
