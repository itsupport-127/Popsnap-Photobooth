import useShape from "../hooks/useShape";
import React, { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import appConfig from "../config/appConfig";
import useCountdown from "../hooks/useCountdown";
import { createQrisPayment, checkPaymentStatus, validateVoucher } from "../services/paymentService";
import { getPublicSettings } from "../services/settingsService";
import OnScreenKeyboard from "../components/OnScreenKeyboard";
import useCodeEntry, { extractCode } from "../hooks/useCodeEntry";
import StepBadge from "../components/StepBadge";
import TemplateDecor from "../components/TemplateDecor";
import { PAYMENT_ICONS } from "../components/paymentIcons";
import logo from "../assets/logo-popsnap.png";

/**
 * Tahap 4: Pembayaran (QRIS / voucher), batas waktu 45 detik.
 *
 * QRIS: generate kode QRIS dinamis (stub sekarang, nanti disambung Midtrans),
 *       lalu poll status pembayaran.
 * Voucher: kasir kasih kode ke konsumen, konsumen input manual, divalidasi
 *          ke database lokal (bisa offline).
 */
export default function PaymentScreen({ session, dispatch }) {
  const [voucherInput, setVoucherInput] = useState("");
  const [voucherError, setVoucherError] = useState(null);
  const [qrisData, setQrisData] = useState(null);
  const [qrisError, setQrisError] = useState(null);
  const [methods, setMethods] = useState(null); // null = lagi memeriksa; ["voucher"] / ["qris"] / ["voucher","qris"]
  const pollIntervalRef = useRef(null);
  const autoPickedRef = useRef(false);

  // Cek metode bayar yang AKTIF saat ini (internet mati -> QRIS otomatis hilang, tinggal voucher)
  useEffect(() => {
    let cancelled = false;
    getPublicSettings()
      .then((s) => !cancelled && setMethods(s.payment.methods))
      .catch(() => !cancelled && setMethods(["voucher"]));
    return () => { cancelled = true; };
  }, []);

  // Cuma 1 metode aktif -> langsung dipilih, konsumen gak perlu klik apa-apa lagi
  useEffect(() => {
    if (!methods || methods.length !== 1 || session.paymentMethod || autoPickedRef.current) return;
    autoPickedRef.current = true;
    if (methods[0] === "qris") handleSelectQris();
    else dispatch({ type: "SELECT_PAYMENT_METHOD", payload: { method: "voucher" } });
  }, [methods, session.paymentMethod]);

  // Mode foto: kembali ke pilih template (kecuali template sudah ditentukan admin). Mode lain: batalkan sesi.
  const goBack = () => dispatch({ type: session.mode === "photo" && !session.autoTemplate ? "BACK_TO_TEMPLATE_SELECT" : "CANCEL_SESSION" });
  const kbMode = appConfig.settings?.general?.virtualKeyboard ?? "off"; // off | builtin | windows
  const useKeyboard = kbMode === "builtin";
  const voucherInputRef = useRef(null);
  const price = session.mode === "photo" ? session.selectedTemplate?.price : session.price;
  const MODE_NAME = { photo: "Foto", gif: "GIF", boomerang: "Boomerang", video: "Video" };

  // QRIS lunas: tampilkan "Payment successful" sebentar sebelum lanjut; hitung mundur dihentikan supaya tidak kedaluwarsa di jeda ini
  const [qrisPaid, setQrisPaid] = useState(false);
  const paidTimerRef = useRef(null);
  const { remaining } = useCountdown(
    appConfig.timers.payment,
    () => dispatch({ type: "PAYMENT_EXPIRED" }),
    session.paymentStatus !== "paid" && !qrisPaid
  );

  // Pastikan polling BERHENTI kalau komponen ini di-unmount (misal konsumen
  // klik Back di tengah proses QRIS) — supaya gak ada dispatch "PAYMENT_SUCCESS"
  // nyasar setelah user udah pindah layar.
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (paidTimerRef.current) clearTimeout(paidTimerRef.current);
    };
  }, []);

  async function handleSelectQris() {
    dispatch({ type: "SELECT_PAYMENT_METHOD", payload: { method: "qris" } });
    setQrisError(null);
    setQrisData(null);
    try {
      const payment = await createQrisPayment({ templateId: session.selectedTemplate?.id, mode: session.mode });
      setQrisData(payment);
      pollPayment(payment.orderId);
    } catch (err) {
      setQrisError(err.message);
    }
  }

  function pollPayment(orderId) {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      const status = await checkPaymentStatus(orderId);
      if (status === "paid") {
        clearInterval(pollIntervalRef.current);
        setQrisPaid(true);
        paidTimerRef.current = setTimeout(() => dispatch({ type: "PAYMENT_SUCCESS", payload: { sessionId: orderId } }), 2200);
      }
    }, 2000);
  }

  // Keyboard fisik langsung mengisi kode tanpa klik kolom isian (berlaku di semua mode keyboard)
  useCodeEntry({
    active: session.paymentMethod === "voucher",
    setValue: (fn) => { setVoucherInput(fn); setVoucherError(null); },
    maxLength: 12,
    onSubmit: () => handleVoucherSubmit(),
    inputRef: voucherInputRef,
  });

  // Tombol "Tempel" untuk layar sentuh (tanpa Ctrl+V): baca clipboard lalu isi kolom
  const [pasteMsg, setPasteMsg] = useState(null);
  async function pasteFromClipboard() {
    setPasteMsg(null);
    try {
      const code = extractCode(await navigator.clipboard.readText(), 12);
      if (!code) return setPasteMsg("Clipboard kosong.");
      setVoucherInput(code);
      setVoucherError(null);
    } catch {
      setPasteMsg("Tidak bisa membaca clipboard. Tekan Ctrl+V di keyboard.");
    }
  }

  // Mode "keyboard Windows": buka keyboard sentuh Windows (aplikasi desktop) begitu kolom kode tampil
  useEffect(() => {
    if (kbMode === "windows" && session.paymentMethod === "voucher") window.electronAPI?.kiosk?.showTouchKeyboard?.();
  }, [kbMode, session.paymentMethod]);

  async function handleVoucherSubmit() {
    if (!voucherInput.trim()) return setVoucherError("Masukkan kode voucher dulu.");
    const result = await validateVoucher(voucherInput, { templateId: session.selectedTemplate?.id, mode: session.mode });
    if (result.valid) {
      dispatch({ type: "PAYMENT_SUCCESS", payload: { sessionId: result.orderNo || `VCH-${voucherInput}` } });
    } else {
      setVoucherError(result.reason || "Kode voucher tidak valid.");
    }
  }

  if (session.paymentStatus === "expired") {
    return (
      <div className="kiosk-screen h-full w-full flex flex-col items-center justify-center gap-4 sm:gap-6 p-4 text-center">
        <p className="display-h2">Waktu pembayaran habis</p>
        <button
          onClick={goBack}
          className="btn-pop btn-flash px-8 sm:px-10 py-3 sm:py-4 text-base sm:text-lg"
        >
          {session.mode === "photo" && !session.autoTemplate ? "Kembali Pilih Template" : "Kembali ke Awal"}
        </button>
      </div>
    );
  }

  // Dua metode aktif -> layar pilih metode (desain "Payment"). Satu metode = langsung ke langkah berikutnya (tanpa layar ini).
  if (!session.paymentMethod && methods?.length > 1) {
    return (
      <PaymentSelect
        priceText={price > 0 ? `${MODE_NAME[session.mode]} · Rp ${Number(price).toLocaleString("id-ID")}` : null}
        remaining={remaining}
        onBack={goBack}
        onQr={handleSelectQris}
        onVoucher={() => dispatch({ type: "SELECT_PAYMENT_METHOD", payload: { method: "voucher" } })}
      />
    );
  }

  if (session.paymentMethod === "qris") {
    return (
      <PaymentQr
        qrisData={qrisData}
        qrisError={qrisError}
        paid={qrisPaid}
        remaining={remaining}
        onBack={goBack}
        onRetry={handleSelectQris}
        onUseVoucher={methods?.includes("voucher") ? () => dispatch({ type: "SELECT_PAYMENT_METHOD", payload: { method: "voucher" } }) : null}
      />
    );
  }

  if (session.paymentMethod === "voucher") {
    return (
      <PaymentVoucher
        value={voucherInput}
        onChange={(v) => { setVoucherInput(v); setVoucherError(null); }}
        error={voucherError}
        onSubmit={handleVoucherSubmit}
        onBack={goBack}
        remaining={remaining}
        inputRef={voucherInputRef}
        useKeyboard={useKeyboard}
        kbMode={kbMode}
        onPaste={pasteFromClipboard}
        pasteMsg={pasteMsg}
      />
    );
  }

  // Menunggu daftar metode pembayaran dari backend
  return (
    <div className="kiosk-screen h-full w-full flex items-center justify-center">
      <TemplateDecor />
      <p className="relative z-10 text-white/90 font-bold italic text-lg">Memeriksa metode pembayaran...</p>
    </div>
  );
}

