import React, { useRef, useState } from "react";
import { ChevronLeft, Trash2 } from "lucide-react";
import { LayerContent, LayerBox, containerStyle } from "../components/TemplatePreview";
import SesiDecor from "../components/SesiDecor";
import StickerStep, { StickerStatic } from "../components/StickerStep";
import { photoSlotPlan } from "../utils/templatePhotos";
import { getFilterOptions } from "../utils/filters";
import FilteredImg from "../components/FilteredImg";
import { trackPointerDrag } from "../utils/dragGesture";
import ScrollButtons from "../components/ScrollButtons";
import appConfig from "../config/appConfig";
import useCountdown from "../hooks/useCountdown";
import useShape from "../hooks/useShape";

// Satuan desain: 1 = 1px pada kanvas 1728x1117 (lihat .strip-screen di index.css)
const U = (n) => `calc(var(--u) * ${n})`;
const fit = (ar, maxW, maxH) => (ar >= maxW / maxH ? { w: maxW, h: maxW / ar } : { w: maxH * ar, h: maxH });

// Posisi per bentuk layar. Landscape = desain "Edit frame" (kanvas 1728x1117); portrait = kanvas 1080x1800 (bingkai + daftar foto di atas, pengaturan di bawah).
const LAYOUT = {
  landscape: {
    card: { left: 65.5, top: 55.5, width: 1598, height: 1006, r: 72.5 }, divider: { left: 977, top: 116, width: 1, height: 857 }, timer: { left: 1341, top: 8 },
    preview: { x: 170, y: 245, w: 381, h: 566 }, list: { left: 630, top: 168, width: 294, height: 809 }, tile: { w: 244, h: 162.7, gap: 27 },
    scroll: { up: { left: 928, top: 168 }, down: { left: 928, top: 931 }, track: { left: 947, top: 232, height: 640 } },
    mirror: { left: 1116, top: 114 }, filters: { left: 1041, top: 242, width: 539, height: 402, cols: 3, centers: [135, 273, 411] },
    glass: { left: 993, top: 81, width: 635, height: 941, r: 70 }, next: { left: 1134, top: 726, topLater: 761 }, trash: { left: 318, top: 859 }, back: { left: 170, top: 857 },
    hint: { left: 1000, top: 850, width: 620 },
  },
  square: {
    card: { left: 20, top: 80, width: 1160, height: 1040, r: 72.5 }, divider: { left: 690, top: 130, width: 1, height: 960 }, timer: { left: 520, top: 30 },
    preview: { x: 70, y: 150, w: 300, h: 740 }, list: { left: 400, top: 150, width: 270, height: 880 }, tile: { w: 230, h: 153.3, gap: 24 },
    scroll: { up: { left: 674, top: 150 }, down: { left: 674, top: 984 }, track: { left: 693, top: 214, height: 711 } },
    mirror: { left: 742, top: 150, scale: 0.85 }, filters: { left: 730, top: 270, width: 410, height: 580, cols: 3, centers: [75, 205, 335] },
    glass: { left: 700, top: 110, width: 470, height: 1000, r: 70 }, next: { left: 753, top: 900, topLater: 900 }, trash: { left: 171, top: 920 }, back: { left: 70, top: 920 },
    hint: { left: 710, top: 1020, width: 450 },
  },
  portrait: {
    card: { left: 30, top: 56, width: 1020, height: 1690, r: 72.5 }, divider: { left: 90, top: 905, width: 900, height: 1 }, timer: { left: 460, top: 8 },
    preview: { x: 60, y: 110, w: 450, h: 660 }, list: { left: 540, top: 110, width: 410, height: 770 }, tile: { w: 340, h: 226.7, gap: 24 },
    scroll: { up: { left: 958, top: 110 }, down: { left: 958, top: 834 }, track: { left: 977, top: 174, height: 601 } },
    mirror: { left: 308, top: 950 }, filters: { left: 90, top: 1060, width: 900, height: 420, cols: 4, centers: [112, 337, 562, 787] },
    glass: { left: 60, top: 925, width: 960, height: 800, r: 70 }, next: { left: 358, top: 1600, topLater: 1600 }, trash: { left: 236, top: 782 }, back: { left: 60, top: 782 },
    hint: { left: 140, top: 1510, width: 800 },
  },
};

