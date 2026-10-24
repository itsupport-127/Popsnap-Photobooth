import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Check, X, RotateCw } from "lucide-react";
import { LayerContent, LayerBox, containerStyle } from "./TemplatePreview";
import SesiDecor from "./SesiDecor";
import { listStickers } from "../services/stickerService";
import { trackPointerDrag } from "../utils/dragGesture";
import ScrollButtons from "./ScrollButtons";
import useShape from "../hooks/useShape";

// Satuan desain: 1 = 1px pada kanvas 1728x1117 (lihat .strip-screen di index.css)
const U = (n) => `calc(var(--u) * ${n})`;
const fit = (ar, maxW, maxH) => (ar >= maxW / maxH ? { w: maxW, h: maxW / ar } : { w: maxH * ar, h: maxH });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// Posisi per bentuk layar (landscape: kanvas 1728x1117; portrait: kanvas 1080x1800 — bingkai di atas, daftar stiker di bawah)
const LAYOUT = {
  landscape: {
    preview: { x: 203, y: 306, w: 433, h: 645.5 }, cell: 76.375, cols: 8, title: { left: 676, top: 79 }, timer: { left: 1341, top: 8 }, back: { left: 88, top: 68 }, finish: { left: 1531, top: 926 },
    card: { left: 65.5, top: 217.5, width: 1598, height: 844 }, divider: { left: 763.5, top: 268, width: 1, height: 716 },
    tabs: { left: 843, top: 236, width: 790 }, list: { left: 835, width: 805, bottom: 985, gridTop: 271, gridTopTabs: 296 },
    scroll: { x: 1600, downTop: 860, trackX: 1619, trackBottom: 860 }, hint: { left: 843, top: 1008, width: 660 },
  },
  square: {
    preview: { x: 60, y: 240, w: 330, h: 840 }, cell: 110, cols: 5, title: { left: 386, top: 70 }, timer: { left: 520, top: 8 }, back: { left: 40, top: 60 }, finish: { left: 1060, top: 1050 },
    card: { left: 30, top: 200, width: 1140, height: 960 }, divider: { left: 420, top: 250, width: 1, height: 880 },
    tabs: { left: 460, top: 232, width: 620 }, list: { left: 440, width: 650, bottom: 1030, gridTop: 270, gridTopTabs: 298 },
    scroll: { x: 1096, downTop: 984, trackX: 1115, trackBottom: 984 }, hint: { left: 460, top: 1100, width: 560 },
  },
  portrait: {
    preview: { x: 60, y: 230, w: 960, h: 780 }, cell: 108, cols: 7, title: { left: 326, top: 70 }, timer: { left: 460, top: 8 }, back: { left: 40, top: 60 }, finish: { left: 930, top: 1640 },
    card: { left: 30, top: 200, width: 1020, height: 1560 }, divider: { left: 90, top: 1030, width: 900, height: 1 },
    tabs: { left: 60, top: 1050, width: 900 }, list: { left: 60, width: 900, bottom: 1620, gridTop: 1075, gridTopTabs: 1110 },
    scroll: { x: 968, downTop: 1574, trackX: 987, trackBottom: 1574 }, hint: { left: 90, top: 1680, width: 800 },
  },
};
const DEFAULT_W = 20; // lebar stiker baru (% lebar kanvas)

/** Stiker yang sudah ditaruh, tanpa interaksi (dipakai pratinjau di langkah filter). */
export function StickerStatic({ stickers = [] }) {
  return stickers.map((st) => st?.src && (
    <img key={st.id} src={st.src} alt="" draggable={false}
      style={{ position: "absolute", left: `${st.x}%`, top: `${st.y}%`, width: `${st.w}%`, aspectRatio: `${st.ar || 1}`, transform: `translate(-50%, -50%) rotate(${st.rot || 0}deg)`, pointerEvents: "none", zIndex: 6 }} />
  ));
}

/**
 * Halaman "Add sticker" (halaman terpisah setelah filter).
 *  - Seret stiker dari daftar ke bingkai, ATAU ketuk stiker lalu ketuk lokasi di bingkai.
 *  - Stiker di bingkai: seret = pindah, ketuk = pilih; tombol ✕ hapus, pegangan kanan-bawah = ubah ukuran + putar.
 *  - Kategori stiker (kalau admin membuatnya) tampil sebagai tab di atas daftar.
 */
