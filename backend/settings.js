// ==========================================================
// Pengaturan aplikasi (disimpan di SQLite, 1 baris JSON).
// Dipakai: mode pembayaran, gateway QRIS, event/branding, kamera,
// timer sesi, dan API key buat integrasi aplikasi kasir.
// ==========================================================
const crypto = require("crypto");
const db = require("./db");

const DEFAULTS = {
  event: { name: "POPSNAP", subtitle: "" },

  // ---- UMUM ----
  general: {
    // Mode booth yang tampil di layar Start. Default HANYA foto (perilaku lama); mode lain harus dinyalakan
    // dan diberi harga dulu, supaya tidak ada mode gratis yang tak sengaja aktif.
    modes: {
      photo: { enabled: true, createGif: true },
      gif: { enabled: false, price: 0 },
      boomerang: { enabled: false, price: 0 },
      video: { enabled: false, price: 0 },
      showLabels: true,
    },
    kbSeeded: false,   // migrasi sekali: pengaturan lama "off" (bawaan lama) dinyalakan ke keyboard layar POPSNAP
    virtualKeyboard: "builtin", // off = keyboard fisik / bawaan perangkat | builtin = keyboard layar POPSNAP | windows = keyboard sentuh Windows (dibuka otomatis di aplikasi desktop)
    security: { pinHash: "", pinSalt: "", pinSeeded: false, pinDefault: false }, // PIN keluar dari layar penuh; disimpan ter-hash
    // Izin sosmed: tamu ditanya setelah bayar (sebelum pengumuman). Jawaban menandai folder sesi (BOLEH / TIDAK) untuk content creator.
    consent: { enabled: false, title: "IZIN FOTO", text: "Hai kak! Fotonya boleh kami bagikan di sosmed atau dipajang di mading toko? Pilih yang kakak nyaman ya.", seconds: 20 },
    disclaimer: {
      enabled: false,
      header: "Setuju dengan ketentuan?",
      text: "Dengan melanjutkan, saya mengizinkan foto saya diambil dan disimpan oleh penyelenggara untuk dibagikan kepada saya. Jika tidak setuju, sesi akan dibatalkan.",
    },
    // Ekspor real-time: salin hasil ke folder lain (flashdisk / folder cloud) begitu sesi selesai
    dataDir: "", // folder arsip permanen (kosong = bawaan / OUTPUT_DIR di .env)
    export: { enabled: false, dir: "", prints: true, originals: true, gifs: true, videos: true },
  },

  // ---- CETAK (printer utama / kedua; printer sharing Windows maupun langsung) ----
  printing: {
    enabled: false,
    main: { name: "", scale: 100, x: 0, y: 0 },    // name = nama printer di Windows (printer sharing \\\\PC\\NAMA juga bisa)
    second: { name: "", scale: 100, x: 0, y: 0 },
    auto: false,          // cetak otomatis tiap sesi selesai (langsung, tanpa tamu menekan apa pun)
    autoCopies: 1,        // jumlah salinan cetak otomatis (1-3)
    showButton: true,     // tombol ADD PRINT di layar hasil (tamu menambah cetakan)
    price: 0,             // harga Add Print per salinan (Rp); 0 = gratis. Berbayar -> tamu scan QRIS lagi sebelum dicetak
    both: false,          // cetak bergantian ke printer utama & kedua
    autorotate: true,     // orientasi kertas mengikuti template
    fit: "fill",          // fill = penuhi kertas (potong tepi) | fit = utuh dengan bingkai putih
    limit: { enabled: false, perEvent: 5000, perSession: 3 },
    copies: 5,            // pilihan jumlah salinan di tombol PRINT (1-9)
    sharpening: "medium", // none | low | medium | high
    strip2x6: false,      // template strip 2x6: cetak dobel berdampingan di kertas 4x6 (dipotong jadi dua)
  },

  // ---- KAMERA ----
  camera: {
    mode: "webcam",
    autoTrigger: true, // jepret otomatis saat hitung mundur selesai
    resolution: 2,     // 0 = frame rate tinggi (640x480) ... 3 = kualitas tertinggi (4K)
    videoDeviceId: "",
    audioDeviceId: "",
    dslr: { host: "http://localhost:5513", camera: "", driver: "digicam", model: "", zModel: "" }, // DSLR via digiCamControl (web server lokal)
    orientation: "auto", // auto = ikut gambar kamera | landscape | portrait (kamera dipasang tegak: gambar otomatis diputar 90°)
    liveView: { enabled: true, mirror: true, rotation: 0, displayOnStart: false, guide: true, fitTemplate: false, frameMode: "camera", brightness: 100, autoBright: true, canonAutoExposure: false, canonBoost: 3, asIs: false, contrast: 100, saturation: 100, warmth: 0 },
  },

  // ---- EDITOR: filter foto yang bisa ditambah admin (No Filter selalu ada di urutan pertama) ----
  // p = parameter CSS/canvas filter: brightness/contrast/saturate (100 = normal), grayscale/sepia (0-100), hue (derajat), blur (px)
  editor: {
    filters: [
      { id: "bw", label: "Black & White", enabled: true, p: { brightness: 100, contrast: 105, saturate: 100, grayscale: 100, sepia: 0, hue: 0, blur: 0 } },
      { id: "f1", label: "Filter 1", enabled: true, p: { brightness: 105, contrast: 100, saturate: 115, grayscale: 0, sepia: 35, hue: 0, blur: 0 } },
      { id: "f2", label: "Filter 2", enabled: true, p: { brightness: 100, contrast: 105, saturate: 125, grayscale: 0, sepia: 0, hue: -8, blur: 0 } },
      { id: "f3", label: "Filter 3", enabled: true, p: { brightness: 90, contrast: 125, saturate: 120, grayscale: 0, sepia: 0, hue: 0, blur: 0 } },
      { id: "f4", label: "Filter 4", enabled: true, p: { brightness: 110, contrast: 90, saturate: 85, grayscale: 0, sepia: 0, hue: 0, blur: 0 } },
    ],
  },

  // ---- TAMPILAN ----
  display: {
    autoFullscreen: true,   // klik Start / tombol layar penuh = masuk layar penuh (seperti F11)
    startFullscreen: true,  // aplikasi desktop (.exe) dibuka dalam layar penuh
    colors: { background: "#181B23", primary: "#E02843", buttonText: "#FFFFFF", secondary: "#4082AE" }, // tema PopSnap: tinta / merah / putih / biru
    startScreen: {
      image: "", stretch: "cover", // cover | contain | fill | center
      templateChoice: "favorites", // favorites (hanya template favorit/live yang tampil; sisanya Draft) | single
      singleTemplateId: "",
      unlockOpacity: 30,           // 0-100, ikon gembok di pojok
      triggerKeys: true,           // Spasi, S, PageUp, PageDown, F13 = Start
    },
    capture: {
      manualTrigger: true,         // true = tamu mengetuk layar/tombol dulu, baru hitung mundur -> jepret (tiap foto). false = pakai Automatic Sequence
      autoSequence: true,          // (hanya jika manualTrigger mati) hitung mundur -> jepret -> tampilkan -> foto berikutnya, otomatis
      countdownFirst: 5, countdownOthers: 3, displayPhotoSeconds: 2, countdownColor: "#FFFFFF",
      cropLiveview: true, hideCancel: false, showThumbnails: true, thumbnailLocation: "bottom",
      sayCheeseImage: "",
    },
    sharing: { mode: "qr", hideDone: false, iconsLocation: "right", showLabels: true, offline: "auto", offlineText: "Koneksi internet sedang terputus. Foto Anda akan dikirim oleh tim kami lewat WhatsApp." }, // offline: auto = tanpa QR bila internet mati | force = selalu tanpa QR | off = tetap tampilkan QR
    // Tombol kunci (gembok) -> PIN. Muncul di SEMUA layar booth, bukan hanya layar Start.
    lock: {
      position: "top-right",   // top-left | top-right | bottom-left | bottom-right
      style: "always",         // always = selalu terlihat | fade = muncul sebentar lalu menghilang | hidden = tersembunyi
      opacity: 30,             // 5-100, dipakai gaya "always"
      hideAfterSeconds: 4,     // gaya fade / hidden: lama gembok tampil setelah dimunculkan
      zoneSize: 96,            // px: luas area pojok yang peka ketuk / seret
    },
    // Layar pengingat SETELAH pembayaran & SEBELUM sesi foto. {shots}, {retakes} diganti angka sebenarnya.
    reminder: {
      enabled: true,
      seconds: 8,          // lama tampil
      skippable: true,     // ketuk layar = langsung lanjut
      backgroundImage: "", logoImage: "",
      panelColor: "#FDB62B", textColor: "#111111",
      items: [
        { text: "You will get {shots} snapshots per session", sub: "Kamu mendapatkan {shots} kesempatan foto dalam 1 sesi" },
        { text: "You can have maximum {retakes} retake per session", sub: "Kamu memiliki kesempatan {retakes}x retake untuk keseluruhan sesi" },
        { text: "Countdown for the first snapshot will start after this", sub: "Countdown untuk take pertama langsung dimulai setelah ini" },
      ],
    },
  },

  // ---- PENGATURAN MODE ----
  gif: { frames: 4, frameDelayMs: 600, width: 600 },
  // ---- HASIL AKHIR: tampilan apa saja yang dibuat & tombol di bawah template (Foto selalu ada) ----
  result: { live: true, gif: true, defaultView: "photo", gifStyle: "template", gifHoldMs: 1800 }, // gifStyle: template | plain | both
  // ---- TEMPLATE ANIMASI: tiap jepretan merekam klip pendek (siap-siap -> cekrek -> reaksi), lalu dipasang ke slot template jadi GIF gerak ----
  // Hanya berlaku untuk template yang saklar "Template animasi"-nya dinyalakan di Template Editor.
  animated: {
    enabled: true,
    secondsBefore: 1.5, // detik SEBELUM jepret yang ikut direkam (momen siap-siap)
    secondsAfter: 2,    // detik SESUDAH jepret (reaksi tertawa / tos)
    fps: 10,
    loop: "pingpong",   // pingpong = maju-mundur (mulus) | loop = ulang dari awal
    gifWidth: 480,      // lebar GIF template (px)
    templateMp4: true,  // buat juga video MP4 template (kecil & tajam) kalau browser mendukung
    rawClips: true,     // simpan klip mentah per foto
    rawFormat: "mp4",   // mp4 | gif (klip mentah)
    clipWidth: 640,     // lebar klip mentah (px)
    downloadPage: true, // QR membuka halaman unduh berisi semua file (foto, GIF, video, klip), bukan 1 file
  },
  boomerang: { seconds: 3, fps: 10, width: 480 },
  video: { seconds: 15, audio: false },

  session: {
    // downloadQr = "Final Screen Timeout": lama layar hasil/QR tampil sebelum kembali ke awal. 0 = tidak otomatis.
    timers: { payment: 45, photoSession: 240, photoSessionExtend: 60, editor: 180, downloadQr: 120 },
    totalShots: 8,
    maxRetakes: 5,
  },
  payment: {
    // voucher = bayar di kasir (offline) | qris = payment gateway | both | auto = QRIS saat online, voucher saat offline
    mode: "auto",
    voucherExpiryHours: 24,
    qris: {
      provider: "midtrans",
      simulate: false, // HANYA untuk testing: QRIS otomatis "lunas" 6 detik tanpa uang asli
      midtrans: { serverKey: "", clientKey: "", isProduction: false },
      // DOKU QRIS (SNAP Direct API) — lihat doku.js. privateKey = kunci RSA pribadi (PEM); public key-nya diunggah ke DOKU Back Office.
      doku: { clientId: "", secretKey: "", privateKey: "", keyPassphrase: "", merchantId: "", terminalId: "", postalCode: "", isProduction: false },
    },
    pos: { apiKey: "" },
    // Sinkron riwayat transaksi ke aplikasi kasir (lihat cloudSync.js). Token dibuat di kasir: menu Transaksi Photobox > Studio.
    cloud: { enabled: false, url: "", token: "", studioCode: "", countVoucherRevenue: false, galleryEnabled: false, galleryUrl: "" }, // galleryUrl = alamat POPSNAP Galeri (halaman QR + cloud), lihat gallerySync.js
  },
};

