import React, { useEffect, useRef, useState } from "react";
import { Camera, Images, Video } from "lucide-react";
import RoundedQR from "../components/RoundedQR";
import appConfig from "../config/appConfig";
import useCountdown from "../hooks/useCountdown";
import { uploadSession, uploadMedia, uploadClip, uploadLive } from "../services/sessionService";
import { buildAnimatedAssets, buildRevealGif } from "../utils/animate";
import { whenClipsReady, hasClips } from "../utils/clipStore";
import { composeImage } from "../utils/composeImage";
import { dataUrlToImageData, encodeGif } from "../utils/gif";
import SesiDecor from "../components/SesiDecor";
import useShape from "../hooks/useShape";

// Satuan desain: 1 = 1px pada kanvas 1728x1117 (lihat .strip-screen di index.css)
const U = (n) => `calc(var(--u) * ${n})`;

/**
 * Tahap 7: Hasil akhir + QR download.
 * - Mode foto: render hasil final, unggah, (opsional) buat GIF dari foto-foto sesi -> tab "Foto | GIF" dengan QR masing-masing.
 * - Mode GIF / Boomerang / Video: tampilkan hasil yang sudah diunggah.
 * - Desain "Edit frame": kartu hasil di kiri, panel QR oranye di kanan, tab Foto | GIF + Done di bawah QR.
 * - "Final Screen Timeout" (0 = tidak otomatis), tombol Done bisa disembunyikan, posisi QR (kanan/kiri) & label diatur di Admin > Tampilan.
 */
