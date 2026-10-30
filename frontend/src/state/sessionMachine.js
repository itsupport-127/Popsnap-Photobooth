// ==========================================================
// POPSNAP — Session State Machine
//
// Ini "otak" alur aplikasi. Setiap tahap di flow kamu jadi satu
// STATE. Pindah antar state hanya boleh lewat action yang
// didefinisikan di bawah — supaya tidak ada kondisi ilegal
// (misal: masuk ke sesi foto tanpa bayar dulu).
//
// STATES:
//  WELCOME            -> halaman awal, tombol start
//  TEMPLATE_CATEGORY   -> pilih salah satu dari 4 kelompok
//  TEMPLATE_SELECT      -> pilih template di dalam kelompok
//  PAYMENT              -> qris / voucher, timer 45s
//  PHOTO_SESSION         -> 8x take, max 5 retake, timer 4 menit
//  EDITOR                -> pilih foto masuk template, filter, stiker, timer 3 menit
//  RESULT                -> live view + QR download, timer 2 menit
//  DONE                  -> kembali ke WELCOME
// ==========================================================

import appConfig from "../config/appConfig";
import { photoSlotPlan } from "../utils/templatePhotos";

export const STATES = {
  WELCOME: "WELCOME",
  DISCLAIMER: "DISCLAIMER",       // persetujuan ketentuan (opsional, Admin > Umum)
  TEMPLATE_CATEGORY: "TEMPLATE_CATEGORY",
  TEMPLATE_SELECT: "TEMPLATE_SELECT",
  PAYMENT: "PAYMENT",
  CONSENT: "CONSENT",             // izin dipakai di sosmed (opsional, Admin > Umum), setelah bayar & sebelum pengumuman
  REMINDER: "REMINDER",           // layar pengingat setelah bayar, sebelum sesi (Admin > Tampilan)
  PHOTO_SESSION: "PHOTO_SESSION",
  MEDIA_CAPTURE: "MEDIA_CAPTURE", // sesi GIF / Boomerang / Video
  EDITOR: "EDITOR",
  RESULT: "RESULT",
};

export function createInitialSession() {
  return {
    state: STATES.WELCOME,
    mode: "photo",          // photo | gif | boomerang | video
    price: 0,               // harga mode non-foto (mode foto: harga template)
    autoTemplate: false,    // true = template sudah ditentukan admin (Tampilan > Template: satu template saja)
    uploadKey: null,        // kunci unggah GIF tambahan untuk sesi foto
    media: null,            // hasil mode GIF/Boomerang/Video: { kind, previewUrl }
    selectedCategory: null,
    selectedTemplate: null,
    paymentMethod: null,
    paymentStatus: "idle", // idle | pending | paid | expired
    voucherCode: null,
    shots: [],            // array of captured photo dataURLs/paths
    shotIndex: 0,          // 0..totalShots
    retakesUsed: 0,
    retakeAt: null,
    photosForTemplate: [], // final chosen photos for the template slots
    editorState: {
      filter: "none",
      mirror: false,
      stickers: [],
    },
    orientation: "portrait", // portrait | landscape
    sessionId: null,
    downloadUrl: null,
  };
}

const cfgNow = () => appConfig.settings ?? {};

/** Setelah pembayaran: tampilkan layar pengingat dulu (kalau diaktifkan), baru sesi. */
function nextAfterConsent(mode) {
  if (cfgNow().display?.reminder?.enabled) return STATES.REMINDER;
  return mode === "photo" ? STATES.PHOTO_SESSION : STATES.MEDIA_CAPTURE;
}
function nextAfterPayment(mode) {
  if (cfgNow().general?.consent?.enabled) return STATES.CONSENT; // tanya izin sosmed dulu
  if (cfgNow().display?.reminder?.enabled) return STATES.REMINDER;
  return mode === "photo" ? STATES.PHOTO_SESSION : STATES.MEDIA_CAPTURE;
}

/** Masuk alur sesuai mode: foto -> pilih template / bayar; mode lain -> bayar (atau langsung jalan kalau gratis). */
function enterFlow(s) {
  if (s.mode === "photo") {
    return s.selectedTemplate ? { ...s, state: STATES.PAYMENT, paymentStatus: "idle" } : { ...s, state: STATES.TEMPLATE_CATEGORY };
  }
  if (s.price > 0) return { ...s, state: STATES.PAYMENT, paymentStatus: "idle" };
  return { ...s, paymentMethod: "free", paymentStatus: "paid", sessionId: crypto.randomUUID(), state: nextAfterPayment(s.mode) };
}

// Reducer-style transition function.
// action: { type: string, payload?: any }
/** Daftar slot foto template (panjang = jumlah nomor foto berbeda), diisi null untuk slot kosong. */
function templateSlots(session) {
  const n = Math.max(session.selectedTemplate?.layers ? photoSlotPlan(session.selectedTemplate.layers).count : 1, 1);
  return Array.from({ length: n }, (_, i) => session.photosForTemplate[i] ?? null);
}