const PAYMENT_MODES = ["voucher", "qris", "both", "auto"];

function isObj(v) { return v && typeof v === "object" && !Array.isArray(v); }

function deepMerge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = isObj(base[k]) && isObj(over[k]) ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

let cache = null;

function load() {
  if (cache) return cache;
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'main'").get();
  let stored = {};
  try { stored = row ? JSON.parse(row.value) : {}; } catch { stored = {}; }
  cache = deepMerge(DEFAULTS, stored);
  // Migrasi: "Unlock Button Opacity" dulu ada di Start Screen; kini bagian dari pengaturan tombol kunci
  if (stored.display?.startScreen?.unlockOpacity !== undefined && stored.display?.lock === undefined) {
    cache.display.lock.opacity = num(stored.display.startScreen.unlockOpacity, 5, 100, cache.display.lock.opacity);
  }
  // Migrasi tema: kalau warna tersimpan masih persis palet bawaan LAMA (ungu/pink), ganti ke palet PopSnap baru.
  // Warna yang sudah dikustom admin (selain kombinasi bawaan lama) TIDAK disentuh.
  const lc = stored.display?.colors;
  const LEGACY = { background: "#12081F", primary: "#FF3E8E", buttonText: "#FFFFFF", secondary: "#7B2FFF" };
  if (lc && Object.keys(LEGACY).every((k) => String(lc[k] ?? "").toUpperCase() === LEGACY[k])) {
    cache.display.colors = { ...DEFAULTS.display.colors };
    persist();
  }
  // Migrasi: teks bawaan lama "Photobox Serba Bisa" dihapus dari layar Start
  if (cache.event?.subtitle === "Photobox Serba Bisa") { cache.event.subtitle = ""; persist(); }
  // Migrasi: opsi "semua template" dihapus (hanya template Live/favorit yang tampil di booth)
  if (cache.display?.startScreen?.templateChoice === "all") {
    cache.display.startScreen.templateChoice = "favorites";
    persist();
  }
  // PIN bawaan: instalasi baru (atau yang belum pernah punya PIN) diberi PIN 0808 sekali saja. Setelah admin mengganti / menghapusnya,
  // tidak diisi ulang (pinSeeded). Admin diingatkan di Pengaturan untuk menggantinya (pinDefault).
  if (!cache.general.security.pinSeeded) {
    const sec = cache.general.security;
    if (!sec.pinHash) { const { hash, salt } = require("./auth").hashPassword("0808"); sec.pinHash = hash; sec.pinSalt = salt; sec.pinDefault = true; }
    sec.pinSeeded = true;
    persist();
  }
  if (!cache.general.kbSeeded) {
    cache.general.kbSeeded = true;
    if (cache.general.virtualKeyboard === "off") cache.general.virtualKeyboard = "builtin";
    persist();
  }
  if (!cache.payment.pos.apiKey) {
    cache.payment.pos.apiKey = newApiKey();
    persist();
  }
  return cache;
}

