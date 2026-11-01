import React, { useEffect, useRef, useState } from "react";
import appConfig from "../config/appConfig";
import useCountdown from "../hooks/useCountdown";
import useCamera from "../hooks/useCamera";
import useShotSequence from "../hooks/useShotSequence";
import LiveView from "../components/LiveView";
import CountdownOverlay from "../components/CountdownOverlay";
import SesiDecor from "../components/SesiDecor";
import { Camera } from "lucide-react";

// Rata-rata kecerahan (0-255) sebuah gambar kecil — untuk menyamakan live view dengan hasil jepret
function lumaOfCanvas(c) {
  if (!c) return 0;
  const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return sum / (d.length / 4);
}
async function lumaOfImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const k = 48 / Math.max(img.naturalWidth, 1);
  const c = document.createElement("canvas");
  c.width = 48; c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return lumaOfCanvas(c);
}
import logo from "../assets/logo-popsnap.png";
import { photoSlotPlan } from "../utils/templatePhotos";
import useClipRecorder from "../hooks/useClipRecorder";
import { clearClips } from "../utils/clipStore";
import useShape from "../hooks/useShape";


// Satuan desain: 1 = 1px pada kanvas 1728x1117 (lihat .strip-screen di index.css)
const U = (n) => `calc(var(--u) * ${n})`;
const REVIEW_SECONDS = 20; // lama pratinjau akhir sebelum otomatis lanjut ke editor
const fmtT = (sec) => `${String(Math.floor(sec / 60)).padStart(2, "0")}.${String(sec % 60).padStart(2, "0")}`;

/**
 * Tahap 5: Sesi foto (ala dslrBooth, semua angka dari Admin > Pengaturan). Desain "sesi_foto".
 *  - Hitung mundur otomatis -> jepret -> foto tampil sebentar -> hitung mundur berikutnya, sampai jumlah foto terpenuhi.
 *  - Ketuk layar kamera ATAU tombol bulat = potret sekarang (melewati sisa hitung mundur).
 *  - Retake: ketuk foto di kiri/kanan layar (atau tombol Retake di pratinjau) -> foto baru menggantikan di posisi yang sama.
 *  - Setelah foto terakhir: pratinjau semua foto (kalau masih ada jatah retake) -> NEXT / habis waktu -> editor.
 *  - Timer sesi; kalau habis -> popup tambah waktu.
 *  - Tombol Batal (bisa disembunyikan), thumbnail (lokasi bisa diatur), crop live view sesuai slot pertama template.
 */
