import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import useCategories from "../hooks/useCategories";
import { slotColor } from "../utils/slotColors";
import CategoryManager from "./CategoryManager";
import {
  listTemplates, createTemplate, saveTemplate, uploadTemplateAsset, deleteTemplate, cleanupOrphanedFiles, auditTemplate, setTemplateFavorite, setTemplateAnimated,
} from "../services/templateService";
import { can } from "../services/authService";
import { LayerContent, LayerBox, layerBoxStyle, containerStyle, DEFAULT_SHADOW } from "../components/TemplatePreview";
import { photoSlotPlan } from "../utils/templatePhotos";
import TemplatePicker from "./TemplatePicker";
import { buildZipExport, exportFileName, parseImportFile, dataUrlToFile, printTestCopy } from "./templateIO";
import { chooseSaveTarget, chooseOpenFile } from "./saveFile";
import {
  PAPERS, DPIS, FONTS, SHAPES, UNITS, paperPx, fromPx, toPx, layerName,
  Icon, inputCls, PanelHeader, Field, NumInput, ToolbarButton, Modal, SliderRow, ColorRow,
} from "./editorKit";

/**
 * Template Editor (khusus ADMIN) — tampilan & alur ala dslrBooth:
 *  - Ukuran kertas / dpi dipilih DULU saat bikin template (bukan ditebak dari file gambar)
 *  - Kiri: ADD (Image, Photo From Booth, Text, Shape, Background Color) + LAYOUT
 *  - Tengah: kanvas (otomatis muat layar)
 *  - Kanan: INFO (X/Y/W/H/Rotate), ALIGN & DISTRIBUTE, LAYERS, OPTIONS
 *  - Undo / Redo, multi-select (Shift+klik), drag-reorder layer, lock, hide
 *
 * Posisi layer disimpan dalam PERSEN terhadap kanvas (xPct, yPct, widthPct,
 * heightPct) — format yang sama dengan sebelumnya, jadi template lama tetap jalan.
 * Urutan array: index 0 = paling belakang.
 */

const MIN_PX = 10;

function newId() { return crypto.randomUUID(); }

function normalizeLayers(layers) {
  return (layers ?? []).map((l) => ({ visible: true, locked: false, ...l }));
}

function stripOrigin(url) {
  // Simpan path relatif (/uploads/xxx) supaya tidak rusak kalau IP PC booth berubah
  return typeof url === "string" && url.includes("/uploads/") ? url.replace(/^https?:\/\/[^/]+/, "") : url;
}

function docFromTemplate(tpl) {
  return {
    layers: normalizeLayers(tpl.layers),
    meta: {
      name: tpl.name, category: tpl.category, price: tpl.price ?? 0,
      paperSize: tpl.paperSize || "custom", orientation: tpl.orientation || (tpl.canvasWidth > tpl.canvasHeight ? "landscape" : "portrait"),
      dpi: tpl.dpi || 300, canvasWidth: tpl.canvasWidth, canvasHeight: tpl.canvasHeight,
      backgroundColor: tpl.backgroundColor || "#ffffff",
    },
  };
}