export function sessionReducer(session, action) {
  switch (action.type) {
    // ---------- WELCOME ----------
    case "START": {
      const { mode = "photo", template = null } = action.payload ?? {};
      const cfg = appConfig.settings ?? {};
      const base = {
        ...createInitialSession(),
        mode,
        selectedTemplate: template,
        autoTemplate: !!template,
        orientation: template && template.canvasWidth > template.canvasHeight ? "landscape" : "portrait",
        price: mode === "photo" ? 0 : cfg.general?.modes?.[mode]?.price ?? 0,
      };
      // Pilihan awal Mirror/No Mirror untuk sesi foto mengikuti Admin > Kamera > Mirror Image (tamu bisa mengubahnya)
      base.editorState = { ...base.editorState, mirror: !!cfg.camera?.liveView?.mirror };
      if (cfg.general?.disclaimer?.enabled) return { ...base, state: STATES.DISCLAIMER };
      return enterFlow(base);
    }
    case "DISCLAIMER_ACCEPT": return enterFlow(session);
    case "DISCLAIMER_DECLINE":
    case "CANCEL_SESSION": return createInitialSession();
    case "MERGE": return { ...session, ...action.payload }; // pembaruan data internal (mis. kunci unggah)

    // ---------- TEMPLATE_CATEGORY ----------
    case "SELECT_CATEGORY": {
      return {
        ...session,
        selectedCategory: action.payload.categoryId,
        state: STATES.TEMPLATE_SELECT,
      };
    }

    // ---------- TEMPLATE_SELECT ----------
    case "SELECT_TEMPLATE": {
      const tpl = action.payload.template;
      // Orientasi otomatis ikut bentuk template: lebih lebar dari tinggi -> landscape,
      // selain itu -> portrait. Ini yang bikin fitur portrait/landscape ACTUALLY
      // kepakai (sebelumnya action SET_ORIENTATION ada tapi gak pernah dipanggil
      // dari mana pun, jadi orientasi macet di "portrait" terus).
      const orientation = tpl?.canvasWidth > tpl?.canvasHeight ? "landscape" : "portrait";
      return {
        ...session,
        selectedTemplate: tpl,
        orientation,
      };
    }
    case "BACK_TO_CATEGORY": {
      return {
        ...session,
        selectedCategory: null, // WAJIB direset, TemplateScreen nentuin tampilan dari field ini
        selectedTemplate: null,
        state: STATES.TEMPLATE_CATEGORY,
      };
    }
    case "GO_TO_PAYMENT": {
      if (!session.selectedTemplate) return session; // guard: harus pilih template dulu
      return {
        ...session,
        state: STATES.PAYMENT,
        paymentStatus: "idle",
      };
    }

    // ---------- PAYMENT ----------
    case "SELECT_PAYMENT_METHOD": {
      return {
        ...session,
        paymentMethod: action.payload.method,
        paymentStatus: "pending",
      };
    }
    case "PAYMENT_SUCCESS": {
      return {
        ...session,
        paymentStatus: "paid",
        state: nextAfterPayment(session.mode),
        sessionId: action.payload?.sessionId ?? crypto.randomUUID(),
      };
    }
    case "PAYMENT_EXPIRED": {
      return { ...session, paymentStatus: "expired" };
    }
    case "BACK_TO_TEMPLATE_SELECT": {
      return {
        ...session,
        paymentMethod: null,
        paymentStatus: "idle",
        state: STATES.TEMPLATE_SELECT,
      };
    }

    // ---------- CONSENT (izin sosmed) ----------
    case "CONSENT_DONE": return { ...session, socialConsent: Number.isInteger(action.payload?.consent) ? action.payload.consent : null, state: nextAfterConsent(session.mode) };

    // ---------- REMINDER ----------
    case "REMINDER_DONE": {
      return { ...session, state: session.mode === "photo" ? STATES.PHOTO_SESSION : STATES.MEDIA_CAPTURE };
    }

    // ---------- MEDIA_CAPTURE (GIF / Boomerang / Video) ----------
    case "MEDIA_DONE": {
      const { url, previewUrl, kind, sessionId, uploadKey } = action.payload;
      return { ...session, state: STATES.RESULT, downloadUrl: url, sessionId: sessionId ?? session.sessionId, uploadKey: uploadKey ?? null, media: { kind, previewUrl } };
    }

    // ---------- PHOTO_SESSION ----------
    case "CAPTURE_SHOT": {
      // Foto hasil retake dimasukkan di POSISI yang sama dengan yang diulang; foto biasa ditambah di akhir.
      // Pindah ke editor tidak lagi otomatis di foto terakhir: layar sesi foto menampilkan pratinjau semua foto
      // (supaya bisa retake yang mana saja) lalu mengirim FORCE_TO_EDITOR.
      const at = session.retakeAt;
      const shots = at != null && at <= session.shots.length
        ? [...session.shots.slice(0, at), action.payload.photo, ...session.shots.slice(at)]
        : [...session.shots, action.payload.photo];
      return {
        ...session,
        shots,
        shotIndex: session.shotIndex + 1,
        retakeAt: null,
      };
    }
    case "RETAKE_SHOT": {
      // Removes the last shot at given index and decrements progress,
      // consuming one retake credit. Guarded by caller against maxRetakes.
      const shots = session.shots.filter((_, i) => i !== action.payload.index);
      return {
        ...session,
        shots,
        shotIndex: Math.max(0, session.shotIndex - 1),
        retakesUsed: session.retakesUsed + 1,
        retakeAt: action.payload.index, // foto baru nanti menggantikan posisi ini
      };
    }
    case "PHOTO_SESSION_TIMEOUT_EXTEND": {
      // handled by UI popup; just a marker action for logging/analytics
      return { ...session };
    }
    case "FORCE_TO_EDITOR": {
      return { ...session, state: STATES.EDITOR };
    }

    // ---------- EDITOR ----------
    // photosForTemplate = daftar per SLOT (nomor foto template): isinya indeks foto di `shots`, atau null kalau slot kosong.
    case "TOGGLE_PHOTO_FOR_TEMPLATE": {
      // Foto sudah ada di bingkai -> dilepas; belum -> mengisi slot kosong PERTAMA (sama seperti ketuk di daftar)
      const arr = templateSlots(session);
      const at = arr.indexOf(action.payload.shotIndex);
      if (at >= 0) { arr[at] = null; return { ...session, photosForTemplate: arr }; }
      const free = arr.indexOf(null);
      if (free < 0) return session;
      arr[free] = action.payload.shotIndex;
      return { ...session, photosForTemplate: arr };
    }
    case "ASSIGN_PHOTO": {
      // Taruh foto di slot tertentu. Slot sudah terisi: foto lamanya kembali ke daftar,
      // kecuali foto yang ditaruh berasal dari slot lain -> kedua slot saling TUKAR.
      const { slot, shot } = action.payload;
      const arr = templateSlots(session);
      if (slot < 0 || slot >= arr.length) return session;
      const from = arr.indexOf(shot);
      if (from === slot) return session;
      const old = arr[slot];
      arr[slot] = shot;
      if (from >= 0) arr[from] = old;
      return { ...session, photosForTemplate: arr };
    }
    case "REMOVE_PHOTO_FROM_TEMPLATE": {
      // Kosongkan 1 slot (lewat nomor slot, atau lewat indeks foto)
      const arr = templateSlots(session);
      const at = action.payload.slot ?? arr.indexOf(action.payload.shotIndex);
      if (at >= 0 && at < arr.length) arr[at] = null;
      return { ...session, photosForTemplate: arr };
    }
    case "SET_MIRROR": {
      return { ...session, editorState: { ...session.editorState, mirror: !!action.payload.mirror } };
    }
    case "SET_FILTER": {
      return {
        ...session,
        editorState: { ...session.editorState, filter: action.payload.filter },
      };
    }
    case "TOGGLE_MIRROR": {
      return {
        ...session,
        editorState: { ...session.editorState, mirror: !session.editorState.mirror },
      };
    }
    // Stiker = { id, src, ar, x, y, w, rot }: x,y = titik tengah (% dari lebar/tinggi kanvas), w = lebar (% lebar kanvas), rot = derajat
    case "ADD_STICKER": {
      return { ...session, editorState: { ...session.editorState, stickers: [...session.editorState.stickers, action.payload.sticker] } };
    }
    case "UPDATE_STICKER": {
      return {
        ...session,
        editorState: { ...session.editorState, stickers: session.editorState.stickers.map((st) => (st.id === action.payload.id ? { ...st, ...action.payload.patch } : st)) },
      };
    }
    case "REMOVE_STICKER": {
      return { ...session, editorState: { ...session.editorState, stickers: session.editorState.stickers.filter((st) => st.id !== action.payload.id) } };
    }
    case "FINISH_EDITOR": {
      return { ...session, state: STATES.RESULT };
    }

    // ---------- RESULT ----------
    case "SET_DOWNLOAD_URL": {
      return { ...session, downloadUrl: action.payload.url };
    }
    case "DONE": {
      return createInitialSession();
    }

    // ---------- ORIENTATION ----------
    case "SET_ORIENTATION": {
      return { ...session, orientation: action.payload.orientation };
    }

    default:
      return session;
  }
}