// Satuan desain: 1 = 1px pada kanvas 1728x1117 (lihat .strip-screen di index.css)
const U = (n) => `calc(var(--u) * ${n})`;

function PaymentSelect({ priceText, remaining, onBack, onQr, onVoucher }) {
  const shape = useShape();
  const portrait = shape === "portrait";
  const k = portrait ? 1.13 : 1; // kartu metode lebih besar di layar tegak
  const cards = [
    { key: "qr", label: "QR", icon: PAYMENT_ICONS.qr, left: { portrait: 105, square: 181, landscape: 422 }[shape], onClick: onQr },
    { key: "voucher", label: "Voucher", icon: PAYMENT_ICONS.voucher, left: { portrait: 545, square: 640, landscape: 909 }[shape], onClick: onVoucher },
  ];
  const L = shape === "square"
    ? { logo: { left: 470, top: 70, width: 260 }, title: { left: 200, top: 250, width: 800, fs: 56 }, price: { left: 200, top: 360, width: 800 }, cardTop: 470, back: { left: 70, top: 1100 } }
    : portrait
    ? { logo: { left: 410, top: 90, width: 260 }, title: { left: 90, top: 400, width: 900, fs: 60 }, price: { left: 90, top: 512, width: 900 }, cardTop: 640, back: { left: 78, top: 1630 } }
    : { logo: { left: 129, top: 98, width: 212 }, title: { left: 481, top: 213, width: 767, fs: 64 }, price: { left: 481, top: 322, width: 767 }, cardTop: 392, back: { left: 134, top: 955 } };
  return (
    <div className="kiosk-screen strip-screen h-full w-full overflow-hidden" data-shape={shape}>
      <TemplateDecor />
      <StepBadge step={4} time={`${remaining}s`} />
      <div className="strip-stage">
        <img src={logo} alt="PopSnap" draggable={false} className="strip-logo" style={{ left: U(L.logo.left), top: U(L.logo.top), width: U(L.logo.width) }} />

        <h2 className="pay-title" style={{ left: U(L.title.left), top: U(L.title.top), width: U(L.title.width), height: U(96), fontSize: U(L.title.fs) }}>Select your payment</h2>
        {priceText && <p className="pay-price" style={{ left: U(L.price.left), top: U(L.price.top), width: U(L.price.width), fontSize: U(30) }}>{priceText}</p>}

        {cards.map((c) => (
          <button key={c.key} onClick={c.onClick} className="pay-card" style={{ left: U(c.left), top: U(L.cardTop), width: U(379 * k), height: U(518 * k), borderRadius: U(71 * k) }}>
            <svg className="pay-card__icon" viewBox="0 0 379 518" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: c.icon }} />
            <span className="pay-card__label" style={{ left: U(32 * k), bottom: U(28.7 * k), width: U(318.3 * k), height: U(64.2 * k), fontSize: U(41 * k) }}>{c.label}</span>
          </button>
        ))}

        <button onClick={onBack} className="strip-btn" style={{ left: U(L.back.left), top: U(L.back.top), width: U(192), height: U(63), fontSize: U(30) }}>BACK</button>
      </div>
    </div>
  );
}