export default function StickerStep({ session, dispatch, photoAssignment, timerText, onBack, onFinish }) {
  const shape = useShape();
  const L = LAYOUT[shape];
  const PREVIEW_BOX = L.preview, CELL = L.cell;
  const template = session.selectedTemplate;
  const layers = template?.layers ?? [];
  const cw = template?.canvasWidth ?? 1200;
  const ch = template?.canvasHeight ?? 1800;
  const { filter, mirror, stickers } = session.editorState;

  const [lib, setLib] = useState(null); // hasil listStickers()
  const [cat, setCat] = useState("all"); // all | id kategori | none
  const [armed, setArmed] = useState(null); // stiker (dari daftar) yang siap ditaruh dengan ketukan
  const [selectedId, setSelectedId] = useState(null);
  const [drag, setDrag] = useState(null); // { sticker, x, y, over }
  const frameRef = useRef(null);
  const listRef = useRef(null);
  const suppressClick = useRef(false);

  useEffect(() => { let off = false; listStickers().then((d) => !off && setLib(d)); return () => { off = true; }; }, []);

  const frame = fit(cw / ch, PREVIEW_BOX.w, PREVIEW_BOX.h);
  const cats = lib?.categories ?? [];
  const showTabs = cats.length > 0;
  const shown = useMemo(() => {
    const all = lib?.stickers ?? [];
    if (cat === "all") return all;
    if (cat === "none") return all.filter((s) => !s.categoryId);
    return all.filter((s) => s.categoryId === cat);
  }, [lib, cat]);

  const selected = stickers.find((s) => s.id === selectedId) ? selectedId : null;

  const pointInFrame = (cx, cy) => {
    const r = frameRef.current?.getBoundingClientRect();
    if (!r) return null;
    if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null;
    return { x: ((cx - r.left) / r.width) * 100, y: ((cy - r.top) / r.height) * 100 };
  };

  const place = useCallback((sticker, pt) => {
    const id = `st-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const ar = sticker.width && sticker.height ? sticker.width / sticker.height : 1;
    dispatch({ type: "ADD_STICKER", payload: { sticker: { id, src: sticker.url, ar, x: clamp(pt.x, 0, 100), y: clamp(pt.y, 0, 100), w: DEFAULT_W, rot: 0 } } });
    setSelectedId(id);
  }, [dispatch]);

  // ---- Seret dari daftar ke bingkai (pointer events: jalan di mouse & layar sentuh) ----
  const beginPaletteDrag = (e, sticker) => {
    trackPointerDrag(e, {
      scrollEl: listRef.current, // geser atas-bawah = scroll daftar, geser jelas ke samping = seret stiker
      onMove: (ev) => setDrag({ sticker, x: ev.clientX, y: ev.clientY, over: !!pointInFrame(ev.clientX, ev.clientY) }),
      onEnd: (ev, released, kind) => {
        suppressClick.current = true;
        setTimeout(() => { suppressClick.current = false; }, 0);
        if (kind === "drag" && released) {
          const pt = pointInFrame(ev.clientX, ev.clientY);
          if (pt) { place(sticker, pt); setArmed(null); } // dilepas di luar bingkai = batal
        }
        setDrag(null);
      },
    });
  };

  // ---- Pindah stiker yang sudah di bingkai ----
  const beginMove = (e, st) => {
    e.stopPropagation();
    setSelectedId(st.id);
    const r = frameRef.current?.getBoundingClientRect();
    if (!r) return;
    const sx = e.clientX, sy = e.clientY, x0 = st.x, y0 = st.y;
    const move = (ev) => dispatch({ type: "UPDATE_STICKER", payload: { id: st.id, patch: {
      x: clamp(x0 + ((ev.clientX - sx) / r.width) * 100, 0, 100), y: clamp(y0 + ((ev.clientY - sy) / r.height) * 100, 0, 100) } } });
    const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  // ---- Ubah ukuran + putar lewat pegangan kanan-bawah ----
  const beginResize = (e, st) => {
    e.stopPropagation();
    e.preventDefault();
    const r = frameRef.current?.getBoundingClientRect();
    if (!r) return;
    const cx = r.left + (st.x / 100) * r.width, cy = r.top + (st.y / 100) * r.height;
    const d0 = Math.max(8, Math.hypot(e.clientX - cx, e.clientY - cy));
    const a0 = Math.atan2(e.clientY - cy, e.clientX - cx);
    const w0 = st.w, rot0 = st.rot || 0;
    const move = (ev) => {
      const d = Math.hypot(ev.clientX - cx, ev.clientY - cy);
      const a = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      dispatch({ type: "UPDATE_STICKER", payload: { id: st.id, patch: { w: clamp(w0 * (d / d0), 4, 90), rot: Math.round((rot0 + ((a - a0) * 180) / Math.PI) * 10) / 10 } } });
    };
    const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const remove = (id) => { dispatch({ type: "REMOVE_STICKER", payload: { id } }); setSelectedId(null); };

  useEffect(() => {
    const onKey = (e) => { if ((e.key === "Delete" || e.key === "Backspace") && selected) remove(selected); if (e.key === "Escape") { setArmed(null); setSelectedId(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Ketuk bingkai kosong: taruh stiker yang sedang "siap", atau batalkan pilihan
  const onFrameClick = (e) => {
    if (suppressClick.current) return;
    if (armed) { const pt = pointInFrame(e.clientX, e.clientY); if (pt) place(armed, pt); }
    else setSelectedId(null);
  };

  const onTileClick = (s) => {
    if (suppressClick.current) return;
    setArmed((a) => (a?.id === s.id ? null : s));
    setSelectedId(null);
  };

  const tabTop = L.tabs.top, gridTop = showTabs ? L.list.gridTopTabs : L.list.gridTop;

  return (
    <div className="kiosk-screen strip-screen h-full w-full overflow-hidden select-none" data-shape={shape}>
      <div className="absolute inset-0"><SesiDecor /></div>
      <div className="strip-stage">
        <div className="pay-title" style={{ left: U(L.title.left), top: U(L.title.top), width: U(427), height: U(96), fontSize: U(60) }}>Add sticker</div>
        <div className="pay-timer" role="timer" style={{ left: U(L.timer.left), top: U(L.timer.top), width: U(161), height: U(40), fontSize: U(28) }}>{timerText}</div>

        {/* Kartu putih + garis pemisah */}
        <div style={{ left: U(L.card.left), top: U(L.card.top), width: U(L.card.width), height: U(L.card.height), background: "#fff", border: "3px solid #000", borderRadius: U(72.5), boxSizing: "border-box" }} />
        <div style={{ left: U(L.divider.left), top: U(L.divider.top), width: L.divider.width > 1 ? U(L.divider.width) : 1, height: L.divider.height > 1 ? U(L.divider.height) : 1, background: "#CECECE" }} />

        {/* Bingkai template (area tujuan stiker) */}
        <div style={{ left: U(PREVIEW_BOX.x), top: U(PREVIEW_BOX.y), width: U(PREVIEW_BOX.w), height: U(PREVIEW_BOX.h), display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div ref={frameRef} onClick={onFrameClick} className="relative"
            style={{ width: U(frame.w), height: U(frame.h), boxShadow: drag?.over ? "0 0 0 3px #E02843" : armed ? "0 0 0 3px #FDB533" : "0 2px 10px rgba(0,0,0,.25)", cursor: armed ? "crosshair" : "default", touchAction: "none" }}>
            {/* Lapisan terpotong: template + stiker (sama dengan hasil akhir yang dipotong tepi kanvas) */}
            <div className="absolute inset-0 overflow-hidden" style={{ ...containerStyle, background: template?.backgroundColor || "#fff" }}>
              {layers.filter((l) => l.visible !== false).map((layer) => {
                const shotIndex = layer.type === "photo-slot" ? photoAssignment.get(layer.id) : undefined;
                return (
                  <LayerBox key={layer.id} layer={layer} canvasWidth={cw}>
                    <LayerContent layer={layer} canvasWidth={cw} canvasHeight={ch}
                      photoUrl={shotIndex !== undefined ? session.shots[shotIndex] : undefined} filterId={filter} mirror={mirror} />
                  </LayerBox>
                );
              })}
              {stickers.map((st) => st?.src && (
                <div key={st.id} onPointerDown={(e) => beginMove(e, st)} onClick={(e) => e.stopPropagation()}
                  style={{ position: "absolute", left: `${st.x}%`, top: `${st.y}%`, width: `${st.w}%`, aspectRatio: `${st.ar || 1}`, transform: `translate(-50%, -50%) rotate(${st.rot || 0}deg)`, cursor: "move", touchAction: "none", zIndex: st.id === selected ? 8 : 6 }}>
                  <img src={st.src} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none", display: "block" }} />
                  {st.id === selected && <div style={{ position: "absolute", inset: 0, border: "2px dashed #E02843", pointerEvents: "none" }} />}
                </div>
              ))}
            </div>

            {/* Tombol hapus & pegangan ukuran/putar: di lapisan tidak terpotong supaya tetap terlihat di tepi bingkai */}
            {stickers.filter((st) => st?.src && st.id === selected).map((st) => (
              <div key={`ctl-${st.id}`} style={{ position: "absolute", left: `${st.x}%`, top: `${st.y}%`, width: `${st.w}%`, aspectRatio: `${st.ar || 1}`, transform: `translate(-50%, -50%) rotate(${st.rot || 0}deg)`, pointerEvents: "none", zIndex: 9 }}>
                <button type="button" aria-label="Hapus stiker" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); remove(st.id); }}
                  style={{ position: "absolute", left: 0, top: 0, width: U(36), height: U(36), transform: "translate(-50%, -50%)", borderRadius: "50%", background: "#E02843", border: "1px solid #000", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, pointerEvents: "auto" }}>
                  <X color="#fff" strokeWidth={3.5} style={{ width: U(20), height: U(20) }} />
                </button>
                <div role="slider" aria-label="Ubah ukuran dan putar" onPointerDown={(e) => beginResize(e, st)}
                  style={{ position: "absolute", right: 0, bottom: 0, width: U(36), height: U(36), transform: "translate(50%, 50%)", borderRadius: "50%", background: "#fff", border: "2px solid #E02843", display: "flex", alignItems: "center", justifyContent: "center", cursor: "nwse-resize", touchAction: "none", pointerEvents: "auto" }}>
                  <RotateCw color="#E02843" strokeWidth={3} style={{ width: U(20), height: U(20) }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tab kategori (hanya kalau admin membuat kategori) */}
        {showTabs && (
          <div style={{ left: U(L.tabs.left), top: U(tabTop), width: U(L.tabs.width), display: "flex", gap: U(10), flexWrap: "nowrap", overflowX: "auto", scrollbarWidth: "none" }}>
            {[{ id: "all", label: "Semua" }, ...cats.map((c) => ({ id: c.id, label: c.label })), ...(lib?.uncategorized ? [{ id: "none", label: "Lainnya" }] : [])].map((c) => (
              <button key={c.id} type="button" onClick={() => setCat(c.id)}
                style={{ flex: "none", height: U(40), padding: `0 ${U(22)}`, borderRadius: 9999, border: "1px solid #000", fontSize: U(22), fontStyle: "italic", fontWeight: 700, background: cat === c.id ? "#E02843" : "#FFEAC5", color: cat === c.id ? "#fff" : "#000", whiteSpace: "nowrap" }}>
                {c.label}
              </button>
            ))}
          </div>
        )}

        {/* Daftar stiker */}
        <div ref={listRef} className="ed-list" style={{ touchAction: "pan-y", left: U(L.list.left), top: U(gridTop), width: U(L.list.width), height: U(L.list.bottom - gridTop), overflowY: "auto", overflowX: "hidden", scrollbarWidth: "none" }}>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${L.cols}, ${U(CELL)})`, columnGap: U(16), rowGap: U(20), padding: `${U(8)} ${U(16)}` }}>
            {shown.map((s) => (
              <button key={s.id} type="button" title={s.name} aria-label={`Stiker ${s.name || ""}`} onClick={() => onTileClick(s)} onPointerDown={(e) => beginPaletteDrag(e, s)}
                style={{ width: U(CELL), height: U(CELL), padding: U(4), border: 0, borderRadius: U(16), boxSizing: "border-box", touchAction: "none",
                  background: armed?.id === s.id ? "#FDE8EB" : "transparent", outline: armed?.id === s.id ? `${U(3)} solid #E02843` : "none" }}>
                <img src={s.url} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} />
              </button>
            ))}
          </div>
          {lib && shown.length === 0 && <p style={{ textAlign: "center", color: "#55606E", fontStyle: "italic", fontSize: U(26) }}>Belum ada stiker di kategori ini.</p>}
        </div>

        <ScrollButtons scrollRef={listRef} deps={shown.length} size={46}
          up={{ left: L.scroll.x, top: gridTop }} down={{ left: L.scroll.x, top: L.scroll.downTop }} track={{ left: L.scroll.trackX, top: gridTop + 56, height: L.scroll.downTop - gridTop - 66 }} />

        <p style={{ left: U(L.hint.left), top: U(L.hint.top), width: U(L.hint.width), margin: 0, whiteSpace: "nowrap", fontSize: U(22), fontStyle: "italic", fontWeight: 600, color: "#55606E" }}>
          {armed ? "Ketuk lokasi di foto untuk menaruh stiker" : "Seret stiker ke foto, atau ketuk stiker lalu ketuk lokasinya"}
        </p>

        {/* Kembali (ke filter) & selesai */}
        <button type="button" className="strip-btn" aria-label="Kembali" onClick={onBack}
          style={{ left: U(L.back.left), top: U(L.back.top), width: U(97), height: U(97), padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ChevronLeft color="#fff" strokeWidth={3.4} style={{ width: U(52), height: U(52) }} />
        </button>
        <button type="button" className="strip-btn" aria-label="Selesai" onClick={onFinish}
          style={{ left: U(L.finish.left), top: U(L.finish.top), width: U(97), height: U(97), padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Check color="#fff" strokeWidth={4} style={{ width: U(54), height: U(54) }} />
        </button>
      </div>

      {drag && (
        <img src={drag.sticker.url} alt="" draggable={false}
          style={{ position: "fixed", left: drag.x, top: drag.y, width: 84, height: 84, objectFit: "contain", transform: "translate(-50%, -50%)", pointerEvents: "none", zIndex: 60, opacity: 0.92, filter: "drop-shadow(0 6px 10px rgba(0,0,0,.35))" }} />
      )}
    </div>
  );
}
