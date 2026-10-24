import React, { useEffect, useMemo, useRef, useState } from "react";
import TemplatePreview from "../components/TemplatePreview";
import { Icon } from "./editorKit";

const SORT_KEY = "popsnap_template_sort";
const SORTS = ["recent", "az", "za"];
const SORT_LABEL = { recent: "Urutan dibuat (terbaru di atas)", az: "Urut A → Z", za: "Urut Z → A" };

function loadSort() {
  try { const v = localStorage.getItem(SORT_KEY); return SORTS.includes(v) ? v : "recent"; } catch { return "recent"; }
}

/**
 * Pemilih template ala dslrBooth:
 *  - kepala  : bintang favorit template aktif + nama + panah + status simpan
 *  - panel   : kolom "Nama" (ganti nama template aktif), tombol urut A-Z, daftar BERGULIR berisi
 *              thumbnail + nama + bintang favorit per baris (klik bintang = favorit, klik baris = buka template)
 * Template aktif memakai data yang sedang diedit (belum disimpan) supaya thumbnail & nama langsung mengikuti.
 */
export default function TemplatePicker({ templates, categories = [], activeId, live, isFavorite, dirty, disabled, onSelect, onToggleFavorite, onToggleFavoriteOf, onRename }) {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState(loadSort);
  // Live = favorit (★, tampil di booth) | Draft = belum favorit (tidak tampil). Filter hanya mempersempit daftar ini.
  const [statusFilter, setStatusFilter] = useState("all"); // all | live | draft
  const [catFilter, setCatFilter] = useState("all");
  const catLabel = (id) => categories.find((c) => c.id === id)?.label ?? id;
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const down = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === "Escape") setOpen(false); };
    // Fase capture: area kanvas editor memanggil stopPropagation pada pointerdown, jadi pendengar biasa tidak akan terpicu di sana
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key); };
  }, [open]);

  function cycleSort() {
    const next = SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length];
    setSort(next);
    try { localStorage.setItem(SORT_KEY, next); } catch { /* abaikan */ }
  }

  const counts = useMemo(() => {
    const inCat = templates.filter((t) => catFilter === "all" || t.category === catFilter);
    return { all: inCat.length, live: inCat.filter((t) => t.favorite).length, draft: inCat.filter((t) => !t.favorite).length };
  }, [templates, catFilter]);

  const rows = useMemo(() => {
    const list = templates.filter((t) => (statusFilter === "all" || (statusFilter === "live") === !!t.favorite) && (catFilter === "all" || t.category === catFilter)).map((t) => (t.id === activeId && live ? { ...t, name: live.meta.name, layers: live.layers, canvasWidth: live.meta.canvasWidth, canvasHeight: live.meta.canvasHeight, backgroundColor: live.meta.backgroundColor } : t));
    if (sort === "recent") return list;
    const cmp = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    return [...list].sort((a, b) => (sort === "az" ? cmp(a, b) : cmp(b, a)));
  }, [templates, activeId, live, sort, statusFilter, catFilter]);

  const name = live?.meta?.name;

  return (
    <div className="relative" ref={rootRef}>
      <div className="flex items-center gap-2 max-w-[480px]">
        <button
          onClick={onToggleFavorite} disabled={disabled}
          title={isFavorite ? "Live (favorit) — tampil di booth. Klik untuk menjadikan Draft." : "Draft — tidak tampil di booth. Klik untuk menjadikan Live (favorit)."}
          aria-pressed={isFavorite} aria-label="Favorit"
          className={`flex-shrink-0 disabled:opacity-30 ${isFavorite ? "text-[#f5b800]" : "text-[#55606E] hover:text-[#181B23]"}`}
        >
          <Icon name="star" size={22} fill={isFavorite} />
        </button>
        <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-2 text-[15px] text-[#181B23] min-w-0">
          <span className="truncate" data-testid="active-template-name">{name ?? "Belum ada template"}</span>
          <Icon name="chevD" size={14} className="flex-shrink-0" />
          {name != null && <span className="text-[12px] text-[#55606E] flex-shrink-0">- {dirty ? "Belum disimpan" : "Tersimpan"}</span>}
          {name != null && <span className={`flex-shrink-0 px-1.5 py-px rounded-full text-[10px] font-bold ${isFavorite ? "bg-[#E6F6EE] text-[#0F5C52]" : "bg-[#FFF6D6] text-[#7A5A00]"}`}>{isFavorite ? "LIVE" : "DRAFT"}</span>}
        </button>
      </div>

      {open && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-40 w-[470px] bg-[#F4F7FA] border border-[#C7D0DA] shadow-2xl" role="listbox">
          <div className="flex items-center gap-2 p-2 border-b border-[#D5DCE4]">
            <label htmlFor="template-picker-name" className="text-[13px] text-[#262A38] pl-1">Nama:</label>
            <input
              id="template-picker-name"
              value={name ?? ""} disabled={!live} maxLength={60}
              onChange={(e) => onRename(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className="flex-1 min-w-0 bg-[#E8EEF4] border border-[#C7D0DA] text-[#181B23] px-2 py-1.5 text-[14px] outline-none focus:border-[#4082AE]"
            />
            <button
              onClick={cycleSort} title={`Urutan: ${SORT_LABEL[sort]} (klik untuk ganti)`}
              className={`flex items-center gap-1 px-3 py-1.5 border text-[13px] font-semibold ${sort === "recent" ? "border-[#C7D0DA] bg-[#E8EEF4] text-[#262A38]" : "border-[#4082AE] bg-[#DCEBF6] text-[#181B23]"}`}
            >
              {sort === "za" ? "Z-A" : "A-Z"}
              <Icon name={sort === "za" ? "up" : "down"} size={12} />
            </button>
          </div>

          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[#D5DCE4] flex-wrap">
            {[["all", "Semua"], ["live", "Live"], ["draft", "Draft"]].map(([id, label]) => (
              <button
                key={id} type="button" onClick={() => setStatusFilter(id)} aria-pressed={statusFilter === id}
                className={`px-2.5 py-0.5 text-[12px] font-bold rounded-full border ${statusFilter === id ? "bg-[#181B23] text-white border-[#181B23]" : "bg-white text-[#262A38] border-[#C7D0DA] hover:border-[#4082AE]"}`}
              >{label} ({counts[id]})</button>
            ))}
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} aria-label="Filter kategori" className="ml-auto max-w-[170px] bg-[#E8EEF4] border border-[#C7D0DA] text-[#181B23] px-2 py-0.5 text-[12px] outline-none focus:border-[#4082AE]">
              <option value="all">Semua kategori</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>

          <div className="max-h-[360px] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#6a6a6a_#1f1f1f]" data-testid="template-list">
            {rows.map((t) => {
              const active = t.id === activeId;
              return (
                <div
                  key={t.id} role="option" aria-selected={active} tabIndex={0}
                  onClick={() => { setOpen(false); onSelect(t); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { setOpen(false); onSelect(t); } }}
                  className={`flex items-center gap-4 px-2 h-[66px] border-b border-[#D5DCE4] cursor-pointer ${active ? "bg-[#E8EEF4]" : "hover:bg-[#F4F7FA]"}`}
                >
                  <div className="h-14 flex items-center justify-center w-16 flex-shrink-0">
                    <div className="h-14 bg-white border border-[#C7D0DA]" style={{ aspectRatio: `${t.canvasWidth} / ${t.canvasHeight}`, maxWidth: 64 }}>
                      <TemplatePreview template={t} className="h-full w-full" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-[15px] text-[#181B23]">{t.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px]">
                      <span className={`px-1.5 py-px rounded-full font-bold ${t.favorite ? "bg-[#E6F6EE] text-[#0F5C52]" : "bg-[#FFF6D6] text-[#7A5A00]"}`}>{t.favorite ? "LIVE" : "DRAFT"}</span>
                      <span className="text-[#55606E] truncate">{catLabel(t.category)}</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleFavoriteOf(t); }}
                    title={t.favorite ? "Live — klik untuk jadikan Draft" : "Draft — klik untuk jadikan Live (favorit)"} aria-pressed={!!t.favorite} aria-label={`Favorit ${t.name}`}
                    className={`flex-shrink-0 p-1 ${t.favorite ? "text-[#f5b800]" : "text-[#55606E] hover:text-[#262A38]"}`}
                  >
                    <Icon name="star" size={22} fill={!!t.favorite} />
                  </button>
                </div>
              );
            })}
            {rows.length === 0 && <p className="px-3 py-6 text-center text-[#6B7684] text-[13px]">{templates.length === 0 ? "Belum ada template." : "Tidak ada template yang cocok dengan filter ini."}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