const fmtTimer = (sec) => `${String(Math.floor(sec / 60)).padStart(2, "0")}.${String(sec % 60).padStart(2, "0")}`; // 45 -> "00.45"

/** Bingkai bersama layar QR & voucher: logo, pil judul, panel kuning + baki putih, pil hitung mundur. Isi baki = children. */
function PayFrame({ title, titleBox, panel, tray, trayRadius, timerPos, remaining, onBack, children, below, glow = true, shape = "landscape" }) {
  const logoPos = { portrait: { left: 410, top: 90, width: 260 }, square: { left: 470, top: 60, width: 260 }, landscape: { left: 129, top: 98, width: 212 } }[shape];
  const backPos = { portrait: { left: 78, top: 1630 }, square: { left: 70, top: 1100 }, landscape: { left: 134, top: 955 } }[shape];
  return (
    <div className="kiosk-screen strip-screen h-full w-full overflow-hidden" data-shape={shape}>
      <TemplateDecor glow={glow} />
      <div className="strip-stage">
        <img src={logo} alt="PopSnap" draggable={false} className="strip-logo" style={{ left: U(logoPos.left), top: U(logoPos.top), width: U(logoPos.width) }} />
        <h2 className="pay-title" style={{ left: U(titleBox.left), top: U(titleBox.top), width: U(titleBox.w), height: U(titleBox.h), fontSize: U(titleBox.fs) }}>{title}</h2>

        <div className="strip-panel" style={{ left: U(panel.left), top: U(panel.top), width: U(panel.w), height: U(panel.h) }} />
        <div className="strip-tray" style={{ left: U(tray.left), top: U(tray.top), width: U(tray.w), height: U(tray.h), borderRadius: U(trayRadius) }}>{children}</div>

        {below}
        <div className="pay-timer" role="timer" style={{ left: U(timerPos.left), top: U(timerPos.top), width: U(161), height: U(56), fontSize: U(40) }}>{fmtTimer(remaining)}</div>
        {onBack && <button onClick={onBack} className="strip-btn" style={{ left: U(backPos.left), top: U(backPos.top), width: U(192), height: U(63), fontSize: U(30) }}>BACK</button>}
      </div>
    </div>
  );
}