/**
 * Tahap 6: Pilih & Edit Foto (desain "Edit frame"), 3 langkah di satu layar:
 *  1. "pick"     : pilih foto dari daftar (scroll atas-bawah, di samping bingkai template) untuk mengisi bingkai.
 *                  Foto di bingkai bisa dilepas: klik foto lalu tombol hapus, atau seret foto ke tombol hapus.
 *                  Mirror & filter masih buram/terkunci. Setelah bingkai penuh muncul tombol NEXT.
 *  2. "style"    : Mirror/No Mirror + filter terbuka. Tombol kembali -> langkah 1, NEXT -> langkah 3.
 *  3. "stickers" : tambah stiker. Tombol kembali -> langkah 2, NEXT -> hasil.
 * Pratinjau template di kiri memakai renderer yang sama dengan composeImage (apa yang dilihat = hasil akhir).
 */
export default function EditorScreen({ session, dispatch }) {
  const shape = useShape();
  const portrait = shape === "portrait";
  const L = LAYOUT[shape];
  const PREVIEW_BOX = L.preview, TILE = L.tile;
  const { remaining } = useCountdown(appConfig.timers.editor, () => dispatch({ type: "FINISH_EDITOR" }), true);
  const timerText = `${String(Math.floor(remaining / 60)).padStart(2, "0")}.${String(remaining % 60).padStart(2, "0")}`;

  const [phaseRaw, setPhase] = useState("pick"); // pick | style | stickers
  const [selectedSlotRaw, setSelectedSlot] = useState(null); // nomor slot terisi yang dipilih (untuk hapus / diganti)
  const [drag, setDrag] = useState(null); // { shot, fromSlot, x, y, overTrash, overSlot }
  const trashRef = useRef(null);
  const listRef = useRef(null);
  const suppressClick = useRef(false);

  const template = session.selectedTemplate;
  const layers = template?.layers ?? [];
  const cw = template?.canvasWidth ?? 1200;
  const ch = template?.canvasHeight ?? 1800;
  const plan = photoSlotPlan(layers);
  const requiredSlots = plan.count || 1;
  // chosen[n] = indeks foto di slot n, atau null kalau slot kosong
  const chosen = Array.from({ length: requiredSlots }, (_, i) => session.photosForTemplate[i] ?? null);
  const filled = chosen.filter((v) => v != null).length;
  const full = filled >= requiredSlots;
  const { filter, mirror } = session.editorState;
  // Turunan: pilihan yang slotnya sudah kosong diabaikan; bingkai tidak penuh -> kembali ke langkah 1
  const selectedSlot = selectedSlotRaw != null && chosen[selectedSlotRaw] != null ? selectedSlotRaw : null;
  const phase = full ? phaseRaw : "pick";

  const photoAssignment = new Map();
  plan.slots.forEach((l) => photoAssignment.set(l.id, session.photosForTemplate[plan.indexByLayer.get(l.id)] ?? undefined));

  const frame = fit(cw / ch, PREVIEW_BOX.w, PREVIEW_BOX.h);
  const filterOptions = getFilterOptions();
  const swatchPhoto = session.shots[chosen.find((v) => v != null)] ?? session.shots[0];

  const removeSlot = (slot) => {
    dispatch({ type: "REMOVE_PHOTO_FROM_TEMPLATE", payload: { slot } });
    setSelectedSlot(null);
  };
  const assign = (slot, shot) => {
    dispatch({ type: "ASSIGN_PHOTO", payload: { slot, shot } });
    setSelectedSlot(null);
  };

  // ---- Seret foto: dari daftar ATAU dari slot di bingkai. Tujuan: slot mana pun (isi / ganti / tukar) atau tombol hapus.
  //      Dilepas di tempat lain = batal, foto kembali & tidak ada yang berubah. ----
  const overTrash = (x, y) => {
    const r = trashRef.current?.getBoundingClientRect();
    if (!r) return false;
    const m = 18;
    return x >= r.left - m && x <= r.right + m && y >= r.top - m && y <= r.bottom + m;
  };
  const slotAt = (x, y) => {
    for (const el of document.elementsFromPoint(x, y)) if (el.dataset?.slot !== undefined) return Number(el.dataset.slot);
    return null;
  };
  const startDrag = (e, shot, fromSlot) => {
    if (phase !== "pick" || shot == null) return;
    const info = (ev) => ({ shot, fromSlot, x: ev.clientX, y: ev.clientY, overTrash: overTrash(ev.clientX, ev.clientY), overSlot: slotAt(ev.clientX, ev.clientY) });
    trackPointerDrag(e, {
      scrollEl: fromSlot == null ? listRef.current : null, // dari daftar: geser atas-bawah = scroll, geser jelas ke samping = seret
      onMove: (ev) => setDrag(info(ev)),
      onEnd: (ev, released, kind) => {
        suppressClick.current = true;
        setTimeout(() => { suppressClick.current = false; }, 0);
        if (kind === "drag" && released) {
          const d = info(ev);
          const at = chosen.indexOf(shot);
          if (d.overTrash) { if (at >= 0) removeSlot(at); }
          else if (d.overSlot != null) assign(d.overSlot, shot);
        }
        setDrag(null);
      },
    });
  };

  const onTileClick = (shot) => {
    if (suppressClick.current || phase !== "pick") return;
    const pos = chosen.indexOf(shot);
    if (pos >= 0) { setSelectedSlot((s) => (s === pos ? null : pos)); return; } // foto terpakai: pilih slotnya
    if (selectedSlot != null) { assign(selectedSlot, shot); return; } // ada slot terpilih: ganti isinya
    if (!full) { dispatch({ type: "TOGGLE_PHOTO_FOR_TEMPLATE", payload: { shotIndex: shot } }); setSelectedSlot(null); } // isi slot kosong berikutnya
  };

  const locked = phase === "pick";

  // Langkah 3: halaman terpisah "Add sticker"
  if (phase === "stickers") {
    return <StickerStep session={session} dispatch={dispatch} photoAssignment={photoAssignment} timerText={timerText}
      onBack={() => setPhase("style")} onFinish={() => dispatch({ type: "FINISH_EDITOR" })} />;
  }

  return (
    <div className="kiosk-screen strip-screen h-full w-full overflow-hidden select-none" data-shape={shape}>
      <div className="absolute inset-0"><SesiDecor /></div>

      <div className="strip-stage">
        {/* Kartu putih */}
        <div style={{ left: U(L.card.left), top: U(L.card.top), width: U(L.card.width), height: U(L.card.height), background: "#fff", border: "3px solid #000", borderRadius: U(L.card.r), boxSizing: "border-box" }} />
        <div style={{ left: U(L.divider.left), top: U(L.divider.top), width: L.divider.width > 1 ? U(L.divider.width) : 1, height: L.divider.height > 1 ? U(L.divider.height) : 1, background: "#CECECE" }} />
        <div className="pay-timer" role="timer" style={{ left: U(L.timer.left), top: U(L.timer.top), width: U(161), height: U(40), fontSize: U(28) }}>{timerText}</div>

        {/* Pratinjau template (bingkai) */}
        <div style={{ left: U(PREVIEW_BOX.x), top: U(PREVIEW_BOX.y), width: U(PREVIEW_BOX.w), height: U(PREVIEW_BOX.h), display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="relative overflow-hidden" style={{ ...containerStyle, width: U(frame.w), height: U(frame.h), background: template?.backgroundColor || "#fff", boxShadow: "0 2px 10px rgba(0,0,0,.25)" }}>
            {layers.filter((l) => l.visible !== false).map((layer) => {
              const shotIndex = layer.type === "photo-slot" ? photoAssignment.get(layer.id) : undefined;
              return (
                <LayerBox key={layer.id} layer={layer} canvasWidth={cw}>
                  <LayerContent layer={layer} canvasWidth={cw} canvasHeight={ch}
                    photoUrl={shotIndex !== undefined ? session.shots[shotIndex] : undefined}
                    filterId={filter} mirror={mirror} />
                </LayerBox>
              );
            })}

            {/* Area sentuh tiap slot: ketuk = pilih, seret = pindah/tukar, dan jadi tujuan lepas foto */}
            {phase === "pick" && plan.slots.map((layer) => {
              const idx = plan.indexByLayer.get(layer.id);
              const shot = chosen[idx];
              const isOver = drag?.overSlot === idx;
              return (
                <div key={`hit-${layer.id}`} data-slot={idx}
                  onPointerDown={(e) => shot != null && startDrag(e, shot, idx)}
                  onClick={() => { if (!suppressClick.current && shot != null) setSelectedSlot((s) => (s === idx ? null : idx)); }}
                  style={{
                    position: "absolute", left: `${layer.xPct}%`, top: `${layer.yPct}%`, width: `${layer.widthPct}%`, height: `${layer.heightPct}%`,
                    transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined, touchAction: "none", cursor: shot != null ? "grab" : "default", boxSizing: "border-box",
                    outline: isOver ? "4px solid #E02843" : selectedSlot === idx ? "3px solid #E02843" : drag ? "2px dashed rgba(255,255,255,.9)" : "none", outlineOffset: -3,
                    background: isOver ? "rgba(224,40,67,.22)" : "transparent", zIndex: 5,
                  }} />
              );
            })}

            {/* Stiker yang sudah ditaruh (diatur di halaman Add sticker) */}
            <StickerStatic stickers={session.editorState.stickers} />
          </div>
        </div>

        {/* Daftar foto (scroll atas-bawah) di dekat bingkai */}
        <div style={{ left: U(L.list.left), top: U(L.list.top), width: U(L.list.width), height: U(L.list.height), background: "#F5F5F5", borderRadius: U(34), overflow: "hidden" }}>
          <div ref={listRef} className="ed-list" style={{ position: "absolute", inset: 0, touchAction: "pan-y", overflowY: "auto", overflowX: "hidden", padding: `${U(24)} 0`, display: "flex", flexDirection: "column", alignItems: "center", gap: U(TILE.gap), scrollbarWidth: "none" }}>
            {session.shots.map((shot, i) => {
              const pos = chosen.indexOf(i);
              const used = pos >= 0;
              const dim = !used && phase !== "pick";
              return (
                <button key={i} type="button" onClick={() => onTileClick(i)} onPointerDown={(e) => startDrag(e, i, null)}
                  aria-label={used ? `Foto ${i + 1}, ada di bingkai posisi ${pos + 1}` : `Pilih foto ${i + 1}`}
                  style={{
                    position: "relative", flex: "none", width: U(TILE.w), height: U(TILE.h), padding: 0, border: 0, borderRadius: U(8), overflow: "hidden", background: "#ddd",
                    touchAction: "none", opacity: drag?.shot === i ? 0.4 : dim ? 0.45 : 1,
                    outline: selectedSlot === pos && used ? `${U(5)} solid #E02843` : used ? `${U(4)} solid #FDB533` : "none", outlineOffset: U(-4),
                  }}>
                  <img src={shot} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none", transform: mirror ? "scaleX(-1)" : undefined }} />
                  {used && (
                    <span style={{ position: "absolute", top: U(8), left: U(8), width: U(40), height: U(40), borderRadius: "50%", background: "#FDB533", border: "1px solid #000", color: "#3A2E00", fontWeight: 800, fontSize: U(24), display: "flex", alignItems: "center", justifyContent: "center" }}>{pos + 1}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Bantuan scroll untuk daftar foto: tombol ▲ ▼ + penanda posisi, di celah antara daftar dan garis pemisah */}
        <ScrollButtons scrollRef={listRef} deps={session.shots.length} size={46}
          up={L.scroll.up} down={L.scroll.down} track={L.scroll.track} />

        {/* ===== Panel kanan ===== */}
        <>
            <div style={{ left: 0, top: 0, width: "100%", height: "100%", pointerEvents: locked ? "none" : "auto", filter: locked ? `blur(${U(9)})` : "none", transition: "filter .25s ease" }} aria-hidden={locked}>
              {/* Mirror / No Mirror */}
              <div style={{ position: "absolute", left: U(L.mirror.left), top: U(L.mirror.top), width: U(464), height: U(80), borderRadius: U(40), background: "#DBDBDB", overflow: "hidden", transform: L.mirror.scale ? `scale(${L.mirror.scale})` : undefined, transformOrigin: "left top" }}>
                <div style={{ position: "absolute", top: 0, height: "100%", borderRadius: U(40), background: "#E02843", transition: "left .2s ease, width .2s ease", left: mirror ? 0 : U(185), width: mirror ? U(196) : U(279) }} />
                <button type="button" tabIndex={locked ? -1 : 0} onClick={() => dispatch({ type: "SET_MIRROR", payload: { mirror: true } })} style={toggleText(0, 196)}>Mirror</button>
                <button type="button" tabIndex={locked ? -1 : 0} onClick={() => dispatch({ type: "SET_MIRROR", payload: { mirror: false } })} style={toggleText(185, 279)}>No Mirror</button>
              </div>

              {/* Filter */}
              <div style={{ position: "absolute", left: U(L.filters.left), top: U(L.filters.top), width: U(L.filters.width), height: U(L.filters.height), borderRadius: U(32), background: "#F5F5F5", overflow: "hidden" }}>
                {/* Daftar filter buatan admin: 3 kolom, bisa digulir kalau lebih dari 6 */}
                <div className="ed-list" style={{ position: "absolute", inset: 0, overflowY: "auto", overflowX: "hidden", touchAction: "pan-y", scrollbarWidth: "none" }}>
                  <div style={{ position: "relative", height: U(33 + (Math.ceil(filterOptions.length / L.filters.cols) - 1) * 186 + 165 + 24) }}>
                    {filterOptions.map((f, i) => {
                      const cx = L.filters.centers[i % L.filters.cols];
                      const top = 33 + Math.floor(i / L.filters.cols) * 186;
                      const on = filter === f.id;
                      return (
                        <button key={f.id} type="button" tabIndex={locked ? -1 : 0} onClick={() => dispatch({ type: "SET_FILTER", payload: { filter: f.id } })}
                          style={{ position: "absolute", left: U(cx - 66.5), top: U(top), width: U(133), height: U(165), padding: 0, border: 0, borderRadius: U(32), background: on ? "#E2E2E2" : "transparent", display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <span style={{ marginTop: U(13), width: U(110), height: U(110), borderRadius: "50%", overflow: "hidden", display: "block", background: "#ccc" }}>
                            {swatchPhoto && <FilteredImg src={swatchPhoto} filterId={f.id} maxSide={260} mirror={mirror} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                          </span>
                          <span style={{ marginTop: U(8), fontSize: U(22), lineHeight: 1.1, color: "#222", fontWeight: 500, textAlign: "center", padding: `0 ${U(6)}` }}>{f.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {filterOptions.length > L.filters.cols * 2 && <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: U(40), background: "linear-gradient(transparent, rgba(245,245,245,.97) 60%)", pointerEvents: "none", display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: U(4), fontSize: U(20), color: "#777" }}>Geser untuk filter lainnya ▾</div>}
              </div>
            </div>
            {/* Bingkai kaca saat masih terkunci (desain: panel abu-abu di belakang konten buram) */}
            {locked && <div style={{ left: U(L.glass.left), top: U(L.glass.top), width: U(L.glass.width), height: U(L.glass.height), borderRadius: U(L.glass.r), background: "rgba(245,245,245,.72)", pointerEvents: "none" }} />}
          </>
        {/* NEXT: muncul setelah bingkai penuh */}
        {full && (
          <button type="button" className="strip-btn" onClick={() => (phase === "pick" ? setPhase("style") : phase === "style" ? setPhase("stickers") : dispatch({ type: "FINISH_EDITOR" }))}
            style={{ left: U(L.next.left), top: U(phase === "pick" ? L.next.top : L.next.topLater), width: U(364), height: U(97), fontSize: U(66) }}>NEXT</button>
        )}

        {/* Kiri bawah: hapus (langkah 1) / kembali (langkah 2-3) */}
        {phase === "pick" ? (
          <button ref={trashRef} type="button" className="strip-btn" aria-label="Hapus foto dari bingkai"
            disabled={selectedSlot === null} onClick={() => selectedSlot !== null && removeSlot(selectedSlot)}
            style={{ left: U(L.trash.left), top: U(L.trash.top), width: U(98), height: U(98), padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
              opacity: selectedSlot === null && !drag ? 0.55 : 1, transform: drag?.overTrash ? "scale(1.25)" : undefined, background: drag?.overTrash ? "#B81C34" : undefined, transition: "transform .12s, opacity .15s" }}>
            <Trash2 color="#fff" strokeWidth={2.6} style={{ width: U(44), height: U(44) }} />
          </button>
        ) : (
          <button type="button" className="strip-btn" aria-label="Kembali" onClick={() => setPhase(phase === "stickers" ? "style" : "pick")}
            style={{ left: U(L.back.left), top: U(L.back.top), width: U(97), height: U(97), padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ChevronLeft color="#fff" strokeWidth={3.4} style={{ width: U(52), height: U(52) }} />
          </button>
        )}

        {/* Petunjuk singkat langkah 1 */}
        {phase === "pick" && (
          <p style={{ left: U(L.hint.left), top: U(L.hint.top), width: U(L.hint.width), textAlign: "center", fontSize: U(24), fontStyle: "italic", fontWeight: 700, color: "#55606E", margin: 0 }}>
            {filled}/{requiredSlots} foto terpilih{full ? " — seret foto untuk ganti / tukar posisi" : " — ketuk atau seret foto ke bingkai"}
          </p>
        )}
      </div>

      {/* Foto yang sedang diseret */}
      {drag && (
        <img src={session.shots[drag.shot]} alt="" draggable={false}
          style={{ position: "fixed", left: drag.x, top: drag.y, width: 110, height: 73, objectFit: "cover", transform: `translate(-50%, -50%)${mirror ? " scaleX(-1)" : ""}`, borderRadius: 8, border: "3px solid #E02843", boxShadow: "0 6px 18px rgba(0,0,0,.35)", pointerEvents: "none", zIndex: 60, opacity: 0.92 }} />
      )}
    </div>
  );
}

function toggleText(left, width) {
  return {
    position: "absolute", top: 0, height: "100%", left: `calc(var(--u) * ${left})`, width: `calc(var(--u) * ${width})`, background: "transparent", border: 0, padding: 0,
    color: "#fff", fontStyle: "italic", fontWeight: 800, fontSize: "calc(var(--u) * 42)", whiteSpace: "nowrap",
  };
}