export default function TemplateSlotEditor({ currentUser, onLogout }) {
  const navigate = useNavigate();
  // Template wajib punya minimal 1 "Photo From Booth" sebelum editor boleh ditutup / pindah / keluar
  function blockedNoSlot() {
    if (doc && !doc.layers.some((l) => l.type === "photo-slot")) {
      showToast("Tambahkan dulu minimal satu “Photo From Booth” di template ini sebelum keluar atau pindah template.");
      return true;
    }
    return false;
  }
  function goTo(path) {
    if (blockedNoSlot()) return;
    if (dirty && !confirm("Ada perubahan yang belum disimpan. Tinggalkan editor tanpa menyimpan?")) return;
    navigate(path);
  }
  const [templates, setTemplates] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [doc, setDoc] = useState(null); // { layers, meta }
  const docRef = useRef(null);
  const savedRef = useRef(null); // dokumen terakhir yang tersimpan — dipakai buat status "Tersimpan" setelah undo
  const histRef = useRef({ past: [], future: [], lastKey: null, lastTime: 0 });
  const [, bump] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [selectedIds, setSelectedIds] = useState([]);
  const [unit, setUnit] = useState("px");
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [modal, setModal] = useState(null); // "new" | "accounts" | null
  const { categories, reload: reloadCategories } = useCategories();
  const [catManager, setCatManager] = useState(false);
  const [dragLayerId, setDragLayerId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);

  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const [stage, setStage] = useState({ w: 800, h: 600 });
  const gestureRef = useRef(null);
  const imageInputRef = useRef(null);
  const replaceInputRef = useRef(null);
  const replaceIdRef = useRef(null);
  const importInputRef = useRef(null);
  const [busyMsg, setBusyMsg] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const showToast = (text) => { setToast(text); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 7000); };
  const [importAsk, setImportAsk] = useState(null); // hasil baca file impor, menunggu nama / kategori / harga
  const [importReport, setImportReport] = useState(null); // { title, intro, items: [{level, text}] }

  // ---------- Muat daftar template ----------
  useEffect(() => {
    listTemplates().then((data) => {
      setTemplates(data);
      if (data.length > 0) openTemplate(data[0]);
    });
  }, []);

  function openTemplate(tpl) {
    const d = docFromTemplate(tpl);
    docRef.current = d;
    savedRef.current = d;
    setDoc(d);
    setActiveId(tpl.id);
    setSelectedIds([]);
    setDirty(false);
    histRef.current = { past: [], future: [], lastKey: null, lastTime: 0 };
  }

  function requestOpenTemplate(tpl) {
    if (tpl.id === activeId) return;
    if (blockedNoSlot()) return;
    if (dirty && !confirm("Ada perubahan yang belum disimpan. Pindah template tanpa menyimpan?")) return;
    openTemplate(tpl);
  }

  // ---------- Ukuran area kanvas ----------
  useLayoutEffect(() => {
    if (!stageRef.current) return;
    const el = stageRef.current;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStage({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [!!doc]);

  useEffect(() => {
    function warn(e) { if (dirty || (doc && !doc.layers.some((l) => l.type === "photo-slot"))) { e.preventDefault(); e.returnValue = ""; } }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, doc]);

  // ---------- Dokumen + riwayat (undo/redo) ----------
  // key sama + berdekatan waktu = digabung jadi 1 langkah undo (misal 1 drag / ngetik angka)
  function applyDoc(next, key) {
    const h = histRef.current;
    const now = Date.now();
    if (!(key && key === h.lastKey && now - h.lastTime < 800)) {
      h.past.push(docRef.current);
      if (h.past.length > 100) h.past.shift();
      h.future = [];
    }
    h.lastKey = key || null;
    h.lastTime = now;
    docRef.current = next;
    setDoc(next);
    setDirty(true);
  }

  function undo() {
    const h = histRef.current;
    if (!h.past.length) return;
    h.future.push(docRef.current);
    const prev = h.past.pop();
    h.lastKey = null;
    docRef.current = prev; setDoc(prev); setDirty(prev !== savedRef.current); bump((n) => n + 1);
    setSelectedIds((ids) => ids.filter((id) => prev.layers.some((l) => l.id === id)));
  }
  function redo() {
    const h = histRef.current;
    if (!h.future.length) return;
    h.past.push(docRef.current);
    const next = h.future.pop();
    h.lastKey = null;
    docRef.current = next; setDoc(next); setDirty(next !== savedRef.current); bump((n) => n + 1);
    setSelectedIds((ids) => ids.filter((id) => next.layers.some((l) => l.id === id)));
  }

  function mutateLayers(fn, key) {
    const d = docRef.current;
    applyDoc({ ...d, layers: fn(d.layers) }, key);
  }
  function updateLayers(ids, patch, key) {
    mutateLayers((ls) => ls.map((l) => (ids.includes(l.id) ? { ...l, ...(typeof patch === "function" ? patch(l) : patch) } : l)), key);
  }
  function updateMeta(patch, key) {
    const d = docRef.current;
    applyDoc({ ...d, meta: { ...d.meta, ...patch } }, key);
  }

  // Ganti ukuran kanvas. mode "keep" = posisi PIKSEL layer dipertahankan (kayak dslrBooth);
  // mode "scale" = semua ikut membesar/mengecil proporsional (dipakai saat ganti dpi).
  function applyCanvas(patch, mode = "keep") {
    const d = docRef.current;
    const oldW = d.meta.canvasWidth, oldH = d.meta.canvasHeight;
    const meta = { ...d.meta, ...patch };
    let layers = d.layers;
    if (meta.canvasWidth !== oldW || meta.canvasHeight !== oldH) {
      const kx = oldW / meta.canvasWidth, ky = oldH / meta.canvasHeight, ks = meta.canvasWidth / oldW;
      layers = layers.map((l) => {
        if (mode === "keep") return { ...l, xPct: l.xPct * kx, widthPct: l.widthPct * kx, yPct: l.yPct * ky, heightPct: l.heightPct * ky };
        return {
          ...l,
          fontSize: l.fontSize ? Math.round(l.fontSize * ks) : l.fontSize,
          strokeWidth: l.strokeWidth ? Math.round(l.strokeWidth * ks) : l.strokeWidth,
          shadow: l.shadow ? { ...l.shadow, distance: Math.round(l.shadow.distance * ks), spread: Math.round(l.shadow.spread * ks) } : l.shadow,
        };
      });
    }
    applyDoc({ layers, meta });
  }

  function changePaper(paperSize) {
    const m = docRef.current.meta;
    const px = paperPx(paperSize, m.orientation, m.dpi);
    if (px) applyCanvas({ paperSize, canvasWidth: px.w, canvasHeight: px.h });
    else updateMeta({ paperSize });
  }
  function changeOrientation(orientation) {
    const m = docRef.current.meta;
    const px = paperPx(m.paperSize, orientation, m.dpi);
    if (px) { applyCanvas({ orientation, canvasWidth: px.w, canvasHeight: px.h }); return; }
    // Ukuran custom: cukup tukar lebar & tinggi kalau orientasinya beda
    const isLandscape = m.canvasWidth > m.canvasHeight;
    if ((orientation === "landscape") !== isLandscape) applyCanvas({ orientation, canvasWidth: m.canvasHeight, canvasHeight: m.canvasWidth });
    else updateMeta({ orientation });
  }
  function changeDpi(dpi) {
    const m = docRef.current.meta;
    const px = paperPx(m.paperSize, m.orientation, dpi);
    if (px) applyCanvas({ dpi, canvasWidth: px.w, canvasHeight: px.h }, "scale");
    else {
      const k = dpi / m.dpi;
      applyCanvas({ dpi, canvasWidth: Math.round(m.canvasWidth * k), canvasHeight: Math.round(m.canvasHeight * k) }, "scale");
    }
  }
  function changeSize(which, valuePx) {
    const m = docRef.current.meta;
    const v = Math.max(50, Math.min(12000, Math.round(valuePx)));
    const w = which === "w" ? v : m.canvasWidth;
    const h = which === "h" ? v : m.canvasHeight;
    applyCanvas({ canvasWidth: w, canvasHeight: h, paperSize: "custom", orientation: w > h ? "landscape" : "portrait" });
  }

  // ---------- Tambah layer ----------
  function baseBox(wPct, hPct) {
    return { id: newId(), xPct: (100 - wPct) / 2, yPct: (100 - hPct) / 2, widthPct: wPct, heightPct: hPct, rotation: 0, visible: true, locked: false };
  }
  function addLayer(layer) {
    mutateLayers((ls) => [...ls, layer]);
    setSelectedIds([layer.id]);
  }
  function nextPhotoOrder() {
    const orders = docRef.current.layers.filter((l) => l.type === "photo-slot").map((l) => l.photoOrder || 0);
    return orders.length ? Math.max(...orders) + 1 : 1;
  }
  function addPhotoSlot() {
    const { canvasWidth: W, canvasHeight: H } = docRef.current.meta;
    const side = Math.min(W, H) * 0.4;
    const n = nextPhotoOrder();
    addLayer({ ...baseBox((side / W) * 100, (side / H) * 100), type: "photo-slot", shapeKind: "rectangle", photoOrder: n, name: `Photo ${n}` });
  }
  function addText() {
    const { canvasWidth: W, canvasHeight: H } = docRef.current.meta;
    const fs = Math.round(W * 0.06);
    addLayer({ ...baseBox(60, (fs * 1.6 / H) * 100), type: "text", text: "Teks Baru", fontSize: fs, color: "#000000", fontFamily: "sans-serif", align: "center", bold: false, italic: false });
  }
  function addShape(shapeKind) {
    const { canvasWidth: W, canvasHeight: H } = docRef.current.meta;
    const side = Math.min(W, H) * 0.3;
    addLayer({ ...baseBox((side / W) * 100, (side / H) * 100), type: "shape", shapeKind, fillColor: "#E02843", strokeColor: "#000000", strokeWidth: 0 });
    setShapeMenuOpen(false);
  }
  async function handleImagePicked(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const { fullUrl } = await uploadTemplateAsset(activeId, file);
      const img = new Image();
      img.onload = () => {
        const { canvasWidth: W, canvasHeight: H } = docRef.current.meta;
        const first = docRef.current.layers.length === 0;
        const fit = first ? 1 : 0.6;
        const k = Math.min((W * fit) / img.naturalWidth, (H * fit) / img.naturalHeight);
        const wPct = ((img.naturalWidth * k) / W) * 100, hPct = ((img.naturalHeight * k) / H) * 100;
        addLayer({ ...baseBox(wPct, hPct), type: "image", imageUrl: fullUrl, lockAspect: false, fileName: file.name, name: file.name.replace(/\.[^.]+$/, "") });
      };
      img.src = fullUrl;
    } catch (err) {
      alert(err.message || "Gagal upload gambar.");
    }
  }

  async function handleReplaceImage(e) {
    const file = e.target.files[0];
    e.target.value = "";
    const id = replaceIdRef.current;
    if (!file || !id) return;
    try {
      const { fullUrl } = await uploadTemplateAsset(activeId, file);
      // Gambar pengganti bisa berproporsi lain. Karena gambar selalu memenuhi kotaknya, tinggi kotak disesuaikan
      // (lebar & titik tengah tetap) supaya gambar baru tidak melar tanpa sengaja.
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("Gambar pengganti tidak bisa dibaca."));
        i.src = fullUrl;
      });
      const { canvasWidth: cw, canvasHeight: ch } = docRef.current.meta;
      const old = docRef.current.layers.find((l) => l.id === id);
      const widthPx = (old.widthPct / 100) * cw;
      const newHeightPct = ((widthPx * img.naturalHeight) / img.naturalWidth / ch) * 100;
      const centerY = old.yPct + old.heightPct / 2;
      updateLayers([id], { imageUrl: fullUrl, fileName: file.name, heightPct: newHeightPct, yPct: centerY - newHeightPct / 2 });
    } catch (err) {
      alert(err.message || "Gagal mengganti gambar.");
    }
  }

  // ---------- Operasi layer ----------
  const layers = doc?.layers ?? [];
  const meta = doc?.meta;
  const selected = layers.filter((l) => selectedIds.includes(l.id));
  const single = selected.length === 1 ? selected[0] : null;

  function removeSelected() {
    const ids = selectedIds;
    if (!ids.length) return;
    mutateLayers((ls) => ls.filter((l) => !ids.includes(l.id)));
    setSelectedIds([]);
  }
  // Copy = salinan SUNGGUHAN (seperti dslrBooth): "Photo 1" disalin jadi "Photo 1 Copy" yang tetap
  // bernomor Photo 1, sehingga kedua slot menampilkan foto yang sama. Nomor tidak bertambah sendiri.
  function duplicateSelected() {
    if (!selected.length) return;
    const copies = selected.map((l) => ({ ...JSON.parse(JSON.stringify(l)), id: newId(), name: `${layerName(l)} Copy`, xPct: l.xPct + 2, yPct: l.yPct + 2, locked: false }));
    mutateLayers((ls) => [...ls, ...copies]);
    setSelectedIds(copies.map((c) => c.id));
  }
  function moveSelected(dir) {
    if (!selectedIds.length) return;
    mutateLayers((ls) => {
      const arr = [...ls];
      const idxs = arr.map((l, i) => (selectedIds.includes(l.id) ? i : -1)).filter((i) => i >= 0);
      if (dir === "up") {
        for (const i of [...idxs].reverse()) if (i < arr.length - 1 && !selectedIds.includes(arr[i + 1].id)) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
      } else {
        for (const i of idxs) if (i > 0 && !selectedIds.includes(arr[i - 1].id)) [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
      }
      return arr;
    });
  }
  function toggleLockSelected() {
    const lock = !selected.every((l) => l.locked);
    updateLayers(selectedIds, { locked: lock });
  }
  function reorderLayer(fromId, toId) {
    if (fromId === toId) return;
    mutateLayers((ls) => {
      const arr = [...ls];
      const from = arr.findIndex((l) => l.id === fromId);
      const to = arr.findIndex((l) => l.id === toId);
      if (from < 0 || to < 0) return ls;
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      return arr;
    });
  }

  // ---------- Align & distribute ----------
  function align(kind) {
    const targets = selected.filter((l) => !l.locked);
    if (!targets.length) return;
    const b = targets.length === 1
      ? { l: 0, t: 0, r: 100, b: 100 }
      : { l: Math.min(...targets.map((l) => l.xPct)), t: Math.min(...targets.map((l) => l.yPct)), r: Math.max(...targets.map((l) => l.xPct + l.widthPct)), b: Math.max(...targets.map((l) => l.yPct + l.heightPct)) };
    updateLayers(targets.map((l) => l.id), (l) => {
      if (kind === "left") return { xPct: b.l };
      if (kind === "center") return { xPct: (b.l + b.r) / 2 - l.widthPct / 2 };
      if (kind === "right") return { xPct: b.r - l.widthPct };
      if (kind === "top") return { yPct: b.t };
      if (kind === "middle") return { yPct: (b.t + b.b) / 2 - l.heightPct / 2 };
      return { yPct: b.b - l.heightPct };
    });
  }
  function distribute(axis) {
    const t = selected.filter((l) => !l.locked);
    if (t.length < 3) return;
    const pos = axis === "h" ? "xPct" : "yPct", size = axis === "h" ? "widthPct" : "heightPct";
    const sorted = [...t].sort((a, b) => a[pos] - b[pos]);
    const start = sorted[0][pos];
    const end = Math.max(...sorted.map((l) => l[pos] + l[size]));
    const gap = (end - start - sorted.reduce((s, l) => s + l[size], 0)) / (sorted.length - 1);
    const placed = {};
    let cursor = start;
    for (const l of sorted) { placed[l.id] = cursor; cursor += l[size] + gap; }
    updateLayers(t.map((l) => l.id), (l) => ({ [pos]: placed[l.id] }));
  }

  // ---------- Interaksi kanvas ----------
  const W = meta?.canvasWidth || 1200;
  const H = meta?.canvasHeight || 1800;
  const scale = Math.max(0.02, Math.min((stage.w - 56) / W, (stage.h - 56) / H));

  function onLayerPointerDown(e, layer) {
    if (layer.locked) return;
    e.stopPropagation();
    if (e.shiftKey) {
      setSelectedIds((ids) => (ids.includes(layer.id) ? ids.filter((i) => i !== layer.id) : [...ids, layer.id]));
      return;
    }
    const ids = selectedIds.includes(layer.id) ? selectedIds : [layer.id];
    setSelectedIds(ids);
    const origs = {};
    for (const l of docRef.current.layers) if (ids.includes(l.id) && !l.locked) origs[l.id] = { x: l.xPct, y: l.yPct };
    startGesture(e, { type: "move", origs });
  }
  function onHandleDown(e, layer, corner) {
    e.stopPropagation();
    startGesture(e, { type: "resize", id: layer.id, corner, orig: { x: (layer.xPct / 100) * W, y: (layer.yPct / 100) * H, w: (layer.widthPct / 100) * W, h: (layer.heightPct / 100) * H, rot: layer.rotation || 0 } });
  }
  function onRotateDown(e, layer) {
    e.stopPropagation();
    startGesture(e, { type: "rotate", id: layer.id });
  }
  function startGesture(e, g) {
    gestureRef.current = { ...g, startX: e.clientX, startY: e.clientY, moved: false };
    histRef.current.lastKey = null;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }
  function onPointerMove(e) {
    const g = gestureRef.current;
    const canvas = canvasRef.current;
    if (!g || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dxScreen = e.clientX - g.startX, dyScreen = e.clientY - g.startY;
    if (!g.moved && Math.hypot(dxScreen, dyScreen) < 3) return;
    g.moved = true;
    const key = `gesture-${g.type}`;

    if (g.type === "move") {
      const dx = (dxScreen / rect.width) * 100, dy = (dyScreen / rect.height) * 100;
      updateLayers(Object.keys(g.origs), (l) => ({ xPct: g.origs[l.id].x + dx, yPct: g.origs[l.id].y + dy }), key);
    } else if (g.type === "resize") {
      const o = g.orig;
      const th = (o.rot * Math.PI) / 180, cos = Math.cos(th), sin = Math.sin(th);
      const dxc = (dxScreen / rect.width) * W, dyc = (dyScreen / rect.height) * H;
      const dxl = dxc * cos + dyc * sin, dyl = -dxc * sin + dyc * cos; // geser dalam sumbu lokal layer
      const [sx, sy] = g.corner;
      let w = Math.max(MIN_PX, o.w + sx * dxl), h = Math.max(MIN_PX, o.h + sy * dyl);
      const lay = docRef.current.layers.find((l) => l.id === g.id);
      if (lay?.lockAspect || e.shiftKey) {
        const ratio = o.w / o.h;
        if (Math.abs(w - o.w) / o.w > Math.abs(h - o.h) / o.h) h = Math.max(MIN_PX, w / ratio); else w = Math.max(MIN_PX, h * ratio);
      }
      const lx = (sx * (w - o.w)) / 2, ly = (sy * (h - o.h)) / 2;
      const cx = o.x + o.w / 2 + (lx * cos - ly * sin), cy = o.y + o.h / 2 + (lx * sin + ly * cos);
      updateLayers([g.id], { xPct: ((cx - w / 2) / W) * 100, yPct: ((cy - h / 2) / H) * 100, widthPct: (w / W) * 100, heightPct: (h / H) * 100 }, key);
    } else if (g.type === "rotate") {
      const lay = docRef.current.layers.find((l) => l.id === g.id);
      if (!lay) return;
      const cx = rect.left + ((lay.xPct + lay.widthPct / 2) / 100) * rect.width;
      const cy = rect.top + ((lay.yPct + lay.heightPct / 2) / 100) * rect.height;
      let deg = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      deg = Math.round(deg);
      if (deg > 180) deg -= 360;
      updateLayers([g.id], { rotation: deg }, key);
    }
  }
  function onPointerUp() {
    gestureRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }

  // ---------- Shortcut keyboard ----------
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); handleSave(); return; }
      if (typing || modal) return;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateSelected(); return; }
      if (e.key === "Escape") { setSelectedIds([]); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeSelected(); return; }
      const step = e.shiftKey ? 10 : 1;
      const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (arrows[e.key] && selectedIds.length) {
        e.preventDefault();
        const [dx, dy] = arrows[e.key];
        updateLayers(selectedIds, (l) => (l.locked ? {} : { xPct: l.xPct + (dx / W) * 100, yPct: l.yPct + (dy / H) * 100 }), "nudge");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- Simpan / template ----------
  async function handleSave(auto = false) {
    const d = docRef.current;
    if (!d || !activeId) return;
    setSaveState("saving");
    try {
      const m = d.meta;
      await saveTemplate(activeId, {
        layers: d.layers.map((l) => (l.imageUrl ? { ...l, imageUrl: stripOrigin(l.imageUrl) } : l)),
        price: m.price, name: m.name, category: m.category, backgroundColor: m.backgroundColor,
        paperSize: m.paperSize, orientation: m.orientation, dpi: m.dpi, canvasWidth: m.canvasWidth, canvasHeight: m.canvasHeight,
      });
      setTemplates((prev) => prev.map((t) => (t.id === activeId ? { ...t, ...m, layers: d.layers } : t)));
      savedRef.current = d;
      setDirty(false);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch (err) {
      setSaveState("idle");
      if (auto === true) showToast(`Simpan otomatis gagal: ${err.message}`);
      else alert(err.message);
    }
  }

  async function handleCreate(form) {
    const tpl = await createTemplate(form);
    if (!tpl) return;
    setTemplates((prev) => [tpl, ...prev]);
    openTemplate(tpl);
    setModal(null);
    showToast("Template baru berstatus Draft (tidak tampil di booth). Klik bintang ★ kalau sudah siap tampil.");
  }

  async function handleSaveAsNew() {
    const d = docRef.current;
    const name = prompt("Nama template baru:", `${d.meta.name} copy`);
    if (!name) return;
    try {
      const m = d.meta;
      const tpl = await createTemplate({ name, category: m.category, price: m.price, canvasWidth: m.canvasWidth, canvasHeight: m.canvasHeight, paperSize: m.paperSize, orientation: m.orientation, dpi: m.dpi, backgroundColor: m.backgroundColor });
      const layersToSave = d.layers.map((l) => ({ ...l, id: newId(), ...(l.imageUrl ? { imageUrl: stripOrigin(l.imageUrl) } : {}) }));
      await saveTemplate(tpl.id, { layers: layersToSave, price: m.price });
      const fresh = (await listTemplates()).find((t) => t.id === tpl.id) || tpl;
      setTemplates((prev) => [fresh, ...prev]);
      openTemplate(fresh);
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleDeleteTemplate() {
    if (!activeId || !confirm(`Hapus template "${meta.name}"? Ini tidak bisa dibatalkan.`)) return;
    try {
      await deleteTemplate(activeId);
      const remaining = templates.filter((t) => t.id !== activeId);
      setTemplates(remaining);
      if (remaining.length) openTemplate(remaining[0]);
      else { docRef.current = null; setDoc(null); setActiveId(null); setDirty(false); }
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleCleanupFiles() {
    setUserMenuOpen(false);
    if (!confirm("Bersihkan file yang sudah tidak dipakai template mana pun? Sebaiknya dijalankan saat tidak ada pelanggan yang sedang sesi foto.")) return;
    try {
      const r = await cleanupOrphanedFiles();
      alert(`Selesai — ${r.deletedCount} file tidak terpakai dibersihkan.`);
    } catch (err) { alert(err.message); }
  }

  // Favorit langsung tersimpan (tidak menunggu tombol Save) karena ini penanda template, bukan bagian desain
  const activeTemplate = templates.find((t) => t.id === activeId);
  const isFavorite = !!activeTemplate?.favorite;
  // Bintang di baris daftar: tandai / lepas favorit template MANA PUN tanpa membukanya
  async function toggleFavoriteOf(t) {
    try {
      const value = await setTemplateFavorite(t.id, !t.favorite);
      if (value !== null) setTemplates((prev) => prev.map((x) => (x.id === t.id ? { ...x, favorite: value } : x)));
    } catch (err) { alert(err.message); }
  }

  const isAnimated = !!activeTemplate?.animated;
  async function toggleAnimated() {
    if (!activeId) return;
    try {
      const value = await setTemplateAnimated(activeId, !isAnimated);
      if (value !== null) setTemplates((prev) => prev.map((t) => (t.id === activeId ? { ...t, animated: value } : t)));
    } catch (err) { alert(err.message); }
  }

  async function toggleFavorite() {
    if (!activeId) return;
    try {
      const value = await setTemplateFavorite(activeId, !isFavorite);
      if (value !== null) setTemplates((prev) => prev.map((t) => (t.id === activeId ? { ...t, favorite: value } : t)));
    } catch (err) { alert(err.message); }
  }

  async function handleExport() {
    if (!doc) return;
    // 1) Dialog "Simpan sebagai" DULU (hanya boleh dibuka tepat saat klik), baru pekerjaan berat.
    let target;
    try {
      target = await chooseSaveTarget(exportFileName(docRef.current.meta), { description: "Template POPSNAP / dslrBooth (ZIP)", mime: "application/zip", ext: ".zip", idKey: "popsnap-templates" });
    } catch (err) {
      return alert(err.message || "Tidak bisa membuka dialog simpan.");
    }
    if (!target) return; // dibatalkan: tidak ada yang diunduh, tidak ada yang dicatat
    setBusyMsg("Menyiapkan file ekspor...");
    try {
      const { blob, filename, notes } = await buildZipExport(docRef.current, { favorite: isFavorite });
      const saved = await target.write(blob);
      auditTemplate(activeId, "export");
      showToast(saved.askedLocation ? `Tersimpan: ${saved.where}` : `Tersimpan di folder Downloads sebagai ${saved.where} (browser ini tidak bisa memilih lokasi)`);
      if (notes.length) setImportReport({ title: "Ekspor selesai", intro: `File ${filename} berformat ZIP dslrBooth.`, items: notes.map((text) => ({ level: "info", text })) });
    } catch (err) {
      await target.discard();
      alert(err.message || "Gagal mengekspor template.");
    } finally { setBusyMsg(null); }
  }

  // Tombol Import: dialog pilih file bawaan sistem (Chrome/Edge mengingat folder terakhir). Browser tanpa API itu
  // memakai <input type="file"> tersembunyi, yang juga membuka dialog pilih file.
  async function handleImportClick() {
    const picked = await chooseOpenFile({ description: "Template (ZIP dslrBooth / POPSNAP, atau JSON)", accept: { "application/zip": [".zip"], "application/json": [".json"] }, idKey: "popsnap-templates" });
    if (picked === undefined) return importInputRef.current.click();
    if (picked) await importFromFile(picked);
  }

  function handleImportFile(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) importFromFile(file);
  }

  // Tahap 1: baca file. Tahap 2 (dialog): isi nama / kategori / harga, karena file dslrBooth tidak membawa harga & kategori.
  async function importFromFile(file) {
    if (blockedNoSlot()) return;
    if (dirty && !confirm("Ada perubahan yang belum disimpan. Tetap impor? (Template yang sedang dibuka akan ditutup.)")) return;
    setBusyMsg("Membaca file...");
    try {
      const parsed = await parseImportFile(file);
      setImportAsk(parsed);
    } catch (err) {
      alert(err.message || "Gagal membaca file template.");
    } finally { setBusyMsg(null); }
  }

  async function finishImport(parsed, { name, category, price }) {
    setImportAsk(null);
    setBusyMsg("Membuat template baru...");
    try {
      const { meta: m0, layers: imported, favorite: fav, report } = parsed;
      const m = { ...m0, name: name || m0.name, category: category || m0.category, price };
      const tpl = await createTemplate({ ...m, imported: true });
      const finalLayers = [];
      let n = 0;
      for (const l of imported) {
        if (l.type === "image") {
          setBusyMsg(`Mengunggah gambar ${++n}...`);
          const up = await uploadTemplateAsset(tpl.id, await dataUrlToFile(l.imageData, l.fileName || `gambar-${n}.png`));
          const { imageData, ...rest } = l;
          finalLayers.push({ ...rest, imageUrl: stripOrigin(up.fullUrl) });
        } else finalLayers.push(l);
      }
      await saveTemplate(tpl.id, { layers: finalLayers, price: m.price });
      if (fav) await setTemplateFavorite(tpl.id, true).catch(() => {});
      const fresh = (await listTemplates()).find((t) => t.id === tpl.id) || tpl;
      setTemplates((prev) => [fresh, ...prev.filter((t) => t.id !== fresh.id)]);
      openTemplate(fresh);
      const skipped = report.filter((r) => r.level === "warn");
      if (skipped.length) setImportReport({ title: "Impor selesai — ada yang perlu dicek", intro: `"${m.name}" diimpor: ${finalLayers.length} layer.`, items: skipped });
    } catch (err) {
      alert(err.message || "Gagal mengimpor template.");
    } finally { setBusyMsg(null); }
  }

  async function handlePrintTest() {
    if (!doc) return;
    setBusyMsg("Menyiapkan cetak tes...");
    try {
      await printTestCopy(docRef.current);
      auditTemplate(activeId, "print_test");
    } catch (err) {
      alert(err.message || "Gagal menyiapkan cetak tes.");
    } finally { setBusyMsg(null); }
  }

  function handleLogout() {
    if (blockedNoSlot()) return;
    if (dirty && !confirm("Ada perubahan yang belum disimpan. Keluar tanpa menyimpan?")) return;
    onLogout?.(); // AdminApp yang mencatat logout lalu menghapus sesi
  }

  const hasSlot = layers.some((l) => l.type === "photo-slot");
  const needsSlot = !!doc && !hasSlot;

  // Simpan otomatis 2,5 detik setelah perubahan terakhir. Template yang sudah tampil di booth (★) tanpa slot foto tidak disimpan otomatis.
  useEffect(() => {
    if (!dirty || !doc || !activeId || saveState === "saving") return undefined;
    if (!hasSlot && isFavorite) return undefined;
    const t = setTimeout(() => handleSave(true), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, dirty, activeId]);

  const canUndo = histRef.current.past.length > 0;
  const canRedo = histRef.current.future.length > 0;
  const displayLayers = [...layers].reverse();
  const photoPlan = photoSlotPlan(layers);
  const dpi = meta?.dpi || 300;

  return (
    <div className="h-screen w-screen flex flex-col bg-[#F4F7FA] text-[#181B23] text-[13px] overflow-hidden select-none">
      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg" onChange={handleImagePicked} className="hidden" />
      <input ref={replaceInputRef} type="file" accept="image/png,image/jpeg" onChange={handleReplaceImage} className="hidden" />
      <input ref={importInputRef} type="file" accept=".zip,.json,application/zip,application/json" onChange={handleImportFile} className="hidden" />
      {busyMsg && <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center text-[#181B23] text-[14px]"><div className="bg-[#F4F7FA] border border-[#C7D0DA] px-6 py-4">{busyMsg}</div></div>}

      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#F4F7FA] text-[12px]">
        <div className="flex items-center gap-4">
          <button onClick={() => goTo("/admin")} className="text-[#262A38] hover:text-[#E02843]">← Menu Admin</button>
          <span>TEMPLATE EDITOR</span>
        </div>
        <div className="relative">
          <button onClick={() => setUserMenuOpen((v) => !v)} className="flex items-center gap-1 text-[#262A38] hover:text-[#E02843]">
            <Icon name="user" size={14} /> {currentUser?.username} <Icon name="chevD" size={12} />
          </button>
          {userMenuOpen && (
            <div className="absolute right-0 top-full mt-1 z-40 w-44 bg-[#F4F7FA] border border-[#C7D0DA] shadow-xl" onMouseLeave={() => setUserMenuOpen(false)}>
              <MenuItem onClick={() => { setUserMenuOpen(false); goTo("/admin/account"); }}>Akun Saya</MenuItem>
              {can(currentUser, "users.manage") && <MenuItem onClick={() => { setUserMenuOpen(false); goTo("/admin/users"); }}>Pengguna &amp; Hak Akses</MenuItem>}
              {can(currentUser, "tools.maintenance") && <MenuItem onClick={handleCleanupFiles}>Bersihkan File</MenuItem>}
              <MenuItem onClick={handleLogout}>Keluar</MenuItem>
            </div>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="relative flex items-center gap-1 px-3 py-2 bg-[#FFFFFF] border-b border-[#D5DCE4] max-[1100px]:flex-wrap max-[1100px]:justify-center max-[1100px]:px-2 max-[1100px]:py-1">
        <ToolbarButton icon="plus" label="New Template" onClick={() => { if (!blockedNoSlot()) setModal("new"); }} />
        <ToolbarButton icon="copy" label="Save as New" onClick={handleSaveAsNew} disabled={!doc} />
        <ToolbarButton icon="save" label={saveState === "saving" ? "Saving..." : "Save"} onClick={() => handleSave()} disabled={!doc || (!dirty && saveState !== "saving")} />
        <ToolbarButton icon="download" label="Import" onClick={handleImportClick} />
        <ToolbarButton icon="upload" label="Export" onClick={handleExport} disabled={!doc} />
        <ToolbarButton icon="printer" label="Print Test Copy" onClick={handlePrintTest} disabled={!doc} />
        <ToolbarButton icon="trash" label="Delete Template" onClick={handleDeleteTemplate} disabled={!doc} />

        <div className="flex-1 flex flex-col items-center gap-1 min-w-0 max-[1100px]:order-last max-[1100px]:basis-full max-[1100px]:flex-none max-[1100px]:flex-row max-[1100px]:justify-center max-[1100px]:gap-3">
          <TemplatePicker
            templates={templates} categories={categories} activeId={activeId} live={doc} isFavorite={isFavorite} dirty={dirty} disabled={!doc}
            onSelect={requestOpenTemplate} onToggleFavorite={toggleFavorite} onToggleFavoriteOf={toggleFavoriteOf}
            onRename={(name) => updateMeta({ name }, "name")}
          />
          <div className="flex gap-1">
            <ToolbarButton icon="undo" label="Undo" onClick={undo} disabled={!canUndo} />
            <ToolbarButton icon="redo" label="Redo" onClick={redo} disabled={!canRedo} />
          </div>
        </div>

        <button onClick={() => goTo("/")} className="flex flex-col items-center gap-1 px-5 py-2 max-[1100px]:px-3 max-[1100px]:py-1 bg-[#E8EEF4] border border-[#C7D0DA] text-[#181B23] hover:text-[#E02843]">
          <Icon name="camera" size={26} />
          <span className="whitespace-nowrap max-[1100px]:text-[12px]">Open Photo Booth</span>
        </button>
      </div>

      {doc && (
        <div className={`flex items-center justify-between gap-3 px-3 py-1 text-[12px] border-b ${needsSlot ? "bg-[#FDECEF] border-[#E02843] text-[#B81E36]" : "bg-[#F4F7FA] border-[#D5DCE4] text-[#55606E]"}`}>
          <span>{needsSlot ? "⚠ Template ini belum punya foto. Klik “Photo From Booth” di panel kiri dulu — baru bisa keluar atau pindah template." : "Perubahan disimpan otomatis. Tombol Save untuk menyimpan sekarang."}</span>
          <span className="font-semibold">{saveState === "saving" ? "Menyimpan..." : dirty ? "Belum disimpan (auto-save sebentar lagi)" : "Tersimpan ✓"}</span>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* ============ KIRI ============ */}
        <div className="w-[280px] max-[1100px]:w-[210px] max-[820px]:w-[170px] flex-shrink-0 bg-[#FFFFFF] border-r border-[#D5DCE4] overflow-y-auto">
          <PanelHeader>ADD</PanelHeader>
          <div className="px-3 pb-3 flex flex-col gap-2">
            <AddButton icon="image" label="Image" disabled={!doc} onClick={() => imageInputRef.current.click()} />
            <AddButton icon="camera" label="Photo From Booth" disabled={!doc} onClick={addPhotoSlot} />
            <AddButton icon="text" label="Text" disabled={!doc} onClick={addText} />
            <div>
              <AddButton icon="shape" label="Shape" arrow={shapeMenuOpen ? "chevD" : "chevR"} disabled={!doc} onClick={() => setShapeMenuOpen((v) => !v)} />
              {shapeMenuOpen && (
                <div className="mt-1 grid grid-cols-3 gap-1">
                  {SHAPES.map((s) => (
                    <button key={s.id} onClick={() => addShape(s.id)} className="bg-[#E8EEF4] hover:bg-[#DCE5EE] py-2 text-[12px]">{s.label}</button>
                  ))}
                </div>
              )}
            </div>
            <label className={`flex items-center justify-between bg-[#E8EEF4] px-3 py-3 ${doc ? "hover:bg-[#DCE5EE] cursor-pointer" : "opacity-40"}`}>
              <span className="flex items-center gap-3 text-[14px]"><Icon name="shape" size={22} /> Background Color</span>
              <input type="color" disabled={!doc} value={meta?.backgroundColor || "#ffffff"} onChange={(e) => updateMeta({ backgroundColor: e.target.value }, "bgcolor")} className="w-8 h-6 bg-transparent border-0 p-0 cursor-pointer" />
            </label>
          </div>

          <PanelHeader>LAYOUT</PanelHeader>
          {meta && (
            <div className="px-3 pb-4 flex flex-col gap-2.5">
              <Field label="View Dimension In">
                <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls}>
                  {UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                </select>
              </Field>
              <Field label="Paper Size">
                <select value={meta.paperSize} onChange={(e) => changePaper(e.target.value)} className={inputCls}>
                  {PAPERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </Field>
              <Field label="Resolution">
                <select value={meta.dpi} onChange={(e) => changeDpi(Number(e.target.value))} className={inputCls}>
                  {DPIS.map((d) => <option key={d} value={d}>{d} dpi</option>)}
                </select>
              </Field>
              <Field label="Orientation">
                <select value={meta.orientation} onChange={(e) => changeOrientation(e.target.value)} className={inputCls}>
                  <option value="portrait">Vertical</option>
                  <option value="landscape">Horizontal</option>
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Width"><NumInput value={fromPx(W, unit, dpi)} onCommit={(v) => changeSize("w", toPx(v, unit, dpi))} step={unit === "px" ? 10 : 0.1} /></Field>
                <Field label="Height"><NumInput value={fromPx(H, unit, dpi)} onCommit={(v) => changeSize("h", toPx(v, unit, dpi))} step={unit === "px" ? 10 : 0.1} /></Field>
              </div>
              <p className="text-[11px] text-[#6B7684]">Ukuran hasil cetak: {W} × {H} px</p>
            </div>
          )}
        </div>

        {/* ============ TENGAH ============ */}
        <div ref={stageRef} className="flex-1 min-w-0 bg-[#DCE5EE] flex items-center justify-center overflow-hidden" onPointerDown={() => setSelectedIds([])}>
          {!doc && (
            <div className="text-center text-[#55606E]">
              <p className="mb-3">Belum ada template.</p>
              <button onClick={() => setModal("new")} className="px-4 py-2 bg-[#E8EEF4] hover:bg-[#DCE5EE] text-[#181B23]">New Template</button>
            </div>
          )}
          {doc && (
            <div
              ref={canvasRef}
              onPointerDown={(e) => { e.stopPropagation(); setSelectedIds([]); }}
              className="relative flex-shrink-0 shadow-2xl"
              style={{ ...containerStyle, width: W * scale, height: H * scale, background: meta.backgroundColor }}
            >
              {/* konten dipotong di tepi kanvas; handle di luar clip agar tetap bisa diraih */}
              <div className="absolute inset-0 overflow-hidden" style={{ pointerEvents: "none" }}>
                {layers.filter((l) => l.visible !== false).map((layer) => (
                  <LayerBox key={layer.id} layer={layer} canvasWidth={W}>
                    <LayerContent layer={layer} canvasWidth={W} canvasHeight={H} />
                  </LayerBox>
                ))}
              </div>
              {/* lapisan interaksi */}
              {layers.filter((l) => l.visible !== false).map((layer) => {
                const isSel = selectedIds.includes(layer.id);
                return (
                  <div
                    key={`hit-${layer.id}`}
                    onPointerDown={(e) => onLayerPointerDown(e, layer)}
                    style={{ ...layerBoxStyle(layer), opacity: 1, pointerEvents: layer.locked ? "none" : "auto", cursor: "move", outline: isSel ? "2px solid #4aa3ff" : undefined }}
                  >
                    {isSel && single && !single.locked && (
                      <>
                        {[[-1, -1, "nwse"], [1, -1, "nesw"], [-1, 1, "nesw"], [1, 1, "nwse"]].map(([sx, sy, cur]) => (
                          <span key={`${sx}${sy}`} onPointerDown={(e) => onHandleDown(e, layer, [sx, sy])}
                            className="absolute w-3 h-3 bg-white border-2 border-[#4082AE]"
                            style={{ left: sx < 0 ? -6 : undefined, right: sx > 0 ? -6 : undefined, top: sy < 0 ? -6 : undefined, bottom: sy > 0 ? -6 : undefined, cursor: `${cur}-resize` }} />
                        ))}
                        <span className="absolute left-1/2 -top-7 w-px h-5 bg-[#4082AE] -translate-x-1/2 pointer-events-none" />
                        <span onPointerDown={(e) => onRotateDown(e, layer)} title="Putar (Shift = per 15°)"
                          className="absolute left-1/2 -top-9 w-3.5 h-3.5 rounded-full bg-white border-2 border-[#4082AE] -translate-x-1/2 cursor-grab" />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ============ KANAN ============ */}
        <div className="w-[310px] max-[1100px]:w-[240px] max-[820px]:w-[190px] flex-shrink-0 bg-[#FFFFFF] border-l border-[#D5DCE4] overflow-y-auto">
          <PanelHeader>INFO</PanelHeader>
          <div className="px-3 pb-3 grid grid-cols-[52px_14px_1fr_14px_1fr] items-center gap-x-2 gap-y-2">
            <span className="text-[#262A38]">Position</span>
            <span className="text-[#55606E]">X</span>
            <NumInput disabled={!single} value={single ? fromPx((single.xPct / 100) * W, unit, dpi) : 0} onCommit={(v) => updateLayers([single.id], { xPct: (toPx(v, unit, dpi) / W) * 100 }, `x-${single.id}`)} />
            <span className="text-[#55606E]">Y</span>
            <NumInput disabled={!single} value={single ? fromPx((single.yPct / 100) * H, unit, dpi) : 0} onCommit={(v) => updateLayers([single.id], { yPct: (toPx(v, unit, dpi) / H) * 100 }, `y-${single.id}`)} />

            <span className="text-[#262A38]">Size</span>
            <span className="text-[#55606E]">W</span>
            <NumInput disabled={!single} value={single ? fromPx((single.widthPct / 100) * W, unit, dpi) : 0} onCommit={(v) => resizeNumeric("w", v)} />
            <span className="text-[#55606E]">H</span>
            <NumInput disabled={!single} value={single ? fromPx((single.heightPct / 100) * H, unit, dpi) : 0} onCommit={(v) => resizeNumeric("h", v)} />

            <label className="col-span-5 flex items-center gap-2 text-[12px] justify-end">
              <input type="checkbox" disabled={!single} checked={!!single?.lockAspect} onChange={(e) => updateLayers([single.id], { lockAspect: e.target.checked })} />
              Keep aspect ratio
            </label>

            <span className="text-[#262A38]">Rotate</span>
            <span />
            <NumInput disabled={!single} value={single ? Math.round(single.rotation || 0) : 0} onCommit={(v) => updateLayers([single.id], { rotation: v }, `r-${single.id}`)} />
            <span className="text-[#55606E]">°</span>
          </div>

          <PanelHeader>ALIGN &amp; DISTRIBUTE</PanelHeader>
          <div className="px-3 pb-3 grid grid-cols-6 gap-1">
            {[["alignTop", "top", "Rata atas"], ["alignMiddle", "middle", "Tengah vertikal"], ["alignBottom", "bottom", "Rata bawah"], ["alignLeft", "left", "Rata kiri"], ["alignCenter", "center", "Tengah horizontal"], ["alignRight", "right", "Rata kanan"]].map(([icon, kind, tip]) => (
              <button key={kind} title={tip} disabled={!selected.length} onClick={() => align(kind)} className="py-1.5 flex justify-center hover:bg-[#E8EEF4] disabled:opacity-30"><Icon name={icon} size={22} /></button>
            ))}
            <button title="Sebar rata vertikal (min. 3 layer)" disabled={selected.length < 3} onClick={() => distribute("v")} className="py-1.5 flex justify-center hover:bg-[#E8EEF4] disabled:opacity-30"><Icon name="distV" size={22} /></button>
            <button title="Sebar rata horizontal (min. 3 layer)" disabled={selected.length < 3} onClick={() => distribute("h")} className="py-1.5 flex justify-center hover:bg-[#E8EEF4] disabled:opacity-30"><Icon name="distH" size={22} /></button>
          </div>

          <PanelHeader>LAYERS</PanelHeader>
          <div className="px-3 pb-3">
            <div className="bg-white border border-[#C7D0DA] max-h-[260px] overflow-y-auto">
              {displayLayers.map((l) => (
                <div
                  key={l.id}
                  draggable={renamingId !== l.id}
                  onDragStart={() => setDragLayerId(l.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { reorderLayer(dragLayerId, l.id); setDragLayerId(null); }}
                  onClick={(e) => setSelectedIds((ids) => (e.shiftKey ? (ids.includes(l.id) ? ids.filter((i) => i !== l.id) : [...ids, l.id]) : [l.id]))}
                  className={`flex items-center gap-2 px-2 py-2 border-b border-[#D5DCE4] cursor-pointer ${selectedIds.includes(l.id) ? "bg-[#C5DCEE]" : "hover:bg-[#F4F7FA]"}`}
                >
                  <button title={l.visible === false ? "Tampilkan" : "Sembunyikan"} onClick={(e) => { e.stopPropagation(); updateLayers([l.id], { visible: l.visible === false }); }} className="text-[#262A38] hover:text-[#E02843] flex-shrink-0">
                    <Icon name={l.visible === false ? "eyeOff" : "eye"} size={16} />
                  </button>
                  <Icon name={l.type === "photo-slot" ? "camera" : l.type === "text" ? "text" : l.type === "shape" ? "shape" : "image"} size={18} className="flex-shrink-0 text-[#262A38]" />
                  {l.type === "photo-slot" && <span title={`Warna slot: ${slotColor(l.photoOrder).name}`} className="w-3 h-3 rounded-full flex-shrink-0 border border-black/25" style={{ background: slotColor(l.photoOrder).bg }} />}
                  {renamingId === l.id ? (
                    <input autoFocus defaultValue={layerName(l)} className={`${inputCls} py-0`}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => { updateLayers([l.id], { name: e.target.value || undefined }); setRenamingId(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenamingId(null); }} />
                  ) : (
                    <span className={`flex-1 truncate text-[12px] ${l.visible === false ? "opacity-40" : ""}`} onDoubleClick={() => setRenamingId(l.id)} title="Klik dua kali untuk ganti nama">{layerName(l)}</span>
                  )}
                  {l.locked && <Icon name="lock" size={14} className="flex-shrink-0 text-[#262A38]" />}
                </div>
              ))}
              {layers.length === 0 && <p className="px-3 py-4 text-[#6B7684] text-[12px]">Belum ada layer. Tambahkan dari panel ADD.</p>}
            </div>
            {photoPlan.count > 0 && <p className="text-[11px] text-[#6B7684] mt-2">Pelanggan memilih {photoPlan.count} foto ({photoPlan.slots.length} slot{photoPlan.slots.length !== photoPlan.count ? "; slot bernomor sama menampilkan foto yang sama" : ""}).</p>}
            <div className="flex items-center justify-between mt-2 text-[#262A38]">
              <div className="flex gap-1">
                <button title="Naikkan layer" disabled={!selected.length} onClick={() => moveSelected("up")} className="p-1.5 hover:bg-[#E8EEF4] disabled:opacity-30"><Icon name="up" size={16} /></button>
                <button title="Turunkan layer" disabled={!selected.length} onClick={() => moveSelected("down")} className="p-1.5 hover:bg-[#E8EEF4] disabled:opacity-30"><Icon name="down" size={16} /></button>
              </div>
              <div className="flex gap-1">
                <button title="Kunci / buka kunci" disabled={!selected.length} onClick={toggleLockSelected} className="p-1.5 hover:bg-[#E8EEF4] disabled:opacity-30"><Icon name={selected.length && selected.every((l) => l.locked) ? "unlock" : "lock"} size={16} /></button>
                <button title="Duplikat (Ctrl+D)" disabled={!selected.length} onClick={duplicateSelected} className="p-1.5 hover:bg-[#E8EEF4] disabled:opacity-30"><Icon name="copy" size={16} /></button>
                <button title="Hapus (Delete)" disabled={!selected.length} onClick={removeSelected} className="p-1.5 hover:bg-[#E8EEF4] disabled:opacity-30"><Icon name="trash" size={16} /></button>
              </div>
            </div>
          </div>

          <PanelHeader>OPTIONS</PanelHeader>
          <div className="px-3 pb-6">
            {!doc ? null : single ? (
              <LayerOptions layer={single} layers={layers} onReplaceImage={() => { replaceIdRef.current = single.id; replaceInputRef.current.click(); }} onChange={(patch, key) => updateLayers([single.id], patch, key ? `${key}-${single.id}` : undefined)} />
            ) : selected.length > 1 ? (
              <p className="text-[#6B7684] text-[12px]">{selected.length} layer dipilih. Pilih satu layer untuk mengubah opsinya.</p>
            ) : (
              <TemplateOptions meta={meta} isFavorite={isFavorite} onToggleFavorite={toggleFavorite} isAnimated={isAnimated} onToggleAnimated={toggleAnimated} categories={categories} onManageCategories={() => setCatManager(true)} onChange={(patch, key) => updateMeta(patch, key)} />
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div role="status" className="fixed bottom-4 right-4 z-50 max-w-md bg-[#E6F6EE] border-l-4 border-emerald-600 text-emerald-900 text-[13px] px-4 py-3 shadow-xl break-all">{toast}</div>
      )}
      {importReport && (
        <Modal title={importReport.title} onClose={() => setImportReport(null)} width="w-[560px]">
          <p className="text-[13px] text-[#262A38] mb-3">{importReport.intro}</p>
          <ul className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
            {importReport.items.map((it, i) => (
              <li key={i} className={`text-[13px] border-l-4 px-3 py-1.5 ${it.level === "warn" ? "border-amber-500 bg-[#FFF6D6] text-amber-900" : "border-[#4082AE] bg-[#E3EEF6] text-[#305067]"}`}>{it.text}</li>
            ))}
          </ul>
          <div className="flex justify-end mt-4"><button onClick={() => setImportReport(null)} className="px-4 py-2 bg-[#E02843] hover:bg-[#B81E36] text-white">OK</button></div>
        </Modal>
      )}
      {importAsk && <ImportAskModal parsed={importAsk} categories={categories} onManageCategories={() => setCatManager(true)} onClose={() => setImportAsk(null)} onConfirm={(v) => finishImport(importAsk, v)} />}
      {modal === "new" && <NewTemplateModal categories={categories} onManageCategories={() => setCatManager(true)} onClose={() => setModal(null)} onCreate={handleCreate} />}
      {catManager && <CategoryManager onClose={() => { setCatManager(false); reloadCategories(); }} onChanged={reloadCategories} />}
    </div>
  );

  // Ubah lebar/tinggi lewat angka (menghormati "keep aspect ratio")
  function resizeNumeric(which, valueInUnit) {
    if (!single) return;
    const px = Math.max(MIN_PX, toPx(valueInUnit, unit, dpi));
    const wPx = (single.widthPct / 100) * W, hPx = (single.heightPct / 100) * H;
    let nw = which === "w" ? px : wPx, nh = which === "h" ? px : hPx;
    if (single.lockAspect) {
      if (which === "w") nh = px * (hPx / wPx); else nw = px * (wPx / hPx);
    }
    updateLayers([single.id], { widthPct: (nw / W) * 100, heightPct: (nh / H) * 100 }, `size-${single.id}`);
  }
}

// ==========================================================
// Sub-komponen
// ==========================================================

function MenuItem({ children, onClick, active }) {
  return (
    <button onClick={onClick} className={`w-full text-left px-3 py-2 hover:bg-[#E8EEF4] ${active ? "bg-[#C5DCEE]" : ""}`}>{children}</button>
  );
}

function AddButton({ icon, label, onClick, disabled, arrow }) {
  return (
    <button onClick={onClick} disabled={disabled} className="w-full flex items-center justify-between bg-[#E8EEF4] hover:bg-[#DCE5EE] disabled:opacity-40 disabled:hover:bg-[#E8EEF4] px-3 py-3 text-[14px]">
      <span className="flex items-center gap-3"><Icon name={icon} size={22} /> {label}</span>
      {arrow && <Icon name={arrow} size={14} />}
    </button>
  );
}

function CategorySelect({ value, categories, onChange, onManage }) {
  const known = categories.some((c) => c.id === value);
  return (
    <div className="flex gap-1.5">
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {!known && value && <option value={value}>{value}</option>}
        {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      <button type="button" onClick={onManage} title="Tambah / ubah / urutkan kategori" className="px-2.5 text-[12px] font-bold italic whitespace-nowrap bg-white border border-[#C7D0DA] hover:border-[#4082AE] hover:text-[#4082AE] rounded-full">＋ Kelola</button>
    </div>
  );
}

function TemplateOptions({ meta, isFavorite, onToggleFavorite, isAnimated, onToggleAnimated, categories, onManageCategories, onChange }) {
  return (
    <div className="flex flex-col gap-2.5">
      <Field label="Nama template"><input value={meta.name} onChange={(e) => onChange({ name: e.target.value }, "name")} className={inputCls} /></Field>
      <Field label="Kategori">
        <CategorySelect value={meta.category} categories={categories} onManage={onManageCategories} onChange={(v) => onChange({ category: v })} />
      </Field>
      <Field label="Status">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${isFavorite ? "bg-[#E6F6EE] text-[#0F5C52]" : "bg-[#FFF6D6] text-[#7A5A00]"}`}>{isFavorite ? "LIVE · tampil di booth" : "DRAFT · tidak tampil"}</span>
          <button type="button" onClick={onToggleFavorite} className="px-2.5 py-0.5 text-[12px] font-bold italic bg-white border border-[#C7D0DA] hover:border-[#4082AE] rounded-full whitespace-nowrap">{isFavorite ? "Jadikan Draft" : "★ Jadikan Live"}</button>
        </div>
      </Field>
      <Field label="Harga (Rp)"><NumInput value={meta.price ?? 0} min={0} step={1000} onCommit={(v) => onChange({ price: Math.round(v) }, "price")} /></Field>
    </div>
  );
}

function StrokeShadow({ layer, onChange, stroke = true }) {
  const sh = { ...DEFAULT_SHADOW, ...layer.shadow };
  const setSh = (patch, key) => onChange({ shadow: { ...sh, ...patch } }, key);
  return (
    <>
      {stroke && (
        <>
          <ColorRow label="Stroke Color" value={layer.strokeColor || "#000000"} onChange={(v) => onChange({ strokeColor: v }, "stroke")} />
          <SliderRow label="Stroke Width" value={layer.strokeWidth ?? 0} min={0} max={100} onChange={(v) => onChange({ strokeWidth: v }, "sw")} />
        </>
      )}
      <label className="flex items-center gap-2 font-semibold text-[13px] mt-1">
        <input type="checkbox" checked={sh.enabled} onChange={(e) => setSh({ enabled: e.target.checked })} /> Drop Shadow
      </label>
      <ColorRow label="Color" disabled={!sh.enabled} value={sh.color} onChange={(v) => setSh({ color: v }, "sh-color")} />
      <SliderRow label="Angle" disabled={!sh.enabled} value={sh.angle} min={-180} max={180} unit="°" onChange={(v) => setSh({ angle: v }, "sh-angle")} />
      <SliderRow label="Distance" disabled={!sh.enabled} value={sh.distance} min={0} max={200} onChange={(v) => setSh({ distance: v }, "sh-dist")} />
      <SliderRow label="Spread" disabled={!sh.enabled} value={sh.spread} min={0} max={200} onChange={(v) => setSh({ spread: v }, "sh-spread")} />
    </>
  );
}

function LayerOptions({ layer, layers, onChange, onReplaceImage }) {
  const maxExisting = Math.max(0, ...layers.filter((l) => l.type === "photo-slot").map((l) => l.photoOrder || 0));
  const photoNumbers = Array.from({ length: Math.max(12, maxExisting) }, (_, i) => i + 1);
  const imageName = layer.fileName || (layer.imageUrl ? decodeURIComponent(layer.imageUrl.split("/").pop()) : "");

  return (
    <div className="flex flex-col gap-2.5">
      {layer.type === "image" && (
        <Field label="Image Path">
          <div className="flex gap-1">
            <input readOnly className={inputCls} value={imageName} title={layer.imageUrl} />
            <button onClick={onReplaceImage} title="Ganti gambar" className="px-3 bg-[#E8EEF4] hover:bg-[#DCE5EE]">…</button>
          </div>
        </Field>
      )}

      {layer.type === "photo-slot" && (
        <>
          <Field label="Photo #">
            <div className="flex items-center gap-2">
            <span title={`Warna slot: ${slotColor(layer.photoOrder).name}`} className="w-6 h-6 rounded-md flex-shrink-0 border border-black/25 flex items-center justify-center text-[11px] font-bold" style={{ background: slotColor(layer.photoOrder).bg, color: slotColor(layer.photoOrder).fg }}>{layer.photoOrder ?? 1}</span>
            <select
              className={inputCls}
              value={layer.photoOrder ?? 1}
              onChange={(e) => {
                const n = Number(e.target.value);
                // nama otomatis ("Photo 3") ikut berubah; nama kustom ("Photo 1 Copy", "Foto utama") dibiarkan
                const auto = !layer.name || /^Photo \d+$/.test(layer.name);
                onChange({ photoOrder: n, ...(auto ? { name: `Photo ${n}` } : {}) });
              }}
            >
              {photoNumbers.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            </div>
          </Field>
          <p className="text-[11px] text-[#6B7684] -mt-1">Slot dengan nomor yang sama menampilkan foto yang sama.</p>
        </>
      )}

      {layer.type === "shape" && (
        <>
          <Field label="Bentuk">
            <select value={layer.shapeKind} onChange={(e) => onChange({ shapeKind: e.target.value })} className={inputCls}>
              {SHAPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
          <ColorRow label="Fill Color" disabled={layer.fillColor === "transparent"} value={layer.fillColor === "transparent" ? "#ffffff" : layer.fillColor} onChange={(v) => onChange({ fillColor: v }, "fill")} />
          <label className="flex items-center gap-1.5 text-[12px] -mt-1"><input type="checkbox" checked={layer.fillColor === "transparent"} onChange={(e) => onChange({ fillColor: e.target.checked ? "transparent" : "#ff3e8e" })} /> Tanpa isi</label>
        </>
      )}

      {layer.type === "text" && (
        <>
          <Field label="Isi teks"><input value={layer.text} onChange={(e) => onChange({ text: e.target.value }, "text")} className={inputCls} /></Field>
          <Field label="Font">
            <select value={layer.fontFamily} onChange={(e) => onChange({ fontFamily: e.target.value })} className={inputCls}>
              {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Ukuran font (px)"><NumInput value={layer.fontSize} min={4} onCommit={(v) => onChange({ fontSize: Math.round(v) }, "fs")} /></Field>
          <ColorRow label="Color" value={layer.color} onChange={(v) => onChange({ color: v }, "color")} />
          <Field label="Perataan">
            <select value={layer.align} onChange={(e) => onChange({ align: e.target.value })} className={inputCls}>
              <option value="left">Kiri</option><option value="center">Tengah</option><option value="right">Kanan</option>
            </select>
          </Field>
          <div className="flex gap-4">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!layer.bold} onChange={(e) => onChange({ bold: e.target.checked })} /> Bold</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!layer.italic} onChange={(e) => onChange({ italic: e.target.checked })} /> Italic</label>
          </div>
        </>
      )}

      <StrokeShadow layer={layer} onChange={onChange} stroke={layer.type !== "text"} />

      {layer.type === "photo-slot" && (
        <Field label="Bentuk slot">
          <select value={layer.shapeKind} onChange={(e) => onChange({ shapeKind: e.target.value })} className={inputCls}>
            {SHAPES.filter((s) => s.id !== "star").map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
      )}

      <SliderRow label="Opacity" value={Math.round((layer.opacity ?? 1) * 100)} min={0} max={100} unit="%" onChange={(v) => onChange({ opacity: v / 100 }, "opacity")} />
    </div>
  );
}

function NewTemplateModal({ categories, onManageCategories, onClose, onCreate }) {
  const [f, setF] = useState({ name: "", category: categories[0]?.id, price: 25000, paperSize: "4x6", orientation: "portrait", dpi: 300, backgroundColor: "#ffffff", customW: 1200, customH: 1800 });
  useEffect(() => { if (!categories.some((c) => c.id === f.category) && categories[0]) setF((p) => ({ ...p, category: categories[0].id })); }, [categories]); // eslint-disable-line react-hooks/exhaustive-deps
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const px = f.paperSize === "custom" ? { w: Math.round(f.customW), h: Math.round(f.customH) } : paperPx(f.paperSize, f.orientation, f.dpi);

  async function submit() {
    setError(null);
    if (!px.w || !px.h || px.w < 50 || px.h < 50) return setError("Ukuran kanvas minimal 50 px.");
    setBusy(true);
    try {
      await onCreate({
        name: f.name || "Template Baru", category: f.category, price: Number(f.price) || 0,
        canvasWidth: px.w, canvasHeight: px.h, paperSize: f.paperSize, orientation: px.w > px.h ? "landscape" : "portrait",
        dpi: f.dpi, backgroundColor: f.backgroundColor, initialImageFile: file || undefined,
      });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="New Template" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Field label="Nama template"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} placeholder="Contoh: Postcard Pink" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kategori">
            <CategorySelect value={f.category} categories={categories} onManage={onManageCategories} onChange={(v) => setF({ ...f, category: v })} />
          </Field>
          <Field label="Harga (Rp)"><input type="number" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} className={inputCls} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Paper Size">
            <select value={f.paperSize} onChange={(e) => setF({ ...f, paperSize: e.target.value })} className={inputCls}>
              {PAPERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Orientation">
            <select value={f.orientation} disabled={f.paperSize === "custom"} onChange={(e) => setF({ ...f, orientation: e.target.value })} className={inputCls}>
              <option value="portrait">Vertical</option><option value="landscape">Horizontal</option>
            </select>
          </Field>
          <Field label="Resolution">
            <select value={f.dpi} onChange={(e) => setF({ ...f, dpi: Number(e.target.value) })} className={inputCls}>
              {DPIS.map((d) => <option key={d} value={d}>{d} dpi</option>)}
            </select>
          </Field>
        </div>
        {f.paperSize === "custom" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Width (px)"><input type="number" value={f.customW} onChange={(e) => setF({ ...f, customW: Number(e.target.value) })} className={inputCls} /></Field>
            <Field label="Height (px)"><input type="number" value={f.customH} onChange={(e) => setF({ ...f, customH: Number(e.target.value) })} className={inputCls} /></Field>
          </div>
        )}
        <p className="text-[12px] text-[#55606E]">Ukuran kanvas: <b className="text-[#181B23]">{px.w} × {px.h} px</b></p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Warna latar"><input type="color" value={f.backgroundColor} onChange={(e) => setF({ ...f, backgroundColor: e.target.value })} className="h-8 w-16 bg-transparent" /></Field>
          <Field label="Gambar latar (opsional)"><input type="file" accept="image/png,image/jpeg" onChange={(e) => setFile(e.target.files[0] || null)} className="text-[11px]" /></Field>
        </div>
        {error && <p className="text-red-600 text-[12px]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 bg-[#E8EEF4] hover:bg-[#DCE5EE]">Batal</button>
          <button onClick={submit} disabled={busy} className="px-4 py-2 bg-[#E02843] hover:bg-[#B81E36] text-white disabled:opacity-50">{busy ? "Membuat..." : "Buat Template"}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Dialog setelah memilih file impor: nama, kategori, harga (file dslrBooth tidak menyimpan harga/kategori). */
function ImportAskModal({ parsed, categories, onManageCategories, onClose, onConfirm }) {
  const { meta, layers } = parsed;
  const [name, setName] = useState(meta.name || "");
  const [category, setCategory] = useState(meta.category || categories[0]?.id);
  const [price, setPrice] = useState(String(meta.price || 25000));
  useEffect(() => { if (!categories.some((c) => c.id === category) && categories[0]) setCategory(categories[0].id); }, [categories]); // eslint-disable-line react-hooks/exhaustive-deps
  const photos = new Set(layers.filter((l) => l.type === "photo-slot").map((l) => l.photoOrder)).size;
  return (
    <Modal title="Impor template" onClose={onClose} width="w-[480px]">
      <p className="text-[13px] text-[#262A38] mb-3">{meta.canvasWidth}×{meta.canvasHeight} px · {layers.length} layer · {photos} foto. File dari dslrBooth tidak membawa harga dan kategori, jadi isi di sini.</p>
      <div className="flex flex-col gap-3">
        <Field label="Nama template"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
        <Field label="Kategori"><CategorySelect value={category} categories={categories} onManage={onManageCategories} onChange={setCategory} /></Field>
        <Field label="Harga (Rp)"><input type="number" min={0} step={1000} value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} /></Field>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-4 py-2 border border-[#C7D0DA] text-[13px]">Batal</button>
        <button onClick={() => onConfirm({ name: name.trim(), category, price: Math.max(0, Math.round(Number(price) || 0)) })} className="px-4 py-2 bg-[#E02843] hover:bg-[#B81E36] text-white text-[13px]">Impor</button>
      </div>
    </Modal>
  );
}