// Layar "Scan Here" (QRIS) + keadaan "Payment successful" setelah lunas
function PaymentQr({ qrisData, qrisError, paid, remaining, onBack, onRetry, onUseVoucher }) {
  const shape = useShape();
  const portrait = shape === "portrait";
  const P = shape === "square"
    ? { titleBox: { left: 386, top: 190, w: 427, h: 96, fs: 64 }, panel: { left: 276, top: 320, w: 648, h: 596 }, tray: { left: 294, top: 338, w: 612, h: 560 }, timerPos: { left: 520, top: 940 }, amount: { left: 276, top: 1010 } }
    : portrait
    ? { titleBox: { left: 327, top: 430, w: 427, h: 96, fs: 64 }, panel: { left: 216, top: 544, w: 648, h: 596 }, tray: { left: 234, top: 562, w: 612, h: 560 }, timerPos: { left: 460, top: 1170 }, amount: { left: 216, top: 1250 } }
    : { titleBox: { left: 651, top: 162, w: 427, h: 96, fs: 64 }, panel: { left: 540, top: 276, w: 648, h: 596 }, tray: { left: 558, top: 294, w: 612, h: 560 }, timerPos: { left: 784, top: 900 }, amount: { left: 540, top: 968 } };
  return (
    <PayFrame
      shape={shape}
      title="Scan Here"
      titleBox={P.titleBox}
      panel={P.panel}
      tray={P.tray}
      trayRadius={85}
      timerPos={P.timerPos}
      remaining={remaining}
      onBack={paid ? null : onBack}
      below={!paid && qrisData?.amount > 0 ? <p className="pay-amount" style={{ left: U(P.amount.left), width: U(648), top: U(P.amount.top), fontSize: U(34) }}>Rp {qrisData.amount.toLocaleString("id-ID")}</p> : null}
    >
      {paid ? (
        <>
          <p className="absolute left-0 right-0 text-center font-extrabold italic text-black" style={{ top: U(52), fontSize: U(58), lineHeight: `${U(66)}` }}>Payment<br />successful</p>
          <svg className="absolute" viewBox="0 0 280 280" fill="none" aria-hidden="true" style={{ left: U(166), top: U(222), width: U(280), height: U(280) }}>
            <circle cx="140" cy="140" r="124" fill="#36B27E" stroke="#000" strokeWidth="3" />
            <path d="M84 146 L124 186 L198 100" stroke="#fff" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </>
      ) : qrisError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center" style={{ padding: `0 ${U(60)}`, gap: U(22) }}>
          <p className="font-bold text-[#E02843]" style={{ fontSize: U(32) }}>{qrisError}</p>
          <div className="flex" style={{ gap: U(16) }}>
            <button onClick={onRetry} className="strip-btn" style={{ width: U(180), height: U(60), fontSize: U(28), position: "static" }}>Coba lagi</button>
            {onUseVoucher && <button onClick={onUseVoucher} className="strip-btn strip-btn--next" style={{ width: U(220), height: U(60), fontSize: U(28), position: "static" }}>Pakai voucher</button>}
          </div>
        </div>
      ) : qrisData ? (
        <div className="absolute flex items-center justify-center" style={{ left: U(92), top: U(66), width: U(428), height: U(428) }}>
          {qrisData.qrImageUrl ? (
            // Mode ASLI: Midtrans sudah kasih gambar QR jadi, tinggal tampilkan
            <img src={qrisData.qrImageUrl} alt="QRIS" className="w-full h-full object-contain" draggable={false} />
          ) : (
            // Mode SIMULASI: generate QR dari string dummy
            <QRCodeSVG value={qrisData.qrString} className="w-full h-full" />
          )}
        </div>
      ) : (
        <p className="absolute inset-0 flex items-center justify-center italic font-bold text-[#55606E]" style={{ fontSize: U(34) }}>Menyiapkan QRIS...</p>
      )}
    </PayFrame>
  );
}

