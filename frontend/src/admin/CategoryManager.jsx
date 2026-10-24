import React, { useEffect, useRef, useState } from "react";
import { Modal, inputCls } from "./editorKit";
import { Btn, Notice } from "./ui";
import GroupIcon from "../components/GroupIcon";
import { PRESET_ICONS, PRESET_LABELS } from "../components/categoryIcons";
import { createCategory, deleteCategory, listCategories, renameCategory, reorderCategories, updateCategory, uploadCategoryIcon } from "../services/categoryService";

/** Kelola kategori template: tambah, ganti nama & ikon, urutkan (urutan = urutan kartu di booth), hapus (kalau kosong). */
export default function CategoryManager({ onClose, onChanged }) {
  const [list, setList] = useState([]);
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null); // kategori yang panel ikonnya terbuka
  const addRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => { listCategories().then(setList); addRef.current?.focus(); }, []);

  async function run(fn) {
    setError(null); setBusy(true);
    try {
      const r = await fn();
      if (r?.categories) { setList(r.categories); onChanged?.(r); }
      return r;
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function add() {
    if (!newLabel.trim()) return;
    const r = await run(() => createCategory(newLabel));
    if (r) {
      setNewLabel("");
      setOpenId(r.created); // langsung buka pemilih ikon untuk kategori baru
    }
  }

  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const ids = list.map((c) => c.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(() => reorderCategories(ids));
  }

  function rename(c, label) {
    if (label.trim() === c.label) return;
    run(() => renameCategory(c.id, label)).then(() => listCategories().then(setList)); // nama ditolak -> tampilkan lagi nama lama
  }

  function setSubtitle(c, value) {
    if (value.trim() === (c.subtitle ?? "")) return;
    run(() => updateCategory(c.id, { subtitle: value }));
  }

  function remove(c) {
    if (!confirm(`Hapus kategori "${c.label}"?`)) return;
    run(() => deleteCategory(c.id));
  }

  const setIcon = (c, icon) => run(() => updateCategory(c.id, { icon }));
  function pickFile(c, file) {
    if (file) run(() => uploadCategoryIcon(c.id, file));
  }

  return (
    <Modal title="Kelola Kategori" onClose={onClose} width="w-[560px]">
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-[#55606E]">Kategori tampil sebagai kartu di layar pilih tipe template. Urutan di sini = urutan kartu di booth. Klik gambar kecil untuk mengganti ikon. Kolom kecil di bawah nama = keterangan di samping judul (contoh: you will get 2× photo strips); kosongkan kalau tidak perlu, maka hanya judul yang tampil.</p>
        {error && <Notice tone="error">{error}</Notice>}

        <div className="flex flex-col gap-1.5">
          {list.map((c, i) => {
            const isUpload = typeof c.icon === "string" && c.icon.startsWith("upload:");
            const open = openId === c.id;
            return (
              <div key={c.id}>
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <button disabled={busy || i === 0} onClick={() => move(i, -1)} title="Naikkan" className="text-[10px] leading-none px-1 text-[#55606E] hover:text-[#E02843] disabled:opacity-25">▲</button>
                    <button disabled={busy || i === list.length - 1} onClick={() => move(i, 1)} title="Turunkan" className="text-[10px] leading-none px-1 text-[#55606E] hover:text-[#E02843] disabled:opacity-25">▼</button>
                  </div>
                  <button type="button" onClick={() => setOpenId(open ? null : c.id)} title="Ganti ikon" className={`relative shrink-0 w-9 h-12 rounded-lg bg-[#E02843] overflow-hidden border ${open ? "border-[#FFD23F] ring-2 ring-[#FFD23F]" : "border-black/40"}`}>
                    <GroupIcon category={c} />
                  </button>
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <input
                      key={c.label}
                      defaultValue={c.label}
                      maxLength={40}
                      className={inputCls}
                      onBlur={(e) => rename(c, e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    />
                    <input
                      key={`sub-${c.subtitle ?? ""}`}
                      defaultValue={c.subtitle ?? ""}
                      maxLength={60}
                      placeholder="Keterangan di samping judul (opsional)"
                      title="Tampil sebagai pil krem di samping judul kategori di booth. Kosongkan kalau tidak perlu."
                      className={`${inputCls} !py-1 !text-[12px] !bg-white`}
                      onBlur={(e) => setSubtitle(c, e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    />
                  </div>
                  <span className="text-[11px] text-[#6B7684] whitespace-nowrap w-36 text-right" title="Live = favorit ★ (tampil di booth). Draft = belum favorit (tidak tampil).">{c.count} template{c.count > 0 ? ` · ${c.liveCount ?? 0} live · ${c.count - (c.liveCount ?? 0)} draft` : ""}</span>
                  <button
                    disabled={busy || c.count > 0 || list.length <= 1}
                    onClick={() => remove(c)}
                    title={c.count > 0 ? "Masih ada template di kategori ini" : "Hapus kategori"}
                    className="text-[12px] text-[#E02843] hover:underline disabled:opacity-30 disabled:no-underline"
                  >Hapus</button>
                </div>

                {open && (
                  <div className="ml-6 mt-1.5 mb-2 p-3 bg-white border border-[#D5DCE4] rounded-[16px] flex flex-col gap-2.5">
                    <div className="grid grid-cols-6 gap-2">
                      {Object.keys(PRESET_ICONS).map((name) => (
                        <button
                          key={name} type="button" disabled={busy} title={PRESET_LABELS[name]} onClick={() => setIcon(c, `preset:${name}`)}
                          className={`relative h-14 rounded-lg bg-[#E02843] border ${c.icon === `preset:${name}` ? "border-[#FFD23F] ring-2 ring-[#FFD23F]" : "border-black/40 hover:brightness-110"}`}
                        >
                          <svg viewBox="48 56 171 202" className="absolute inset-1.5 w-[calc(100%-12px)] h-[calc(100%-12px)]" dangerouslySetInnerHTML={{ __html: PRESET_ICONS[name] }} />
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <Btn onClick={() => fileRef.current?.click()} disabled={busy}>Unggah gambar…</Btn>
                      <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { pickFile(c, e.target.files?.[0]); e.target.value = ""; }} />
                      {isUpload && (
                        <label className="flex items-center gap-1.5 text-[12px] text-[#181B23] cursor-pointer">
                          <input type="checkbox" checked={c.iconWhite} disabled={busy} onChange={(e) => run(() => updateCategory(c.id, { iconWhite: e.target.checked }))} />
                          Jadikan putih (siluet)
                        </label>
                      )}
                      <button type="button" disabled={busy || !c.icon} onClick={() => setIcon(c, null)} className="ml-auto text-[12px] text-[#55606E] underline hover:text-[#E02843] disabled:opacity-30 disabled:no-underline">Pakai ikon bawaan</button>
                    </div>
                    <p className="text-[11px] text-[#6B7684]">Unggahan: PNG / JPG / WEBP / GIF, maks 2 MB. Paling bagus PNG transparan dengan gambar sederhana; "Jadikan putih" mengubahnya jadi siluet putih supaya serasi di kartu merah.</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-end gap-2 pt-3 border-t border-[#D5DCE4]">
          <label className="flex-1 flex flex-col gap-1 text-[12px] text-[#262A38]">Kategori baru
            <input ref={addRef} value={newLabel} maxLength={40} placeholder="Contoh: Wedding, Ulang Tahun, Wisuda" className={inputCls}
              onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          </label>
          <Btn variant="primary" onClick={add} disabled={busy || !newLabel.trim()}>Tambah</Btn>
        </div>
        <div className="flex justify-end"><Btn onClick={onClose}>Selesai</Btn></div>
      </div>
    </Modal>
  );
}