function persist() {
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('main', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify(cache));
}

function newApiKey() {
  return "pk_" + crypto.randomBytes(24).toString("hex");
}

function num(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
function str(v, max, fallback) {
  if (typeof v !== "string") return fallback;
  return v.trim().slice(0, max);
}
const bool = (v, d) => (typeof v === "boolean" ? v : d);
const pick = (v, list, d) => (list.includes(v) ? v : d);
const hex = (v, d) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : d);
// Gambar hanya boleh berasal dari unggahan lewat server ini (/uploads/...), atau kosong untuk menghapus
const upath = (v, d) => (v === "" ? "" : typeof v === "string" && /^\/uploads\/[\w.\-]{1,120}$/.test(v) ? v : d);

/** Terapkan patch dari admin dengan validasi ketat (hanya field yang dikenal). */
function update(patch) {
  const cur = load();
  const next = JSON.parse(JSON.stringify(cur));
  const p = patch || {};
  const obj = (v) => (isObj(v) ? v : {});

  if (isObj(p.event)) {
    next.event.name = str(p.event.name, 60, cur.event.name) || cur.event.name;
    next.event.subtitle = str(p.event.subtitle, 100, cur.event.subtitle);
  }

  if (isObj(p.general)) {
    const g = p.general, cg = cur.general, ng = next.general;
    const m = obj(g.modes), cm = cg.modes;
    ng.modes = {
      photo: { enabled: true, createGif: bool(obj(m.photo).createGif, cm.photo.createGif) }, // mode foto selalu aktif
      gif: { enabled: bool(obj(m.gif).enabled, cm.gif.enabled), price: num(obj(m.gif).price, 0, 100000000, cm.gif.price) },
      boomerang: { enabled: bool(obj(m.boomerang).enabled, cm.boomerang.enabled), price: num(obj(m.boomerang).price, 0, 100000000, cm.boomerang.price) },
      video: { enabled: bool(obj(m.video).enabled, cm.video.enabled), price: num(obj(m.video).price, 0, 100000000, cm.video.price) },
      showLabels: bool(m.showLabels, cm.showLabels),
    };
    if (typeof g.dataDir === "string") ng.dataDir = str(g.dataDir, 300, "");
    ng.virtualKeyboard = pick(g.virtualKeyboard, ["off", "builtin", "windows"], cg.virtualKeyboard);
    const dis = obj(g.disclaimer);
    ng.disclaimer = {
      enabled: bool(dis.enabled, cg.disclaimer.enabled),
      header: str(dis.header, 120, cg.disclaimer.header),
      text: str(dis.text, 3000, cg.disclaimer.text),
    };
    const cs = obj(g.consent);
    ng.consent = { enabled: bool(cs.enabled, cg.consent.enabled), title: str(cs.title, 40, cg.consent.title) || cg.consent.title, text: str(cs.text, 200, cg.consent.text) || cg.consent.text, seconds: num(cs.seconds, 5, 120, cg.consent.seconds) };
    const ex = obj(g.export);
    ng.export = {
      enabled: bool(ex.enabled, cg.export.enabled),
      dir: ex.dir === undefined ? cg.export.dir : str(ex.dir, 300, ""),
      prints: bool(ex.prints, cg.export.prints), originals: bool(ex.originals, cg.export.originals),
      gifs: bool(ex.gifs, cg.export.gifs), videos: bool(ex.videos, cg.export.videos),
    };
    // PIN: hanya angka 4-8 digit, disimpan ter-hash (tidak pernah dikirim balik ke browser)
    const sec = obj(g.security);
    if (sec.clearPin === true) ng.security = { pinHash: "", pinSalt: "", pinSeeded: true, pinDefault: false };
    else if (typeof sec.pin === "string" && sec.pin !== "") {
      if (!/^\d{4,8}$/.test(sec.pin)) throw new Error("PIN harus berupa 4-8 angka.");
      const { hash, salt } = require("./auth").hashPassword(sec.pin);
      ng.security = { pinHash: hash, pinSalt: salt, pinSeeded: true, pinDefault: false };
    }
  }

  if (isObj(p.printing)) {
    const pr = p.printing, cp = cur.printing;
    const unit = (v, c) => { const o = obj(v); return { name: o.name === undefined ? c.name : str(o.name, 200, ""), scale: num(o.scale, 50, 150, c.scale), x: num(o.x, -100, 100, c.x), y: num(o.y, -100, 100, c.y) }; };
    const lm = obj(pr.limit);
    next.printing = {
      enabled: bool(pr.enabled, cp.enabled),
      main: unit(pr.main, cp.main), second: unit(pr.second, cp.second),
      auto: bool(pr.auto, cp.auto), autoCopies: num(pr.autoCopies, 1, 3, cp.autoCopies), price: num(pr.price, 0, 10000000, cp.price), showButton: bool(pr.showButton, cp.showButton), both: bool(pr.both, cp.both), autorotate: bool(pr.autorotate, cp.autorotate),
      fit: pick(pr.fit, ["fill", "fit"], cp.fit),
      limit: { enabled: bool(lm.enabled, cp.limit.enabled), perEvent: num(lm.perEvent, 1, 1000000, cp.limit.perEvent), perSession: num(lm.perSession, 1, 99, cp.limit.perSession) },
      copies: num(pr.copies, 1, 9, cp.copies),
      sharpening: pick(pr.sharpening, ["none", "low", "medium", "high"], cp.sharpening),
      strip2x6: bool(pr.strip2x6, cp.strip2x6),
    };
  }

  if (isObj(p.camera)) {
    const c = p.camera, cc = cur.camera, lv = obj(c.liveView);
    next.camera = {
      mode: pick(c.mode, ["webcam", "dslr"], cc.mode),
      orientation: pick(c.orientation, ["auto", "landscape", "portrait"], cc.orientation),
      autoTrigger: bool(c.autoTrigger, cc.autoTrigger),
      resolution: num(c.resolution, 0, 3, cc.resolution),
      videoDeviceId: c.videoDeviceId === undefined ? cc.videoDeviceId : str(c.videoDeviceId, 300, ""),
      audioDeviceId: c.audioDeviceId === undefined ? cc.audioDeviceId : str(c.audioDeviceId, 300, ""),
      dslr: (() => {
        const d = obj(c.dslr), cd = cc.dslr ?? { host: "http://localhost:5513", camera: "", driver: "digicam", model: "", zModel: "" };
        const host = d.host === undefined ? cd.host : String(d.host).trim().replace(/\/+$/, "");
        return { host: /^https?:\/\/[A-Za-z0-9.\-]+(:\d{2,5})?$/.test(host) ? host : cd.host, camera: d.camera === undefined ? cd.camera : str(d.camera, 200, ""), driver: pick(d.driver, ["digicam", "canon", "nikon", "sony"], cd.driver ?? "digicam"), model: d.model === undefined ? (cd.model ?? "") : str(d.model, 40, "").replace(/[^A-Za-z0-9_\- ]/g, ""), zModel: d.zModel === undefined ? (cd.zModel ?? "") : str(d.zModel, 40, "").replace(/[^A-Za-z0-9_\- ]/g, "") };
      })(),
      liveView: {
        enabled: bool(lv.enabled, cc.liveView.enabled), mirror: bool(lv.mirror, cc.liveView.mirror),
        rotation: pick(Number(lv.rotation), [0, 90, 180, 270], cc.liveView.rotation),
        displayOnStart: bool(lv.displayOnStart, cc.liveView.displayOnStart),
        guide: bool(lv.guide, cc.liveView.guide),
        fitTemplate: bool(lv.fitTemplate, cc.liveView.fitTemplate),
        frameMode: pick(lv.frameMode, ["camera", "template", "screen"], lv.fitTemplate ? "template" : cc.liveView.frameMode),
        brightness: num(lv.brightness, 10, 1000, cc.liveView.brightness),
        autoBright: bool(lv.autoBright, cc.liveView.autoBright),
        canonAutoExposure: bool(lv.canonAutoExposure, cc.liveView.canonAutoExposure),
        canonBoost: num(lv.canonBoost, 0, 6, cc.liveView.canonBoost),
        asIs: bool(lv.asIs, cc.liveView.asIs),
        // Profil warna live view (tampilan saja; linear, tidak menguatkan noise): 100 = apa adanya, warmth -30 (dingin) .. +30 (hangat)
        contrast: num(lv.contrast, 50, 160, cc.liveView.contrast ?? 100),
        saturation: num(lv.saturation, 0, 200, cc.liveView.saturation ?? 100),
        warmth: num(lv.warmth, -30, 30, cc.liveView.warmth ?? 0),
      },
    };
  }

  if (isObj(p.display)) {
    const d = p.display, cd = cur.display, nd = next.display;
    nd.autoFullscreen = bool(d.autoFullscreen, cd.autoFullscreen);
    nd.startFullscreen = bool(d.startFullscreen, cd.startFullscreen);
    const col = obj(d.colors);
    nd.colors = {
      background: hex(col.background, cd.colors.background), primary: hex(col.primary, cd.colors.primary),
      buttonText: hex(col.buttonText, cd.colors.buttonText), secondary: hex(col.secondary, cd.colors.secondary),
    };
    const ss = obj(d.startScreen), css = cd.startScreen;
    nd.startScreen = {
      image: ss.image === undefined ? css.image : upath(ss.image, css.image),
      stretch: pick(ss.stretch, ["cover", "contain", "fill", "center"], css.stretch),
      templateChoice: pick(ss.templateChoice, ["favorites", "single"], css.templateChoice), // nilai lama "all" otomatis jadi "favorites"
      singleTemplateId: ss.singleTemplateId === undefined ? css.singleTemplateId : str(ss.singleTemplateId, 60, ""),
      unlockOpacity: num(ss.unlockOpacity, 0, 100, css.unlockOpacity),
      triggerKeys: bool(ss.triggerKeys, css.triggerKeys),
    };
    const cp = obj(d.capture), ccp = cd.capture;
    nd.capture = {
      manualTrigger: bool(cp.manualTrigger, ccp.manualTrigger),
      autoSequence: bool(cp.autoSequence, ccp.autoSequence),
      countdownFirst: num(cp.countdownFirst, 0, 30, ccp.countdownFirst),
      countdownOthers: num(cp.countdownOthers, 0, 30, ccp.countdownOthers),
      displayPhotoSeconds: num(cp.displayPhotoSeconds, 0, 20, ccp.displayPhotoSeconds),
      countdownColor: hex(cp.countdownColor, ccp.countdownColor),
      cropLiveview: bool(cp.cropLiveview, ccp.cropLiveview), hideCancel: bool(cp.hideCancel, ccp.hideCancel),
      showThumbnails: bool(cp.showThumbnails, ccp.showThumbnails),
      thumbnailLocation: pick(cp.thumbnailLocation, ["bottom", "top", "left", "right"], ccp.thumbnailLocation),
      sayCheeseImage: cp.sayCheeseImage === undefined ? ccp.sayCheeseImage : upath(cp.sayCheeseImage, ccp.sayCheeseImage),
    };
    const sh = obj(d.sharing), csh = cd.sharing;
    nd.sharing = { mode: pick(sh.mode, ["qr", "preview"], csh.mode || "qr"), hideDone: bool(sh.hideDone, csh.hideDone), iconsLocation: pick(sh.iconsLocation, ["right", "left", "bottom"], csh.iconsLocation), showLabels: bool(sh.showLabels, csh.showLabels), offline: pick(sh.offline, ["auto", "force", "off"], csh.offline || "auto"), offlineText: sh.offlineText === undefined ? csh.offlineText : str(sh.offlineText, 200, "") };
    const lk = obj(d.lock), clk = cd.lock;
    nd.lock = {
      position: pick(lk.position, ["top-left", "top-right", "bottom-left", "bottom-right"], clk.position),
      style: pick(lk.style, ["always", "fade", "hidden"], clk.style),
      opacity: num(lk.opacity, 5, 100, clk.opacity),
      hideAfterSeconds: num(lk.hideAfterSeconds, 2, 30, clk.hideAfterSeconds),
      zoneSize: num(lk.zoneSize, 60, 240, clk.zoneSize),
    };
    const rm = obj(d.reminder), crm = cd.reminder;
    nd.reminder = {
      enabled: bool(rm.enabled, crm.enabled),
      seconds: num(rm.seconds, 2, 60, crm.seconds),
      skippable: bool(rm.skippable, crm.skippable),
      backgroundImage: rm.backgroundImage === undefined ? crm.backgroundImage : upath(rm.backgroundImage, crm.backgroundImage),
      logoImage: rm.logoImage === undefined ? crm.logoImage : upath(rm.logoImage, crm.logoImage),
      panelColor: hex(rm.panelColor, crm.panelColor), textColor: hex(rm.textColor, crm.textColor),
      items: Array.isArray(rm.items)
        ? rm.items.slice(0, 5).filter((i) => isObj(i) && str(i.text, 120, "")).map((i) => ({ text: str(i.text, 120, ""), sub: str(i.sub, 160, "") }))
        : crm.items,
    };
  }

  if (isObj(p.gif)) next.gif = { frames: num(p.gif.frames, 2, 12, cur.gif.frames), frameDelayMs: num(p.gif.frameDelayMs, 100, 3000, cur.gif.frameDelayMs), width: num(p.gif.width, 240, 1200, cur.gif.width) };
  if (isObj(p.result)) {
    const r = p.result, cr = cur.result;
    next.result = {
      live: bool(r.live, cr.live), gif: bool(r.gif, cr.gif),
      defaultView: pick(r.defaultView, ["photo", "live", "gif"], cr.defaultView),
      gifStyle: pick(r.gifStyle, ["template", "plain", "both"], cr.gifStyle),
      gifHoldMs: num(r.gifHoldMs, 0, 6000, cr.gifHoldMs),
    };
  }
  if (isObj(p.animated)) {
    const a = p.animated, ca = cur.animated;
    next.animated = {
      enabled: bool(a.enabled, ca.enabled),
      secondsBefore: Math.round(num(Number(a.secondsBefore) * 10, 0, 50, ca.secondsBefore * 10)) / 10,
      secondsAfter: Math.round(num(Number(a.secondsAfter) * 10, 0, 40, ca.secondsAfter * 10)) / 10,
      fps: num(a.fps, 5, 15, ca.fps),
      loop: pick(a.loop, ["pingpong", "loop"], ca.loop),
      gifWidth: num(a.gifWidth, 240, 800, ca.gifWidth),
      templateMp4: bool(a.templateMp4, ca.templateMp4),
      rawClips: bool(a.rawClips, ca.rawClips),
      rawFormat: pick(a.rawFormat, ["mp4", "gif"], ca.rawFormat),
      clipWidth: num(a.clipWidth, 240, 1280, ca.clipWidth),
      downloadPage: bool(a.downloadPage, ca.downloadPage),
    };
    if (next.animated.secondsBefore + next.animated.secondsAfter < 1) next.animated.secondsAfter = 1 - next.animated.secondsBefore; // klip minimal 1 detik
  }
  if (isObj(p.boomerang)) next.boomerang = { seconds: num(p.boomerang.seconds, 1, 6, cur.boomerang.seconds), fps: num(p.boomerang.fps, 5, 15, cur.boomerang.fps), width: num(p.boomerang.width, 240, 800, cur.boomerang.width) };
  if (isObj(p.video)) next.video = { seconds: num(p.video.seconds, 3, 120, cur.video.seconds), audio: bool(p.video.audio, cur.video.audio) };

  if (isObj(p.session)) {
    const t = isObj(p.session.timers) ? p.session.timers : {};
    const ct = cur.session.timers;
    next.session.timers = {
      payment: num(t.payment, 10, 600, ct.payment),
      photoSession: num(t.photoSession, 30, 3600, ct.photoSession),
      photoSessionExtend: num(t.photoSessionExtend, 10, 600, ct.photoSessionExtend),
      editor: num(t.editor, 30, 1800, ct.editor),
      downloadQr: num(t.downloadQr, 0, 900, ct.downloadQr),
    };
    next.session.totalShots = num(p.session.totalShots, 1, 20, cur.session.totalShots);
    next.session.maxRetakes = num(p.session.maxRetakes, 0, 20, cur.session.maxRetakes);
  }

  // "Hide Done" hanya boleh aktif kalau layar hasil punya timeout otomatis — kalau tidak, booth akan macet di layar hasil
  if ((next.display.sharing.hideDone || next.display.sharing.mode === "preview") && next.session.timers.downloadQr < 5) next.session.timers.downloadQr = 30; // preview tanpa timer = layar tertahan selamanya

  if (isObj(p.editor) && Array.isArray(p.editor.filters)) {
    const seen = new Set(["none"]);
    const list = [];
    for (const f of p.editor.filters.slice(0, 24)) {
      if (!isObj(f)) continue;
      const id = typeof f.id === "string" && /^[\w-]{1,24}$/.test(f.id) ? f.id : null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const q = obj(f.p);
      // LUT (.cube) yang sudah diubah jadi PNG strip & diunggah lewat server ini. Alamat penuh dipangkas jadi /uploads/...
      const lm = isObj(f.lut) ? String(f.lut.url || "").match(/\/uploads\/([\w.\-]{1,120})$/) : null;
      const lut = lm ? { url: `/uploads/${lm[1]}`, size: num(f.lut.size, 2, 65, 33), intensity: num(f.lut.intensity, 0, 100, 100) } : null;
      list.push({
        id,
        label: str(f.label, 24, "Filter") || "Filter",
        enabled: bool(f.enabled, true),
        ...(lut ? { lut } : {}),
        p: {
          brightness: num(q.brightness, 0, 300, 100), contrast: num(q.contrast, 0, 300, 100), saturate: num(q.saturate, 0, 300, 100),
          grayscale: num(q.grayscale, 0, 100, 0), sepia: num(q.sepia, 0, 100, 0), hue: num(q.hue, -180, 180, 0), blur: num(q.blur, 0, 10, 0),
        },
      });
    }
    next.editor = { filters: list };
  }

  if (isObj(p.payment)) {
    if (PAYMENT_MODES.includes(p.payment.mode)) next.payment.mode = p.payment.mode;
    if (p.payment.voucherExpiryHours !== undefined) next.payment.voucherExpiryHours = num(p.payment.voucherExpiryHours, 0, 720, cur.payment.voucherExpiryHours);
    if (isObj(p.payment.cloud)) {
      const c = p.payment.cloud, nc = next.payment.cloud;
      if (typeof c.enabled === "boolean") nc.enabled = c.enabled;
      if (typeof c.url === "string") nc.url = c.url.trim().slice(0, 200);
      if (typeof c.token === "string" && c.token && !c.token.includes("•")) nc.token = c.token.trim().slice(0, 200);
      if (c.clearToken === true) nc.token = "";
      if (typeof c.studioCode === "string") nc.studioCode = c.studioCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
      if (typeof c.countVoucherRevenue === "boolean") nc.countVoucherRevenue = c.countVoucherRevenue;
      if (typeof c.galleryEnabled === "boolean") nc.galleryEnabled = c.galleryEnabled;
      if (typeof c.galleryUrl === "string") { const g = c.galleryUrl.trim().replace(/\/+$/, "").slice(0, 200); nc.galleryUrl = g === "" || /^https?:\/\/[^\s/]+/.test(g) ? g : nc.galleryUrl; }
    }
    if (isObj(p.payment.qris)) {
      if (typeof p.payment.qris.simulate === "boolean") next.payment.qris.simulate = p.payment.qris.simulate;
      if (["midtrans", "doku"].includes(p.payment.qris.provider)) next.payment.qris.provider = p.payment.qris.provider;
      const dk = p.payment.qris.doku;
      if (isObj(dk)) {
        const nd = next.payment.qris.doku, line = (v, n) => String(v).trim().slice(0, n);
        for (const [k, n] of [["clientId", 80], ["merchantId", 40], ["terminalId", 16], ["postalCode", 5]]) if (typeof dk[k] === "string") nd[k] = line(dk[k], n);
        if (typeof dk.isProduction === "boolean") nd.isProduction = dk.isProduction;
        // secret kosong / berupa topeng (•) = jangan ubah yang tersimpan
        if (typeof dk.secretKey === "string" && dk.secretKey && !dk.secretKey.includes("•")) nd.secretKey = line(dk.secretKey, 200);
        if (typeof dk.privateKey === "string" && dk.privateKey && !dk.privateKey.includes("•")) nd.privateKey = dk.privateKey.trim().slice(0, 6000);
        if (typeof dk.keyPassphrase === "string" && dk.keyPassphrase && !dk.keyPassphrase.includes("•")) nd.keyPassphrase = dk.keyPassphrase.slice(0, 200);
        if (dk.clearSecrets === true) { nd.secretKey = ""; nd.privateKey = ""; nd.keyPassphrase = ""; }
      }
      const m = p.payment.qris.midtrans;
      if (isObj(m)) {
        // Nilai kosong / berupa topeng (••••) = jangan ubah key yang sudah tersimpan
        if (typeof m.serverKey === "string" && m.serverKey && !m.serverKey.includes("•")) next.payment.qris.midtrans.serverKey = m.serverKey.trim();
        if (typeof m.clientKey === "string") next.payment.qris.midtrans.clientKey = m.clientKey.trim();
        if (typeof m.isProduction === "boolean") next.payment.qris.midtrans.isProduction = m.isProduction;
        if (m.clearServerKey === true) next.payment.qris.midtrans.serverKey = "";
      }
    }
  }

  cache = next;
  persist();
  return cache;
}

