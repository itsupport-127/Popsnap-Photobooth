import React, { useRef } from "react";
import TemplatePreview from "../components/TemplatePreview";
import useCategories from "../hooks/useCategories";
import TemplateDecor from "../components/TemplateDecor";
import logo from "../assets/logo-popsnap.png";
import StepBadge from "../components/StepBadge";
import useShape from "../hooks/useShape";
import GroupIcon from "../components/GroupIcon";

/**
 * Tahap 2 & 3: Pilih kelompok template, lalu pilih template di dalamnya.
 *
 * `templatesByCategory` = data template per kategori. Untuk sekarang pakai
 * placeholder; nanti diganti fetch dari backend (folder template PNG upload-an kamu).
 *
 * Struktur data yang diharapkan:
 * {
 *   strip2: [{ id, name, thumbnailUrl }, ...],
 *   print4r: [...],
 *   custom: [...],
 *   personalize: [...],
 * }
 */
export default function TemplateScreen({ session, dispatch, templatesByCategory }) {
  const { selectedCategory, selectedTemplate } = session;
  const { categories } = useCategories();

  // ---- Belum pilih kategori: tampilkan kelompok ----
  if (!selectedCategory) {
    // Kelompok tanpa template (mis. karena filter "favorit") disembunyikan — kecuali semuanya kosong
    const withItems = categories.filter((c) => (templatesByCategory?.[c.id] ?? []).length > 0);
    const cats = withItems.length ? withItems : categories;
    return (
      <div className="kiosk-screen h-full w-full flex items-center justify-center overflow-y-auto p-4">
        <TemplateDecor />
        <h2 className="sr-only">Pilih Kelompok Template</h2>
        <div className="type-row" style={cats.length === 1 ? { gridTemplateColumns: "var(--cw)" } : undefined}>
          {cats.map((cat) => (
            <button
              key={cat.id}
              onClick={() => dispatch({ type: "SELECT_CATEGORY", payload: { categoryId: cat.id } })}
              className="type-card"
            >
              <GroupIcon category={cat} />
              <span className="type-card__label">{cat.label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---- Sudah pilih kategori: panel kuning + baki putih berisi template (desain "Photostrip") ----
  return <TemplateList session={session} dispatch={dispatch} templates={templatesByCategory?.[selectedCategory] ?? []} category={categories.find((c) => c.id === selectedCategory)} />;
}

// Satuan desain: 1 = 1px pada kanvas desain 1728x1117 (lihat .strip-screen di index.css)
const U = (n) => `calc(var(--u) * ${n})`;

function TemplateList({ session, dispatch, templates, category }) {
  const { selectedTemplate } = session;
  const scrollRef = useRef(null);
  const drag = useRef(null);
  const hint = category?.subtitle?.trim() || null;
  const shape = useShape();
  const portrait = shape === "portrait";
  // Tata letak per bentuk layar (satuan desain: landscape 1728x1117, portrait 1080x1800, square 1200x1200)
  const L = shape === "square"
    ? { logo: { left: 470, top: 60, width: 240 }, panel: { left: 50, top: 250, width: 1100, height: 760 }, tray: { left: 68, top: 268, width: 1064, height: 724, r: 85 },
        pad: { l: 60, t: 120, gap: 50 }, cardH: 540, cardMaxW: 1e9, price: 26, tabs: { left: 50, width: 1100, top: 230 }, back: { left: 68, top: 1060 }, next: { left: 940, top: 1060 }, empty: 30 }
    : portrait
    ? { logo: { left: 410, top: 80, width: 260 }, panel: { left: 60, top: 330, width: 960, height: 1230 }, tray: { left: 78, top: 348, width: 924, height: 1194, r: 85 },
        pad: { l: 66, t: 150, gap: 56 }, cardH: 760, cardMaxW: 640, price: 30, tabs: { left: 60, width: 960, top: 310 }, back: { left: 78, top: 1630 }, next: { left: 810, top: 1630 }, empty: 34 }
    : { logo: { left: 129, top: 98, width: 212 }, panel: { left: 116, top: 294, width: 1496, height: 596 }, tray: { left: 134, top: 312, width: 1460, height: 560, r: 85 },
        pad: { l: 93, t: 86, gap: 61 }, cardH: 407, cardMaxW: 1e9, price: 22, tabs: { left: 116, width: 1496, top: 274 }, back: { left: 134, top: 955 }, next: { left: 1402, top: 955 }, empty: 28 }; // keterangan diisi admin di Kelola Kategori; kosong = hanya pil judul

  // Geser dengan mouse (layar sentuh sudah bisa swipe) + roda mouse jadi geser horizontal
  const onPointerDown = (e) => {
    if (e.pointerType !== "mouse" || !scrollRef.current) return;
    drag.current = { x: e.clientX, left: scrollRef.current.scrollLeft, moved: false };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 6) d.moved = true;
    if (d.moved) scrollRef.current.scrollLeft = d.left - dx;
  };
  const endDrag = () => setTimeout(() => { drag.current = null; }, 0);
  const onWheel = (e) => {
    if (scrollRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) scrollRef.current.scrollLeft += e.deltaY;
  };

  return (
    <div className="kiosk-screen strip-screen h-full w-full overflow-hidden" data-shape={shape}>
      <TemplateDecor />
      <div className="strip-stage">
        <img src={logo} alt="PopSnap" draggable={false} className="strip-logo" style={{ left: U(L.logo.left), top: U(L.logo.top), width: U(L.logo.width) }} />

        <div className="strip-panel" style={{ left: U(L.panel.left), top: U(L.panel.top), width: U(L.panel.width), height: U(L.panel.height) }} />
        <div className="strip-tray" style={{ left: U(L.tray.left), top: U(L.tray.top), width: U(L.tray.width), height: U(L.tray.height), borderRadius: U(L.tray.r) }}>
          {templates.length === 0 ? (
            <p className="strip-empty" style={{ fontSize: U(L.empty) }}>Belum ada template di kelompok ini. Upload PNG template lewat admin panel.</p>
          ) : (
            <div
              ref={scrollRef}
              className="strip-scroll"
              style={templates.length <= 2
                ? { justifyContent: "center", alignItems: "center", paddingBottom: U(L.price * 3), gap: U(L.pad.gap) } // 1-2 template: di tengah baki (horizontal & vertikal)
                : { paddingLeft: U(L.pad.l), paddingTop: U(L.pad.t), gap: U(L.pad.gap) }}
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerLeave={endDrag}
              onClickCapture={(e) => { if (drag.current?.moved) { e.preventDefault(); e.stopPropagation(); } }}
            >
              {templates.map((tpl) => {
                const picked = selectedTemplate?.id === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    onClick={() => dispatch({ type: "SELECT_TEMPLATE", payload: { template: tpl } })}
                    className={`strip-card ${picked ? "is-picked" : ""}`}
                    style={{ height: U(Math.min(L.cardH, L.cardMaxW / ((tpl.canvasWidth || 1200) / (tpl.canvasHeight || 1800)))), aspectRatio: `${tpl.canvasWidth || 1200} / ${tpl.canvasHeight || 1800}` }}
                  >
                    <TemplatePreview template={tpl} className="w-full h-full" style={{ width: "100%" }} />
                    {tpl.price > 0 && <span className="strip-price" style={{ fontSize: U(L.price), marginTop: U(12) }}>Rp {tpl.price.toLocaleString("id-ID")}</span>}
                  </button>
                );
              })}
              {templates.length > 2 && <div className="flex-none" style={{ width: U(32) }} aria-hidden="true" />}
            </div>
          )}
        </div>

        <div className="strip-tabs" style={{ left: U(L.tabs.left), width: U(L.tabs.width), top: U(L.tabs.top), height: U(57) }}>
          <span className="strip-tab strip-tab--title" style={{ height: U(57), padding: `0 ${U(32)}`, fontSize: U(28) }}>{category?.label}</span>
          {hint && <span className="strip-tab strip-tab--sub" style={{ height: U(45), marginLeft: U(-104), padding: `0 ${U(21)} 0 ${U(120)}`, fontSize: U(26) }}>{hint}</span>}
        </div>

        <button onClick={() => dispatch({ type: "BACK_TO_CATEGORY" })} className="strip-btn" style={{ left: U(L.back.left), top: U(L.back.top), width: U(192), height: U(63), fontSize: U(30) }}>BACK</button>
        {selectedTemplate && (
          <button onClick={() => dispatch({ type: "GO_TO_PAYMENT" })} className="strip-btn strip-btn--next" style={{ left: U(L.next.left), top: U(L.next.top), width: U(192), height: U(63), fontSize: U(30) }}>NEXT →</button>
        )}
      </div>
    </div>
  );
}