export default function PhotoSessionScreen({ session, dispatch }) {
  const shape = useShape(); // portrait 1080x1800 | square 1200x1200 | landscape 1728x1117
  const portrait = shape === "portrait";
  const stacked = shape !== "landscape"; // portrait & square: kamera di atas, thumbnail di bawahnya
  const V = (l, p, q) => (portrait ? p : shape === "square" ? q : l);
  const s = appConfig.settings ?? {};
  const cap = s.display?.capture ?? {};
  const { totalShots, maxRetakes } = appConfig.photoSession;
  const camera = useCamera(session.orientation);
  // Template animasi: rekam momen sebelum & sesudah tiap jepretan (klip per foto) — lihat hooks/useClipRecorder.js
  const animCfg = s.animated ?? {};
  const recordClips = (s.result?.live ?? true) !== false; // Live = fitur sendiri (Admin > GIF & Video > Hasil Akhir), tidak tergantung template
  const recorder = useClipRecorder({
    enabled: recordClips && camera.ready,
    grab: camera.grabCanvas,
    cfg: { secondsBefore: animCfg.secondsBefore ?? 1.5, secondsAfter: animCfg.secondsAfter ?? 2, fps: animCfg.fps ?? 10, clipWidth: animCfg.clipWidth ?? 640 },
  });
  const shotIndexNow = useRef(0);
  shotIndexNow.current = session.retakeAt ?? session.shots.length;
  // Sesi baru (belum ada foto): buang klip sisa sesi sebelumnya
  useEffect(() => { if (session.shots.length === 0) clearClips(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const mirror = !!session.editorState?.mirror; // pilihan tamu; foto mentah tetap asli, dibalik saat tampil & saat hasil dibuat
  const mirrorStyle = mirror ? { transform: "scaleX(-1)" } : undefined;
  const [showTimeoutPopup, setShowTimeoutPopup] = useState(false);
  const [extendedOnce, setExtendedOnce] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [previewIdx, setPreviewIdx] = useState(null); // nomor foto yang sedang dilihat besar (ketuk thumbnail)
  const needed = session.shotIndex < totalShots;
  const paused = showTimeoutPopup || confirmCancel || previewIdx !== null;

  const { remaining, addSeconds } = useCountdown(appConfig.timers.photoSession, () => setShowTimeoutPopup(true), needed);

  // Mode ketuk: "all" = tiap foto diketuk; "first" = ketuk sekali di foto pertama (atau saat retake), sisanya otomatis
  const scopeFirst = cap.manualTrigger !== false && cap.manualScope === "first";
  const manualNow = cap.manualTrigger !== false && (!scopeFirst || session.shots.length === 0 || session.retakeAt != null);
  const hint = cap.captureHint ?? "pulse";
  const seq = useShotSequence({
    active: camera.ready && !paused,
    needed,
    shotCount: session.shots.length,
    manual: manualNow,
    autoSequence: cap.autoSequence !== false || scopeFirst,
    autoTrigger: s.camera?.autoTrigger !== false,
    countdownFirst: cap.countdownFirst ?? 5,
    countdownOthers: cap.countdownOthers ?? 3,
    displaySeconds: cap.displayPhotoSeconds ?? 2,
    capture: async () => {
      recorder.mark(shotIndexNow.current);
      const photo = await camera.capture();
      // live view belajar "seterang apa hasil foto" (dipakai kecerahan otomatis, lihat useCamera)
      if (photo) lumaOfImage(photo).then((l) => camera.learnPhotoLuma(l)).catch(() => {});
      return photo;
    },
    onCaptured: (photo) => dispatch({ type: "CAPTURE_SHOT", payload: { photo } }),
  });

  function handleRetake(index) {
    if (session.retakesUsed >= maxRetakes || session.retakeAt != null) return;
    setPreviewIdx(null);
    dispatch({ type: "RETAKE_SHOT", payload: { index } });
  }

  // Crop live view sesuai bentuk slot foto pertama di template (supaya orang tahu persis bagian yang akan tercetak)
  const tpl = session.selectedTemplate;
  const firstSlot = tpl ? photoSlotPlan(tpl.layers ?? []).slots[0] : null;
  const aspect = firstSlot
    ? (firstSlot.widthPct * tpl.canvasWidth) / (firstSlot.heightPct * tpl.canvasHeight)
    : session.orientation === "portrait" ? 9 / 16 : 16 / 9;

  const retakesLeft = Math.max(0, maxRetakes - session.retakesUsed);
  const retakeAt = session.retakeAt ?? null;
  const allDone = session.shots.length >= totalShots;
  const busyPhase = seq.phase === "flash" || seq.phase === "review";
  // Pratinjau semua foto di akhir sesi: hanya kalau memang masih ada retake yang bisa dipakai
  const reviewing = allDone && retakesLeft > 0 && !busyPhase && !confirmCancel && !showTimeoutPopup;

  // Semua foto sudah ada & tidak ada retake lagi -> langsung ke editor
  useEffect(() => {
    if (allDone && retakesLeft <= 0 && !busyPhase && !paused) dispatch({ type: "FORCE_TO_EDITOR" });
  }, [allDone, retakesLeft, busyPhase, paused, dispatch]);

  // Waktu pratinjau akhir (otomatis lanjut ke editor)
  const [reviewLeft, setReviewLeft] = useState(REVIEW_SECONDS);
  useEffect(() => {
    if (!reviewing || previewIdx !== null) return;
    setReviewLeft((v) => (v <= 0 ? REVIEW_SECONDS : v));
    const t = setInterval(() => setReviewLeft((v) => v - 1), 1000);
    return () => clearInterval(t);
  }, [reviewing, previewIdx]);
  useEffect(() => {
    if (reviewing && reviewLeft <= 0) dispatch({ type: "FORCE_TO_EDITOR" });
  }, [reviewing, reviewLeft, dispatch]);

  // Rasio kamera asli (dilaporkan LiveView): bingkai menampilkan SELURUH pandangan kamera, tidak dipotong
  const [camAspect, setCamAspect] = useState(null);
  // "Bentuk bingkai" (Admin > Kamera): bawaan = ikuti MODE KAMERA (landscape/portrait sesuai orientasi & rotasi kamera, tampil utuh); opsional = potong sesuai slot template
  // frameMode: camera = ikut kamera | template = ikut slot | screen = penuhi area layar (portrait/persegi: kotak lebih tinggi, kamera dipotong)
  const lvCfg = s.camera?.liveView ?? {};
  const frameMode = lvCfg.frameMode ?? (lvCfg.fitTemplate ? "template" : "camera");
  const fitTpl = frameMode === "template" && !!firstSlot;
  const fillArea = frameMode === "screen" && shape !== "landscape";

  // Kotak kamera: muat di area desain 1275x850, rasio mengikuti crop
  const FW = V(1275, 960, 1000), FH = V(830, 1000, 580); // tinggi dikurangi supaya ada jarak dari tombol potret & logo di atas
  const fit = (ar, maxW, maxH) => (ar >= maxW / maxH ? { w: maxW, h: maxW / ar } : { w: maxH * ar, h: maxH });

  // Foto per posisi (saat retake berjalan, posisi yang diulang tampil kosong, sisanya tidak bergeser)
  const slotShot = (p) => (retakeAt == null ? session.shots[p] : p < retakeAt ? session.shots[p] : p === retakeAt ? undefined : session.shots[p - 1]);
  const nextSlot = retakeAt ?? session.shots.length;
  const canRetake = retakesLeft > 0 && retakeAt == null && !busyPhase;

  // Thumbnail kiri/kanan layar (pratinjau hasil): separuh kiri, separuh kanan
  const GAP = 14;
  // Landscape: dua kolom (kiri/kanan) berisi separuh-separuh. Portrait: dua baris di bawah kamera.
  const rows = Math.ceil(totalShots / 2);
  const tile = stacked ? fit(aspect || 1.5, (FW - (Math.ceil(totalShots / 2) - 1) * GAP) / Math.ceil(totalShots / 2), V(0, 190, 125)) : fit(aspect || 1.5, 170, (FH - (rows - 1) * GAP) / rows);
  const blockGap = V(0, 60, 40), regionTop = V(0, 110, 90), regionH = V(0, 1450, 930);
  // Penuhi area layar: kotak kamera memakai sisa tinggi di atas dua baris thumbnail
  const areaH = stacked ? Math.max(300, regionH - blockGap - (2 * tile.h + GAP) - 40) : FH;
  const boxAspect = fitTpl ? aspect : fillArea ? FW / areaH : camAspect || 3 / 2;
  const frame = fillArea ? { w: FW, h: areaH } : fit(boxAspect, FW, FH);
  const renderTile = (p) => {
    const shot = slotShot(p);
    return (
      <button
        key={p}
        type="button"
        disabled={!shot || !canRetake}
        onClick={() => setPreviewIdx(p)}
        aria-label={shot ? `Foto ${p + 1}, ketuk untuk melihat besar / retake` : `Foto ${p + 1} belum diambil`}
        className={`sess-tile ${mirror ? "is-mir" : ""} ${shot ? "is-filled" : ""} ${p === nextSlot && needed ? "is-next" : ""}`}
        style={{ width: U(tile.w), height: U(tile.h) }}
      >
        {shot ? <img src={shot} alt="" draggable={false} /> : <span style={{ fontSize: U(34) }}>{p + 1}</span>}
        {shot && <span className="sess-tile__num" style={{ fontSize: U(20), width: U(34), height: U(34) }}>{p + 1}</span>}
        {shot && canRetake && <span className="sess-tile__retake" style={{ fontSize: U(20), height: U(34) }}>↺ Retake</span>}
      </button>
    );
  };
  // Portrait: kamera + dua baris thumbnail dipusatkan sebagai satu blok di antara baris atas (y 110) dan tombol bawah (y 1560)
  const tilesH = stacked ? 2 * tile.h + GAP : 0;
  const blockTop = stacked ? regionTop + (regionH - (frame.h + blockGap + tilesH)) / 2 : 0;
  const frameCenterY = stacked ? blockTop + frame.h / 2 : 0;
  const tilesTop = stacked ? blockTop + frame.h + blockGap : 0;
  const half = Math.ceil(totalShots / 2);
  const leftTiles = Array.from({ length: half }, (_, i) => i);
  const rightTiles = Array.from({ length: totalShots - half }, (_, i) => half + i);

  // Ketuk layar kamera / tombol bulat.
  //  - Mode manual: ketuk = mulai hitung mundur (kamera melebar penuh layar), lalu jepret. Ketukan saat hitung mundur diabaikan.
  //  - Mode otomatis (lama): ketuk = potret sekarang (melewati sisa hitung mundur).
  const manual = manualNow;
  const waiting = seq.phase === "idle" || seq.phase === "await";
  const canTap = camera.ready && needed && !busyPhase && !reviewing && !paused;
  const tap = () => {
    if (!canTap) return;
    if (manual) {
      if (seq.phase === "await") seq.shootNow();
      else if (seq.phase === "idle") seq.start();
    } else seq.shootNow();
  };
  // Layar penuh hanya saat sesi pemotretan berjalan (hitung mundur / jepret); selebihnya di bingkai desain
  const fullscreen = seq.phase === "countdown" || seq.phase === "flash" || (seq.phase === "await" && !reviewing);

  const taken = Math.min(session.shots.length, totalShots);
  const timerText = fmtT(reviewing ? Math.max(0, reviewLeft) : remaining);

  // Pratinjau akhir: ukuran tile
  const rvCols = portrait ? 2 : shape === "square" ? (totalShots <= 4 ? 2 : 3) : Math.ceil(totalShots / 2); // persegi: kolom lebih sedikit supaya foto tidak mungil
  const rvRows = Math.ceil(totalShots / rvCols);
  const RV = { landscape: { px: 227, py: 110, pw: FW, ph: 840, tx: 245, ty: 128, tw: FW - 36, th: 804, ttl: { left: 552, top: 40 }, next: { left: 1534, top: 968 } },
    portrait: { px: 60, py: 200, pw: 960, ph: 1330, tx: 78, ty: 218, tw: 924, th: 1294, ttl: { left: 228, top: 120 }, next: { left: 832, top: 1716 } },
    square: { px: 100, py: 120, pw: 1000, ph: 960, tx: 118, ty: 138, tw: 964, th: 924, ttl: { left: 288, top: 36 }, next: { left: 338, top: 1111 } } }[shape];
  const sqRv = shape === "square" && reviewing; // pratinjau akhir di layar persegi: baris bawah dirapatkan (Take | NEXT | Mirror | Retake) agar tidak saling menimpa
  const rvTile = fit(aspect || 1.5, (RV.tw - 120 - (rvCols - 1) * 30) / rvCols, (RV.th - 120 - (rvRows - 1) * 34) / rvRows - 54);

  return (
    <div className="kiosk-screen strip-screen h-full w-full overflow-hidden" data-shape={shape}>
      {/* Dekorasi tertutup kamera saat penuh layar: disembunyikan agar render lebih ringan */}
      <div className="absolute inset-0" style={{ visibility: fullscreen ? "hidden" : "visible" }}><SesiDecor /></div>

      {/* Wadah kamera TUNGGAL: di bingkai desain saat menunggu, melebar penuh layar saat dipotret (video tidak ikut dimuat ulang) */}
      <div
        className={`sess-live ${fullscreen ? "is-full" : ""} ${fitTpl ? "is-fit" : ""}`}
        onClick={tap}
        style={{
          "--ar": boxAspect, "--fw": U(frame.w), "--fh": U(frame.h), "--yoff": U(stacked ? V(0, 900, 600) - frameCenterY : 50),
          visibility: reviewing ? "hidden" : "visible",
          cursor: canTap && waiting ? "pointer" : "default",
        }}
      >
        <LiveView camera={camera} aspect={boxAspect} crop={fitTpl || fillArea} fill onAspect={setCamAspect} mirror={mirror} guide={firstSlot && !fitTpl && !fillArea ? aspect : null} />
        {camera.error && <p className="absolute inset-0 flex items-center justify-center text-center px-6 font-bold" style={{ color: "#FFD9DE", fontSize: U(30) }}>{camera.error}</p>}

        {seq.phase === "countdown" && <CountdownOverlay count={seq.count} label={`Foto ${Math.min(nextSlot + 1, totalShots)} dari ${totalShots}`} />}
        {seq.phase === "await" && <p className="sess-hint sess-hint--big">Ketuk layar untuk ambil foto</p>}
        {seq.phase === "flash" && (
          <div className="sess-flash absolute inset-0 flex items-center justify-center">
            {cap.sayCheeseImage ? <img src={cap.sayCheeseImage} alt="" className="max-h-full max-w-full object-contain" /> : <Camera aria-hidden="true" strokeWidth={1.6} color="#111" style={{ width: "min(22vw, 34vh)", height: "min(22vw, 34vh)" }} />}
          </div>
        )}
        {seq.phase === "review" && seq.lastPhoto && (
          <div className="absolute inset-0 bg-black flex items-center justify-center">
            <img src={seq.lastPhoto} alt="foto barusan" className="max-h-full max-w-full object-contain" style={mirrorStyle} />
            {retakesLeft > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); handleRetake(session.shots.length - 1); }}
                className="strip-btn"
                style={{ position: "absolute", left: "50%", bottom: U(28), transform: "translateX(-50%)", width: U(300), height: U(64), fontSize: U(28) }}
              >↺ RETAKE</button>
            )}
          </div>
        )}
        {canTap && waiting && seq.phase === "idle" && !fullscreen && (
          <p className="sess-hint" style={{ fontSize: U(28), bottom: U(40) }}>{manual ? (scopeFirst ? "Ketuk layar atau tombol ● sekali — sisanya otomatis" : "Ketuk layar atau tombol ● untuk mulai potret") : "Ketuk layar atau tombol ● untuk potret sekarang"}</p>
        )}
      </div>

      <div className="strip-stage sess-stage">
        {/* Pratinjau akhir semua foto: retake yang mana saja */}
        {reviewing && (
          <>
            <div className="pay-title" style={{ left: U(RV.ttl.left), top: U(RV.ttl.top), width: U(624), height: U(76), fontSize: U(38) }}>Check your photos</div>
            <div className="strip-panel" style={{ left: U(RV.px), top: U(RV.py), width: U(RV.pw), height: U(RV.ph) }} />
            <div className="strip-tray" style={{ left: U(RV.tx), top: U(RV.ty), width: U(RV.tw), height: U(RV.th), borderRadius: U(85) }}>
              <div className="sess-review" style={{ "--cols": rvCols, gap: `${U(34)} ${U(30)}`, padding: `${U(60)} ${U(60)}` }}>
                {Array.from({ length: totalShots }, (_, p) => (
                  <div key={p} className="sess-review__item" style={{ width: U(rvTile.w) }}>
                    <div className={`sess-review__shot ${mirror ? "is-mir" : ""}`} style={{ width: U(rvTile.w), height: U(rvTile.h) }}>
                      <img src={session.shots[p]} alt={`foto ${p + 1}`} draggable={false} />
                      <span className="sess-tile__num" style={{ fontSize: U(22), width: U(38), height: U(38) }}>{p + 1}</span>
                    </div>
                    <button onClick={() => handleRetake(p)} className="sess-review__btn" style={{ height: U(44), fontSize: U(22) }}>↺ Retake</button>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={() => dispatch({ type: "FORCE_TO_EDITOR" })} className="strip-btn" style={{ left: U(RV.next.left), top: U(RV.next.top), width: U(170), height: U(62), fontSize: U(30) }}>NEXT</button>
          </>
        )}

        {/* Thumbnail pratinjau hasil: kiri & kanan */}
        {!reviewing && cap.showThumbnails !== false && (
          stacked ? (
            <div className="sess-rows" style={{ gap: U(GAP), top: U(tilesTop) }}>
              <div style={{ display: "flex", justifyContent: "center", gap: U(GAP) }}>{Array.from({ length: Math.ceil(totalShots / 2) }, (_, i) => renderTile(i))}</div>
              <div style={{ display: "flex", justifyContent: "center", gap: U(GAP) }}>{Array.from({ length: totalShots - Math.ceil(totalShots / 2) }, (_, i) => renderTile(Math.ceil(totalShots / 2) + i))}</div>
            </div>
          ) : (
            <>
              <div className="sess-col" style={{ left: U(28), width: U(170), gap: U(GAP) }}>{leftTiles.map(renderTile)}</div>
              <div className="sess-col" style={{ right: U(28), width: U(170), gap: U(GAP) }}>{rightTiles.map(renderTile)}</div>
            </>
          )
        )}

        {/* Tombol batal (kiri atas) + hitung mundur sesi (kanan atas) */}
        {!cap.hideCancel && <button onClick={() => setConfirmCancel(true)} className="pay-mini" style={{ left: U(V(227, 60, 60)), top: U(V(16, 24, 20)), height: U(52), padding: `0 ${U(26)}`, fontSize: U(26) }}>✕ Batal</button>}
        <div className="pay-timer" role="timer" style={{ left: U(V(1341, 859, 979)), top: U(V(14, 24, 20)), width: U(161), height: U(56), fontSize: U(40) }}>{timerText}</div>

        {/* Baris bawah (desain): Take | logo | Retake */}
        <div className="pay-timer" style={{ left: U(V(228, 60, sqRv ? 40 : 60)), top: U(V(995, 1620, sqRv ? 1112 : 1100)), height: U(64), padding: `0 ${U(32)}`, fontSize: U(34), fontWeight: 700 }}>Take : {taken}/{totalShots}</div>
        {/* Logo di atas (tengah, di antara Batal dan timer); saat pratinjau akhir kembali ke bawah karena judul menempati atas */}
        <img src={logo} alt="PopSnap" draggable={false} className="strip-logo"
          style={sqRv ? { display: "none" } : stacked ? { left: U(V(0, 450, 510)), top: U(14), width: U(180) } : reviewing ? { left: U(774), top: U(1000), width: U(180) } : { left: U(774), top: U(10), width: U(180) }} />
        <div className="pay-timer" style={{ right: U(V(226, 60, sqRv ? 40 : 60)), top: U(V(995, 1620, sqRv ? 1112 : 1100)), height: U(64), padding: `0 ${U(34)}`, fontSize: U(34), fontWeight: 700 }}>Retake : {session.retakesUsed}/{maxRetakes}</div>


        {/* Mirror / No Mirror: tamu memilih tampilan kamera & hasil fotonya (masih bisa diubah lagi di editor) */}
        <div role="group" aria-label="Mirror" style={{ left: U(V(982, 422, sqRv ? 581 : 660)), top: U(V(999, 1716, sqRv ? 1116 : 1070)), width: U(236), height: U(56), borderRadius: U(28), background: "#DBDBDB", border: "1px solid #000", overflow: "hidden", zIndex: 3 }}>
          <div style={{ position: "absolute", top: 0, height: "100%", borderRadius: U(28), background: "#E02843", transition: "left .2s ease, width .2s ease", left: mirror ? 0 : U(92), width: mirror ? U(104) : U(144) }} />
          {[[true, "Mirror", 0, 104], [false, "No Mirror", 92, 144]].map(([val, label, x, w]) => (
            <button key={label} type="button" aria-pressed={mirror === val} onClick={() => dispatch({ type: "SET_MIRROR", payload: { mirror: val } })}
              style={{ position: "absolute", left: U(x), width: U(w), top: 0, height: "100%", border: 0, background: "transparent", color: mirror === val ? "#fff" : "#333", fontSize: U(22), fontWeight: 700, fontStyle: "italic", zIndex: 1 }}>{label}</button>
          ))}
        </div>

        {/* Tombol potret bulat: di bawah bingkai kamera dengan jarak, tidak menimpa */}
        {!reviewing && (
          <button onClick={tap} disabled={!canTap || seq.phase === "countdown"} aria-label="Potret" className={`sess-capture${canTap && waiting && hint !== "off" ? ` sess-capture--${hint}` : ""}`} style={{ left: U(V(809, 485, 520)), top: U(V(980, 1580, 1040)), width: U(110), height: U(110) }}>
            <Camera aria-hidden="true" strokeWidth={2.2} color="#E02843" style={{ width: U(54), height: U(54) }} />
          </button>
        )}
      </div>

      {/* Foto besar + retake (ketuk thumbnail) */}
      {previewIdx !== null && slotShot(previewIdx) && (
        <div className="absolute inset-0 z-30 bg-black/75 flex items-center justify-center p-4" onClick={() => setPreviewIdx(null)}>
          <div className="modal-card p-5 sm:p-7 max-w-[90vw] flex flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
            <p className="display-h3">Foto {previewIdx + 1} dari {totalShots}</p>
            <img src={slotShot(previewIdx)} alt={`foto ${previewIdx + 1}`} className="max-h-[58vh] max-w-[80vw] object-contain rounded-xl border-2 border-black/20" style={mirrorStyle} />
            <p className="text-sm text-[#55606E]">{retakesLeft > 0 ? `Sisa retake: ${retakesLeft}. Foto baru akan menggantikan foto ini.` : "Batas retake sudah habis."}</p>
            <div className="flex gap-3">
              <button onClick={() => setPreviewIdx(null)} className="btn-pop btn-outline !border-pop-dark !text-pop-dark px-6 py-2.5">Tutup</button>
              {retakesLeft > 0 && <button onClick={() => handleRetake(previewIdx)} className="btn-pop btn-flash px-6 py-2.5">↺ Retake foto ini</button>}
            </div>
          </div>
        </div>
      )}

      {showTimeoutPopup && (
        <div className="absolute inset-0 z-30 bg-black/80 flex items-center justify-center p-4">
          <div className="modal-card p-5 sm:p-8 max-w-sm w-full text-center">
            <p className="display-h3 mb-3 sm:mb-4">Waktu sudah habis</p>
            <p className="mb-4 sm:mb-6 text-sm sm:text-base">Apakah perlu tambahan waktu {Math.round(appConfig.timers.photoSessionExtend / 60 * 10) / 10 || 1} menit?</p>
            <div className="flex gap-3 sm:gap-4 justify-center">
              <button onClick={() => { setShowTimeoutPopup(false); dispatch({ type: "FORCE_TO_EDITOR" }); }} className="btn-pop btn-outline !border-pop-dark !text-pop-dark px-4 sm:px-6 py-2.5 sm:py-3 text-sm sm:text-base">Tidak, lanjut</button>
              <button onClick={() => { addSeconds(appConfig.timers.photoSessionExtend); setExtendedOnce(true); setShowTimeoutPopup(false); }} disabled={extendedOnce} className="btn-pop btn-flash px-4 sm:px-6 py-2.5 sm:py-3 text-sm sm:text-base">Ya, tambah waktu</button>
            </div>
          </div>
        </div>
      )}

      {confirmCancel && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-4 z-30">
          <div className="modal-card p-5 sm:p-8 max-w-sm w-full text-center">
            <p className="display-h3 mb-2">Batalkan sesi?</p>
            <p className="mb-5 text-sm sm:text-base text-[#55606E]">Foto yang sudah diambil akan hilang dan pembayaran tidak dikembalikan otomatis.</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => setConfirmCancel(false)} className="btn-pop btn-outline !border-pop-dark !text-pop-dark px-5 py-2.5">Lanjutkan</button>
              <button onClick={() => dispatch({ type: "CANCEL_SESSION" })} className="btn-pop px-5 py-2.5">Ya, batalkan</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
