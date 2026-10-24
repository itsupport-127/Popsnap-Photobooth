import React, { useCallback, useEffect, useRef, useState } from "react";
import { Page, Card, Btn, Notice } from "./ui";
import { inputCls } from "./editorKit";
import {
  adminListStickers, uploadStickers, updateSticker, deleteSticker,
  createStickerCategory, renameStickerCategory, deleteStickerCategory,
} from "../services/stickerService";

const CHECKER = "repeating-conic-gradient(#E9EEF3 0% 25%, #fff 0% 50%) 50% / 16px 16px";

/** Admin > Stiker: unggah stiker untuk layar "Add sticker" di booth, dikelompokkan per kategori. */
export default function StickersPage() {
  const [data, setData] = useState({ categories: [], uncategorized: 0, stickers: [] });
  const [tab, setTab] = useState("all"); // all | none | id kategori
  const [msg, setMsg] = useState(null); // { tone, text }
  const [busy, setBusy] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [over, setOver] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(() => adminListStickers().then(setData).catch((e) => setMsg({ tone: "error", text: e.message })), []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, okText) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fn();
      if (r) { setData({ categories: r.categories, uncategorized: r.uncategorized, stickers: r.stickers }); if (okText) setMsg({ tone: "ok", text: okText(r) }); return r; }
    } catch (e) { setMsg({ tone: "error", text: e.message }); }
    finally { setBusy(false); }
  };

  const targetCat = tab !== "all" && tab !== "none" ? tab : "";
  const upload = (files) => {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return setMsg({ tone: "warn", text: "Pilih file gambar (PNG / WEBP / GIF / JPG)." });
    run(() => uploadStickers(list, targetCat), (r) => `${r.added} stiker ditambahkan.${r.rejected?.length ? ` Ditolak: ${r.rejected.join("; ")}` : ""}`);
  };

  const shown = data.stickers.filter((s) => (tab === "all" ? true : tab === "none" ? !s.categoryId : s.categoryId === tab));
  const curCat = data.categories.find((c) => c.id === tab);

  const addCat = async () => {
    const label = newCat.trim();
    if (!label) return;
    const r = await run(() => createStickerCategory(label), () => `Kategori "${label}" dibuat.`);
    if (r?.created) { setTab(r.created); setNewCat(""); }
  };
  const rename = () => {
    const label = window.prompt("Nama baru kategori:", curCat.label);
    if (label && label.trim()) run(() => renameStickerCategory(curCat.id, label.trim()), () => "Nama kategori diubah.");
  };
  const removeCat = async () => {
    if (!window.confirm(`Hapus kategori "${curCat.label}"? Stikernya tidak dihapus, hanya pindah ke "Lainnya".`)) return;
    await run(() => deleteStickerCategory(curCat.id), () => "Kategori dihapus.");
    setTab("all");
  };

  const tabs = [{ id: "all", label: "Semua", n: data.stickers.length }, ...data.categories.map((c) => ({ id: c.id, label: c.label, n: c.count })), ...(data.uncategorized && data.categories.length ? [{ id: "none", label: "Lainnya", n: data.uncategorized }] : [])];

  return (
    <Page title="Stiker" subtitle="Stiker yang bisa ditempel tamu di layar Add sticker. Kategori bersifat opsional: kalau dibuat, muncul sebagai tab di booth.">
      {data.stickers.length === 0 && <Notice tone="info">Belum ada stiker unggahan, jadi booth memakai stiker bawaan. Begitu kamu mengunggah satu stiker, stiker bawaan diganti oleh stikermu.</Notice>}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <Card title="Kategori" hint="Contoh: Ulang tahun, Wisuda, Lucu, Natal. Menghapus kategori tidak menghapus stikernya.">
        <div className="flex flex-wrap gap-2 items-center">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-1.5 rounded-full text-[13px] font-bold italic border ${tab === t.id ? "bg-[#E02843] text-white border-black/50" : "bg-white border-[#C7D0DA] text-[#181B23]"}`}>
              {t.label} <span className="opacity-70">({t.n})</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center mt-3">
          <input className={`${inputCls} !w-56 rounded-full px-3`} placeholder="Nama kategori baru" value={newCat} maxLength={40}
            onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCat()} />
          <Btn onClick={addCat} disabled={busy || !newCat.trim()}>+ Tambah kategori</Btn>
          {curCat && <><Btn onClick={rename} disabled={busy}>Ganti nama</Btn><Btn variant="danger" onClick={removeCat} disabled={busy}>Hapus kategori</Btn></>}
        </div>
      </Card>

      <Card title={`Unggah stiker${curCat ? ` ke "${curCat.label}"` : ""}`} hint="PNG transparan paling bagus. PNG / WEBP / GIF / JPG, maks. 3 MB dan 4000 px per gambar, bisa banyak file sekaligus.">
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-[16px] px-4 py-8 text-center cursor-pointer text-[13px] ${over ? "border-[#E02843] bg-[#FDE8EB]" : "border-[#C7D0DA] bg-[#F4F7FA]"}`}>
          {busy ? "Mengunggah…" : "Klik di sini atau seret file stiker ke sini"}
          <input ref={fileRef} type="file" multiple accept="image/png,image/webp,image/gif,image/jpeg" className="hidden"
            onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ""; }} />
        </div>
      </Card>

      <Card title={`Daftar stiker (${shown.length})`}>
        {shown.length === 0 ? <p className="text-[13px] text-[#6B7684]">Belum ada stiker di sini.</p> : (
          <div className="grid grid-cols-4 md:grid-cols-6 gap-3">
            {shown.map((s) => (
              <div key={s.id} className="border border-[#D5DCE4] rounded-[14px] p-2 bg-white flex flex-col gap-1.5">
                <div className="aspect-square rounded-[10px] flex items-center justify-center" style={{ background: CHECKER }}>
                  <img src={s.url} alt={s.name} className="max-w-full max-h-full object-contain p-1" draggable={false} />
                </div>
                <select className={`${inputCls} !text-[12px]`} value={s.categoryId || ""} disabled={busy}
                  onChange={(e) => run(() => updateSticker(s.id, { categoryId: e.target.value || null }))}>
                  <option value="">Lainnya</option>
                  {data.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <button className="text-[12px] font-bold text-[#E02843] hover:underline text-left disabled:opacity-40" disabled={busy}
                  onClick={() => window.confirm("Hapus stiker ini?") && run(() => deleteSticker(s.id), () => "Stiker dihapus.")}>Hapus</button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </Page>
  );
}