/** Cek PIN layar penuh. Tanpa PIN terpasang -> selalu lolos. */
function verifyPin(pin) {
  const sec = load().general.security;
  if (!sec.pinHash) return true;
  return require("./auth").verifyPassword(String(pin ?? ""), sec.pinHash, sec.pinSalt);
}
const hasPin = () => !!load().general.security.pinHash;

function setPaymentMode(mode) {
  if (!PAYMENT_MODES.includes(mode)) return null;
  load();
  cache.payment.mode = mode;
  persist();
  return cache;
}

function regenerateApiKey() {
  load();
  cache.payment.pos.apiKey = newApiKey();
  persist();
  return cache.payment.pos.apiKey;
}

function maskSecret(v) {
  if (!v) return "";
  return "••••••••" + v.slice(-4);
}

/** Versi lengkap buat halaman admin (secret di-mask, API key kasir ditampilkan karena admin perlu menyalinnya). */
function forAdmin() {
  const s = JSON.parse(JSON.stringify(load()));
  const m = s.payment.qris.midtrans;
  m.serverKeySet = !!m.serverKey;
  m.serverKey = maskSecret(m.serverKey);
  const dk = s.payment.qris.doku;
  dk.secretKeySet = !!dk.secretKey; dk.privateKeySet = !!dk.privateKey; dk.keyPassphraseSet = !!dk.keyPassphrase;
  dk.secretKey = maskSecret(dk.secretKey); dk.privateKey = dk.privateKeySet ? "•••• (tersimpan)" : ""; dk.keyPassphrase = dk.keyPassphraseSet ? "••••" : "";
  const cl = s.payment.cloud;
  cl.tokenSet = !!cl.token;
  cl.token = maskSecret(cl.token);
  s.general.security = { pinSet: hasPin(), pinDefault: !!load().general.security.pinDefault }; // hash PIN tidak pernah keluar dari server
  return s;
}

/** Bagian pengaturan yang aman dilihat layar booth / pelanggan (tanpa secret, tanpa folder ekspor). */
function forKiosk() {
  const s = JSON.parse(JSON.stringify(load())); // salinan: pemanggil boleh memodifikasi (mis. mengubah alamat gambar) tanpa merusak data asli
  const { export: _omit, security: _sec, dataDir: _dd, ...general } = s.general;
  return {
    event: s.event, camera: s.camera, printing: s.printing, session: s.session, display: s.display, editor: s.editor,
    general: { ...general, pinSet: hasPin() },
    gif: s.gif, result: s.result, boomerang: s.boomerang, video: s.video, animated: s.animated,
  };
}

module.exports = { load, update, setPaymentMode, regenerateApiKey, forAdmin, forKiosk, verifyPin, hasPin, PAYMENT_MODES };