// Layar "Input your voucher here"
function PaymentVoucher({ value, onChange, error, onSubmit, onBack, remaining, inputRef, useKeyboard, kbMode, onPaste, pasteMsg }) {
  const showWinKb = kbMode === "windows" && window.electronAPI?.kiosk?.showTouchKeyboard;
  const shape = useShape();
  const portrait = shape === "portrait";
  const V = shape === "square"
    ? { titleBox: { left: 335, top: 330, w: 530, h: 67, fs: 36 }, panel: { left: 150, top: 420, w: 900, h: 208 }, tray: { left: 170, top: 438, w: 860, h: 172 }, timerPos: { left: 980, top: 60 },
        next: { left: 960, top: 1090 }, paste: { left: 380, top: 655 }, kbBtn: { left: 570, top: 655 }, err: { left: 150, width: 900, top: 705 }, kb: { left: 150, top: 760, width: 900 }, kbSize: { keyW: 80, keyH: 70, keyGap: 10, keyFs: 30, keyR: 14 } }
    : portrait
    ? { titleBox: { left: 275, top: 640, w: 530, h: 67, fs: 36 }, panel: { left: 90, top: 730, w: 900, h: 208 }, tray: { left: 110, top: 748, w: 860, h: 172 }, timerPos: { left: 880, top: 120 },
        next: { left: 810, top: 1630 }, paste: { left: 330, top: 965 }, kbBtn: { left: 520, top: 965 }, err: { left: 90, width: 900, top: 1015 }, kb: { left: 90, top: 1070, width: 900 }, kbSize: { keyW: 80, keyH: 84, keyGap: 10, keyFs: 34, keyR: 14 } }
    : { titleBox: { left: 600, top: 342, w: 529, h: 67, fs: 36 }, panel: { left: 440, top: 438, w: 848, h: 208 }, tray: { left: 460, top: 456, w: 808, h: 172 }, timerPos: { left: 1455, top: 127 },
        next: { left: 1434, top: 968 }, paste: { left: 793, top: 680 }, kbBtn: { left: 952, top: 680 }, err: { left: 440, width: 848, top: 722 }, kb: { left: 452, top: 765, width: 830 }, kbSize: { keyW: 74.5, keyH: 50, keyGap: 9.3, keyFs: 26, keyR: 12 } };
  // Tombol Tempel (+ Keyboard Windows bila ada) dipusatkan terhadap panel input, di semua bentuk layar
  const btnW = showWinKb ? 141 + 20 + 180 : 141;
  const pasteLeft = V.panel.left + V.panel.w / 2 - btnW / 2;
  return (
    <PayFrame
      shape={shape}
      glow={false}
      title="Input your voucher here"
      titleBox={V.titleBox}
      panel={V.panel}
      tray={V.tray}
      trayRadius={39}
      timerPos={V.timerPos}
      remaining={remaining}
      onBack={onBack}
      below={
        <>
          <button onClick={onSubmit} className="strip-btn" style={{ left: U(V.next.left), top: U(V.next.top), width: U(179), height: U(62), fontSize: U(30) }}>NEXT</button>
          <button onClick={onPaste} className="pay-mini" style={{ left: U(pasteLeft), top: U(V.paste.top), width: U(141), height: U(38), fontSize: U(22) }}>📋 Tempel</button>
          {showWinKb && <button onClick={() => window.electronAPI.kiosk.showTouchKeyboard()} className="pay-mini" style={{ left: U(pasteLeft + 161), top: U(V.kbBtn.top), width: U(180), height: U(38), fontSize: U(22) }}>⌨ Keyboard</button>}
          {(error || pasteMsg) && <p className="pay-error" style={{ left: U(V.err.left), width: U(V.err.width), top: U(V.err.top), fontSize: U(26) }}>{error || pasteMsg}</p>}
          {useKeyboard && <div style={{ left: U(V.kb.left), top: U(V.kb.top), width: U(V.kb.width) }}><OnScreenKeyboard scaled {...V.kbSize} value={value} maxLength={12} onChange={onChange} /></div>}
        </>
      }
    >
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <input
          ref={inputRef}
          type="text"
          aria-label="Kode voucher"
          maxLength={12}
          autoFocus={!useKeyboard}
          readOnly={useKeyboard}
          inputMode={useKeyboard ? "none" : undefined}
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          autoCapitalize="characters" autoComplete="off"
          className="pay-input"
          style={{ fontSize: U(84), ...(useKeyboard ? { color: "transparent" } : null) }}
        />
        {/* Keyboard layar: kolom hanya-baca tidak punya kursor bawaan, jadi digambar kursor berkedip sendiri */}
        {useKeyboard && (
          <div className="pay-fake-input" aria-hidden="true" style={{ fontSize: U(84) }}>
            <span>{value}</span><i className="pay-caret" />
          </div>
        )}
      </div>
    </PayFrame>
  );
}