export default function ResultScreen({ session, dispatch }) {
  const shape = useShape(); // portrait: kanvas 1080x1800 (hasil di atas, QR di bawah); square: 1200x1200 (berdampingan, lebih ringkas)
  const portrait = shape === "portrait";
  const P = (l, p, q = l) => (portrait ? p : shape === "square" ? q : l);
  const s = appConfig.settings ?? {};
  const sharing = s.display?.sharing ?? { hideDone: false, iconsLocation: "right", showLabels: true };
  const timeout = appConfig.timers.downloadQr;
  const isPhoto = session.mode === "photo";
  const R = { live: true, gif: true, defaultView: "photo", gifStyle: "template", gifHoldMs: 1800, ...(s.result ?? {}) }; // Admin > GIF & Video > Hasil Akhir
  const picked = useRef(false); // tamu sudah memilih tab sendiri -> jangan dipindah otomatis

  const [hideQr, setHideQr] = useState(false);
  const [finalImage, setFinalImage] = useState(null);
  const [gif, setGif] = useState(null);       // GIF foto-foto muncul satu per satu di dalam template { previewUrl, url }
  const [live, setLive] = useState(null);     // video klip momen di tiap slot template { previewUrl, kind: "video" | "img" }
  const [view, setView] = useState("photo");  // photo | live | gif
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [shareUrl, setShareUrl] = useState(null); // halaman unduh /s/<token> (template animasi)
  const [animating, setAnimating] = useState(false);

  const { remaining } = useCountdown(timeout || 1, () => timeout && (setHideQr(true), dispatch({ type: "DONE" })), timeout > 0 && !hideQr);

  useEffect(() => {
    if (!isPhoto) return;
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const template = session.selectedTemplate;
        const chosen = session.photosForTemplate.map((i) => (i == null ? undefined : session.shots[i])); // slot kosong = undefined
        const chosenPhotos = chosen.filter(Boolean);
        // Render hasil final — SEMUA layer sesuai urutan depan-belakang yang diatur admin (sama dengan layar Editor)
        const composed = await composeImage({
          canvasWidth: template?.canvasWidth ?? 1200, canvasHeight: template?.canvasHeight ?? 1800,
          backgroundColor: template?.backgroundColor, layers: template?.layers ?? [], photos: chosen, editorState: session.editorState,
        });
        if (cancelled) return;
        setFinalImage(composed);
        const up = await uploadSession({ ...session, finalImage: composed });
        if (cancelled) return;
        dispatch({ type: "SET_DOWNLOAD_URL", payload: { url: up.downloadUrl } });
        dispatch({ type: "MERGE", payload: { sessionId: up.sessionId, uploadKey: up.uploadKey } });

        const anim = s.animated ?? {};
        // Klip momen terakhir baru selesai beberapa detik SETELAH jepretan -> tunggu dulu baru putuskan Live ada atau tidak
        if (R.live) await whenClipsReady();
        const animated = !!(R.live && hasClips()); // Live = fitur sendiri: cukup dinyalakan di Hasil Akhir
        const wantLive = animated;
        // Petunjuk kalau tombol Live tidak muncul (lihat Console / log): fitur mati, template belum "animasi", atau klip tidak terekam
        if (!wantLive) console.info("[result] Live tidak dibuat:", { hasilLiveAktif: !!R.live, adaKlip: hasClips() });
        if (up.shareUrl) setShareUrl(up.shareUrl);

        const ids = { sessionId: up.sessionId, uploadKey: up.uploadKey };
        // GIF: foto-foto muncul satu per satu mengisi template (aktif untuk mode foto bila "Buat GIF" / template animasi menyala)
        const wantGif = R.gif && chosenPhotos.length >= 2; // GIF = fitur sendiri (Hasil Akhir)
        const makeGif = async () => {
          try {
            const style = R.gifStyle;
            const gifW = s.gif?.width ?? 480, delay = s.gif?.frameDelayMs ?? 600;
            const plain = async () => encodeGif(await Promise.all(chosenPhotos.map((u) => dataUrlToImageData(u, gifW))), delay);
            // "template" / "both": stop-motion di dalam template; "plain": foto saja. Yang pertama jadi GIF utama (tab GIF).
            const main = style === "plain" ? await plain() : await buildRevealGif({ template, chosen, editorState: session.editorState, width: Math.min(gifW, 600), delayMs: delay, holdMs: R.gifHoldMs });
            if (!main || cancelled) return;
            const r = await uploadMedia(main, "gif", ids);
            if (!cancelled) setGif({ previewUrl: URL.createObjectURL(main), url: r.downloadUrl });
            if (style === "both" && !cancelled) { const pb = await plain(); await uploadLive(pb, ids, "gifplain").catch((e) => console.warn("[result] GIF polos gagal diunggah:", e.message)); }
          } catch (err) { console.warn("[result] GIF gagal dibuat (foto tetap tersedia):", err.message); }
        };
        if (animated && wantLive) {
          // Urutan: LIVE dulu (yang paling ditunggu) -> GIF -> klip mentah. Preview muncul begitu siap; unggahan jalan di latar.
          setAnimating(true);
          try {
            const bg = []; let gifTried = false;
            await buildAnimatedAssets({
              session, cfg: anim,
              onLive: async (out) => {
                if (cancelled) return;
                if (out.mp4) { setLive({ previewUrl: URL.createObjectURL(out.mp4), kind: "video" }); bg.push(uploadMedia(out.mp4, "video", ids).catch((e) => console.warn("[result] Video Live gagal diunggah:", e.message))); }
                else if (out.gif) { setLive({ previewUrl: URL.createObjectURL(out.gif), kind: "img" }); bg.push(uploadLive(out.gif, ids).catch((e) => console.warn("[result] Live (GIF) gagal diunggah:", e.message))); }
                if (wantGif) { gifTried = true; await makeGif(); } // GIF stop-motion menyusul tepat sesudah Live tampil
              },
              onClip: async (c) => { bg.push(uploadClip(c.blob, { ...ids, n: c.n }).catch((e) => console.warn("[result] klip gagal diunggah:", e.message))); },
            });
            if (wantGif && !gifTried && !cancelled) await makeGif(); // tidak ada klip yang bisa dipakai -> tetap buat GIF
            await Promise.all(bg);
          } catch (err) {
            console.warn("[result] Animasi gagal dibuat (foto tetap tersedia):", err.message);
          } finally { if (!cancelled) setAnimating(false); }
        } else if (animated) {
          if (wantGif) await makeGif(); // Live dimatikan admin: hanya GIF
        } else if (wantGif) {
          await makeGif();
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Gagal menyiapkan hasil.");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const ICONS = { photo: Camera, live: Video, gif: Images };
  const views = [["photo", "Foto"], ...(live ? [["live", "Live"]] : []), ...(gif ? [["gif", "GIF"]] : [])];
  const activeView = views.some(([id]) => id === view) ? view : "photo";
  // Tampilan awal pilihan admin: pindah otomatis begitu tersedia, kecuali tamu sudah memilih sendiri
  useEffect(() => { if (!picked.current && (R.defaultView === "live" ? live : R.defaultView === "gif" ? gif : null)) setView(R.defaultView); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, gif]);
  // SATU QR / link untuk semuanya (halaman unduh berisi hasil template, GIF, video, foto mentah, klip). Tab Foto | GIF hanya mengganti tampilan.
  const qrUrl = shareUrl || session.downloadUrl;
  // Posisi QR: kanan (desain) atau kiri (cerminkan seluruh tata letak). "bawah" memakai tata letak desain (kanan).
  const flip = sharing.iconsLocation === "left";
  const X = (x, w) => (flip && shape === "landscape" ? 1728 - x - w : x);

  const fitStyle = { maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" };
  const preview = !isPhoto ? (
    session.media?.kind === "video" ? (
      <video src={session.media.previewUrl} autoPlay loop muted playsInline controls style={{ ...fitStyle, borderRadius: 12 }} />
    ) : (
      <img src={session.media?.previewUrl} alt="hasil" style={{ ...fitStyle, borderRadius: 12 }} />
    )
  ) : activeView === "live" && live ? (
    live.kind === "video"
      ? <video src={live.previewUrl} autoPlay loop muted playsInline style={fitStyle} />
      : <img src={live.previewUrl} alt="Live" style={fitStyle} />
  ) : activeView === "gif" && gif ? (
    <img src={gif.previewUrl} alt="GIF" style={fitStyle} />
  ) : finalImage ? (
    <img src={finalImage} alt="hasil akhir" style={fitStyle} />
  ) : (
    <p style={{ color: "#9CA3AF", fontSize: U(28), textAlign: "center" }}>Merender hasil...</p>
  );
  // Foto: kotak 437x565, tepat di tengah kartu (foto 2:3 persis seperti desain, 378x565); mode lain boleh lebih besar
  const box = portrait ? (isPhoto ? { x: 190, y: 230, w: 700, h: 800 } : { x: 180, y: 215, w: 720, h: 830 }) : shape === "square" ? (isPhoto ? { x: 60, y: 260, w: 390, h: 640 } : { x: 55, y: 250, w: 400, h: 660 }) : isPhoto ? { x: 215.5, y: 276, w: 437, h: 565 } : { x: 215, y: 207, w: 457, h: 703 };

  // Kartu hasil ikut bentuk template: template landscape -> kartu melebar, portrait -> kartu menjulang (posisi tengah desain dipertahankan)
  const card = { x: P(175.5, 150, 30), y: P(177.5, 190, 230), w: P(517, 780, 450), h: P(763, 880, 700) };
  const tpl = session.selectedTemplate;
  const ta = tpl?.canvasWidth && tpl?.canvasHeight ? tpl.canvasWidth / tpl.canvasHeight : null;
  let boxF = box, cardF = card;
  if (isPhoto && ta) {
    const k = ta >= box.w / box.h ? { w: box.w, h: box.w / ta } : { w: box.h * ta, h: box.h };
    boxF = { x: box.x + (box.w - k.w) / 2, y: box.y + (box.h - k.h) / 2, w: k.w, h: k.h };
    const padX = (card.w - box.w) / 2, padY = Math.min((card.h - box.h) / 2, padX);
    const w = k.w + padX * 2, h = k.h + padY * 2;
    cardF = { x: card.x + card.w / 2 - w / 2, y: card.y + card.h / 2 - h / 2, w, h };
  }

  return (
    <div className="kiosk-screen strip-screen h-full w-full overflow-hidden" data-shape={shape}>
      <div className="absolute inset-0"><SesiDecor /></div>

      <div className="strip-stage">
        {timeout > 0 && !hideQr && (
          <div className="pay-timer" role="timer" style={{ left: U(P(X(1322, 190), 445, 505)), top: U(P(140, 112, 190)), width: U(190), height: U(54), fontSize: U(32) }}>{mm}.{ss}</div>
        )}

        {/* Kartu hasil */}
        <div style={{ left: U(shape === "landscape" ? X(cardF.x, cardF.w) : cardF.x), top: U(cardF.y), width: U(cardF.w), height: U(cardF.h), background: "#fff", border: "3px solid #000", borderRadius: U(72.5), boxSizing: "border-box" }} />
        <div style={{ left: U(shape === "landscape" ? X(boxF.x, boxF.w) : boxF.x), top: U(boxF.y), width: U(boxF.w), height: U(boxF.h), display: "flex", alignItems: "center", justifyContent: "center" }}>
          {preview}
        </div>

        {/* Judul */}
        {sharing.showLabels && (
          <div className="pay-title" style={{ left: U(P(X(858, 675), 202, 262)), top: U(P(214, 36, 120)), width: U(675), height: U(69), fontSize: U(40) }}>SCAN HERE TO GET YOUR FILE</div>
        )}

        {/* Panel QR */}
        <div className="strip-panel" style={{ left: U(P(X(864, 648), 260, 520)), top: U(P(308, 1100, 290)), width: U(P(648, 560)), height: U(P(596, 520)) }} />
        <div className="strip-tray" style={{ left: U(P(X(882, 612), 276, 538)), top: U(P(326, 1116, 308)), width: U(P(612, 528)), height: U(P(560, 488)), borderRadius: U(85), display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
          {error ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: U(24), padding: `0 ${U(60)}` }}>
              <p style={{ margin: 0, fontWeight: 700, fontSize: U(30), color: "#B81C34" }}>{error}</p>
              <button onClick={() => setAttempt((n) => n + 1)} className="strip-btn" style={{ width: U(260), height: U(64), fontSize: U(30) }}>Coba lagi</button>
            </div>
          ) : hideQr ? (
            <p style={{ margin: 0, fontWeight: 800, fontStyle: "italic", fontSize: U(38), color: "#55606E", padding: `0 ${U(60)}` }}>Waktu download sudah berakhir</p>
          ) : qrUrl ? (
            <RoundedQR value={qrUrl} size={428} level="Q" rounded={sharing.qrStyle !== "square"} style={{ width: U(P(428, 380)), height: U(P(428, 380)) }} />
          ) : (
            <p style={{ margin: 0, fontSize: U(32), fontStyle: "italic", color: "#55606E" }}>Menyiapkan file...</p>
          )}
        </div>

        {/* Tombol tampilan: Foto | Live | GIF (muncul sesuai yang tersedia) */}
        {isPhoto && views.length > 1 && (() => {
          const w = 150 * views.length, seg = 100 / views.length, idx = views.findIndex(([id]) => id === activeView);
          return (
            <div style={{ left: U(P(X(864, w), 260, 520)), top: U(P(930, 1660, 910)), width: U(w), height: U(64), borderRadius: U(32), background: "#DBDBDB", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, height: "100%", width: `${seg}%`, left: `${idx * seg}%`, borderRadius: U(32), background: "#E02843", transition: "left .2s ease" }} />
              {views.map(([id, label], i) => (
                <button key={id} type="button" onClick={() => { picked.current = true; setView(id); }}
                  style={{ position: "absolute", top: 0, height: "100%", left: `${i * seg}%`, width: `${seg}%`, background: "transparent", border: 0, padding: 0, color: "#fff", fontStyle: "italic", fontWeight: 800, fontSize: U(30), display: "flex", alignItems: "center", justifyContent: "center", gap: U(8) }}>{React.createElement(ICONS[id], { "aria-hidden": true, strokeWidth: 2.2, style: { width: U(30), height: U(30) } })}{label}</button>
              ))}
            </div>
          );
        })()}

        {animating && (
          <p style={{ left: U(P(X(864, 340), 260, 520)), top: U(P(1004, 1738, 990)), margin: 0, fontSize: U(P(24, 22)), fontStyle: "italic", color: "#55606E", width: U(P(648, 560)) }}>Membuat video Live & GIF… QR sudah bisa dipindai, file menyusul di halaman unduh.</p>
        )}

        {/* Done */}
        {!sharing.hideDone && (
          <button type="button" className="strip-btn" onClick={() => dispatch({ type: "DONE" })}
            style={{ left: U(P(X(1332, 180), 640, 988)), top: U(P(930, 1660, 910)), width: U(180), height: U(64), fontSize: U(36) }}>DONE</button>
        )}
      </div>
    </div>
  );
}
