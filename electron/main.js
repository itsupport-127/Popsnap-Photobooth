// ==========================================================
// Electron Main Process
//
// Tugasnya:
// 1. Buka window kiosk (fullscreen, tanpa menu bar) yang load frontend
// 2. Sediakan IPC handler untuk DSLR bridge (dipanggil dari frontend
//    lewat preload.js)
// 3. (Opsional) mulai backend Express secara otomatis kalau mau
//    dijadikan 1 aplikasi utuh, bukan 2 proses terpisah
// ==========================================================

const { app, BrowserWindow, ipcMain, Menu, dialog, Tray, nativeImage, session } = require("electron");
const BACKEND_URL = "http://127.0.0.1:4000";
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const dslrBridge = require("./dslrBridge");
const printer = require("./printer");

const isDev = !app.isPackaged;
// Saat development: load dari Vite dev server (npm run dev di folder frontend)
// Saat production (packaged): load dari file hasil build (frontend/dist)
const FRONTEND_DEV_URL = "http://localhost:5173";
// Packaged: hasil build frontend disalin electron-builder ke resources/frontend (lihat "extraResources").
const FRONTEND_BUILD_PATH = isDev
  ? path.join(__dirname, "../frontend/dist/index.html")
  : path.join(process.resourcesPath, "frontend", "index.html");
// Dev: backend ada di folder sebelah (../backend). Production (packaged):
// backend di-copy ke folder "resources" oleh electron-builder (lihat
// "extraResources" di package.json), lokasinya beda dari struktur dev.
const BACKEND_DIR = isDev
  ? path.join(__dirname, "../backend")
  : path.join(process.resourcesPath, "backend");

let mainWindow;
let backendProcess = null;

/**
 * Nyalain backend (Node server.js) sebagai proses anak, SUPAYA versi .exe
 * hasil build beneran "sekali klik" — gak perlu buka terminal terpisah buat
 * backend sama sekali. Cuma jalan di mode PRODUCTION (packaged); saat dev,
 * kamu tetap jalanin backend manual (npm start di folder backend) seperti biasa,
 * supaya log-nya gampang dipantau di terminal sendiri.
 */
let quitting = false;
let backendRestarts = 0;

function startBackend() {
  if (isDev) return; // dev mode: backend dijalanin manual, biar gampang debug

  // Pakai Node bawaan Electron (ELECTRON_RUN_AS_NODE) — PC booth TIDAK perlu memasang Node.js.
  // Data (database, upload, kunci login, arsip foto) disimpan di AppData pengguna, bukan di folder program.
  const dataDir = app.getPath("userData");
  fs.mkdirSync(dataDir, { recursive: true });
  const logFile = path.join(dataDir, "backend.log");
  const log = (line) => { try { fs.appendFileSync(logFile, line); } catch { /* abaikan */ } };

  backendProcess = spawn(process.execPath, ["server.js"], {
    cwd: BACKEND_DIR,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      POPSNAP_DATA: dataDir,
      OUTPUT_DIR: process.env.OUTPUT_DIR || path.join(app.getPath("documents"), "POPSNAP-Photos"),
    },
  });

  log(`\n=== ${new Date().toISOString()} backend start (${BACKEND_DIR}) ===\n`);
  let lastErr = "";
  const startedAt = Date.now();
  backendProcess.stdout.on("data", (data) => { console.log(`[backend] ${data}`); log(String(data)); });
  backendProcess.stderr.on("data", (data) => { console.error(`[backend] ${data}`); log(String(data)); lastErr = (lastErr + data).slice(-1500); });
  backendProcess.on("error", (err) => { log(`spawn error: ${err.message}\n`); dialog.showErrorBox("POPSNAP: backend gagal dijalankan", `${err.message}\n\nLog: ${logFile}`); });
  backendProcess.on("exit", (code) => {
    log(`Proses berhenti, kode: ${code}\n`);
    if (quitting) return;
    if (Date.now() - startedAt < 20000) {
      dialog.showErrorBox("POPSNAP: backend berhenti saat dinyalakan", `${lastErr.trim() || "Tidak ada pesan error."}\n\nLog lengkap: ${logFile}`);
      return;
    }
    // Backend mati di tengah jalan (mis. error tak terduga): nyalakan lagi otomatis supaya booth tidak "mati" (maks 5x)
    if (backendRestarts < 5) { backendRestarts++; log(`Menyalakan ulang backend (#${backendRestarts})\n`); setTimeout(startBackend, 2000); }
  });
}

function stopBackend() {
  quitting = true;
  if (backendProcess) {
    backendProcess.removeAllListeners("exit"); // sengaja dimatikan: jangan tampilkan peringatan
    backendProcess.kill();
    backendProcess = null;
  }
}

let allowClose = false;
let tray = null;
let trayHintShown = false;
let pinBusy = false;

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ---- PIN: jendela PIN asli Electron (dipakai close/Alt+F4 & menu tray) ----
let pinResolve = null;
let pinWin = null;
async function pinIsSet() {
  try { const r = await fetch(`${BACKEND_URL}/api/settings/public`); const j = await r.json(); return !!j?.general?.pinSet; }
  catch { return true; } // backend tidak terjawab: anggap PIN ada (aman)
}
/** true = boleh lanjut. Tanpa PIN terpasang -> langsung boleh (admin diperingatkan di pengaturan untuk membuat PIN). */
async function guard(title) {
  if (pinBusy) return false;
  if (!(await pinIsSet())) return true;
  pinBusy = true;
  const ok = await new Promise((resolve) => {
    pinResolve = resolve;
    pinWin = new BrowserWindow({
      width: 400, height: 560, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      alwaysOnTop: true, autoHideMenuBar: true, title: "PIN", skipTaskbar: true,
      webPreferences: { preload: path.join(__dirname, "pinPreload.js"), contextIsolation: true, nodeIntegration: false },
    });
    pinWin.setAlwaysOnTop(true, "screen-saver");
    pinWin.setMenu(null);
    pinWin.on("closed", () => { pinWin = null; if (pinResolve) { pinResolve(false); pinResolve = null; } });
    pinWin.loadFile(path.join(__dirname, "pinWindow.html"), { query: { title } });
    pinWin.once("ready-to-show", () => { pinWin?.show(); pinWin?.focus(); });
  });
  pinBusy = false;
  return ok;
}
ipcMain.handle("pin:submit", async (_e, pin) => {
  try {
    const r = await fetch(`${BACKEND_URL}/api/kiosk/verify-pin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: String(pin ?? "").slice(0, 12) }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) { const done = pinResolve; pinResolve = null; done?.(true); pinWin?.close(); return { ok: true }; }
    return { ok: false, error: j.error || "PIN salah." };
  } catch { return { ok: false, error: "Tidak bisa menghubungi backend." }; }
});
ipcMain.on("pin:cancel", () => pinWin?.close());

// Ikon di system tray (dekat jam Windows): klik = buka, klik kanan = menu.
function createTray() {
  if (tray) return;
  const iconPath = isDev ? path.join(__dirname, "build", "icon.png") : path.join(process.resourcesPath, "icon.png");
  let img = nativeImage.createFromPath(iconPath);
  if (!img.isEmpty()) img = img.resize({ width: 32, height: 32 });
  tray = new Tray(img);
  tray.setToolTip("POPSNAP Photobox");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Tampilkan POPSNAP", click: showWindow },
    { type: "separator" },
    // Keluar sungguhan dari tray: tanpa PIN (PIN sudah dilalui saat menyembunyikan dari mode booth)
    { label: "Keluar", click: () => { allowClose = true; app.quit(); } },
  ]));
  tray.on("click", showWindow);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 1920, // default portrait, gampang diubah sesuai orientasi booth
    fullscreen: !isDev, // fullscreen kiosk mode di production, windowed saat dev
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Pemeriksa ejaan Windows memuat kamus saat kolom teks pertama kali diklik -> terasa macet beberapa detik. Booth tidak butuh ejaan.
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  // ---- Kunci kiosk (production) ----
  // Menu bawaan Electron membawa pintasan F11 (layar penuh), Ctrl+W (tutup), Ctrl+R (muat ulang), Ctrl+Shift+I (DevTools).
  // Di booth, semuanya dimatikan: F11 diteruskan ke aplikasi (yang meminta PIN), dan jendela hanya bisa ditutup
  // setelah admin sengaja memilih keluar (allowClose).
  if (!isDev) {
    Menu.setApplicationMenu(null);
    mainWindow.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const ctrl = input.control || input.meta;
      if (input.key === "F11") {
        event.preventDefault();
        mainWindow.webContents.send("kiosk:f11");
      } else if (input.key === "F5" || input.key === "F12" || (ctrl && ["r", "w", "q"].includes(input.key.toLowerCase())) || (ctrl && input.shift && input.key.toLowerCase() === "i")) {
        event.preventDefault();
      }
    });
    // Tombol close / Alt+F4: minta PIN dulu (jendela PIN asli Electron). PIN benar -> jendela disembunyikan ke system tray
    // (seperti dslrBooth); dari tray petugas bisa membuka lagi atau memilih Keluar (juga minta PIN).
    // Tamu tidak pernah bisa menutup / menyembunyikan booth, jadi tidak bisa menjangkau desktop maupun pengaturan.
    // PIN HANYA diminta saat mode booth (layar penuh / maximize). Saat jendela biasa (tidak penuh), tombol close langsung
    // menyembunyikan ke tray tanpa PIN, dan "Keluar" di tray juga tanpa PIN.
    const hideToTray = () => {
      if (!tray) { mainWindow.minimize(); return; } // tanpa ikon tray jendela tidak boleh hilang
      mainWindow.hide();
      if (!trayHintShown) {
        trayHintShown = true;
        try { tray.displayBalloon({ title: "POPSNAP masih berjalan", content: "Klik ikon POPSNAP di dekat jam untuk membuka lagi, atau klik kanan > Keluar." }); } catch { /* bukan Windows */ }
      }
    };
    mainWindow.on("close", (e) => {
      if (allowClose) return;
      e.preventDefault();
      const locked = mainWindow.isFullScreen(); // PIN hanya di mode booth (layar penuh); jendela biasa / maximize biasa = langsung ke tray
      if (!locked) { hideToTray(); return; }
      guard("PIN untuk menyembunyikan POPSNAP ke tray").then((ok) => { if (ok) hideToTray(); });
    });
    // Keamanan: halaman tidak boleh pindah ke alamat luar / membuka jendela baru
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    mainWindow.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file://")) e.preventDefault(); });
  }
  // Saat layar penuh (mode booth) jendela selalu di paling atas, supaya jendela/notifikasi lain tidak menutupi layar tamu
  const syncTop = () => { if (!isDev) mainWindow.setAlwaysOnTop(mainWindow.isFullScreen(), "screen-saver"); };
  mainWindow.on("enter-full-screen", () => { syncTop(); mainWindow.webContents.send("kiosk:fullscreen-changed"); });
  mainWindow.on("leave-full-screen", () => { syncTop(); mainWindow.webContents.send("kiosk:fullscreen-changed"); });
  mainWindow.once("ready-to-show", syncTop);

  if (isDev) {
    mainWindow.loadURL(FRONTEND_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(FRONTEND_BUILD_PATH);
  }
}

// Hanya satu POPSNAP yang boleh jalan (dua backend akan berebut port 4000 & kamera)
// Windows: jangan anggap jendela "tertutup" (throttle) & matikan pemeriksa ejaan bawaan Windows (penyebab macet saat klik kolom teks)
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion,WinUseBrowserSpellChecker");
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on("second-instance", () => showWindow());

if (gotLock) app.whenReady().then(() => {
  // Izin browser: hanya kamera/mikrofon & layar penuh (selain itu ditolak)
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(["media", "fullscreen"].includes(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ["media", "fullscreen"].includes(permission));
  if (!isDev) createTray();
  startBackend();
  // Kasih backend waktu sebentar buat nyala sebelum window dibuka, supaya
  // konsumen gak lihat error "gagal konek backend" di detik-detik pertama.
  setTimeout(createWindow, isDev ? 0 : 1500);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  dslrBridge.stopPreviewLoop();
  stopBackend();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", stopBackend);

// ---------- IPC: Kiosk (layar penuh) ----------
// PIN diperiksa oleh frontend ke backend SEBELUM memanggil setFullscreen(false) / quit().
ipcMain.handle("kiosk:is-fullscreen", () => !!mainWindow?.isFullScreen());
ipcMain.handle("kiosk:set-fullscreen", (_e, on) => {
  if (mainWindow) mainWindow.setFullScreen(!!on);
  return !!mainWindow?.isFullScreen();
});
// Keyboard sentuh Windows (TabTip.exe). Hanya Windows; di OS lain tidak melakukan apa-apa.
ipcMain.handle("kiosk:show-touch-keyboard", () => {
  if (process.platform !== "win32") return false;
  try {
    const exe = path.join(process.env.ProgramFiles || "C:\\Program Files", "Common Files", "microsoft shared", "ink", "TabTip.exe");
    require("child_process").spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
});
ipcMain.handle("kiosk:quit", () => {
  allowClose = true;
  app.quit();
});
ipcMain.handle("kiosk:pick-folder", async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"] });
  return r.canceled ? null : r.filePaths[0];
});

// ---------- IPC: Cetak ----------
ipcMain.handle("print:list", async () => { try { return { ok: true, printers: await printer.list(mainWindow) }; } catch (e) { return { ok: false, error: e.message, printers: [] }; } });
ipcMain.handle("print:add-share", async (_e, unc) => printer.addShare(String(unc || "").trim()));
ipcMain.handle("print:image", async (_e, o) => printer.print(o || {}));
ipcMain.handle("print:test", async (_e, o) => printer.testPage(o || {}));

// ---------- IPC: Simpan sebagai (dialog Windows) ----------
// Renderer hanya boleh menulis ke path yang BARU SAJA dipilih pengguna lewat dialog (sekali pakai) —
// jadi halaman yang disusupi tidak bisa menulis ke sembarang lokasi.
const approvedSavePaths = new Set();
const lastDirs = new Map(); // idKey -> folder terakhir
ipcMain.handle("files:choose-save-path", async (_e, { defaultName, description, ext, idKey } = {}) => {
  const safeName = path.basename(String(defaultName || "file"));
  const startDir = lastDirs.get(idKey) || app.getPath("documents");
  const e = String(ext || "").replace(/^\./, "");
  const r = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(startDir, safeName),
    filters: e ? [{ name: description || e.toUpperCase(), extensions: [e] }, { name: "Semua file", extensions: ["*"] }] : undefined,
  });
  if (r.canceled || !r.filePath) return null;
  lastDirs.set(idKey, path.dirname(r.filePath));
  approvedSavePaths.add(r.filePath);
  return r.filePath;
});
ipcMain.handle("files:write-chosen", async (_e, filePath, bytes) => {
  if (!approvedSavePaths.delete(filePath)) throw new Error("Lokasi simpan belum dipilih lewat dialog.");
  await fs.promises.writeFile(filePath, Buffer.from(bytes));
  return true;
});

// ---------- IPC: DSLR Bridge ----------
// Frontend manggil ini lewat window.electronAPI (lihat preload.js)

const tempDir = path.join(os.tmpdir(), "popsnap-dslr");
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

ipcMain.handle("dslr:check-connection", async () => {
  return dslrBridge.checkCameraConnected();
});

ipcMain.handle("dslr:capture", async () => {
  const outputPath = path.join(tempDir, `shot-${Date.now()}.jpg`);
  await dslrBridge.capturePhoto(outputPath);
  const base64 = fs.readFileSync(outputPath, { encoding: "base64" });
  return `data:image/jpeg;base64,${base64}`;
});

ipcMain.handle("dslr:start-preview", (event) => {
  const previewPath = path.join(tempDir, "preview.jpg");
  dslrBridge.startPreviewLoop(previewPath, (framePath) => {
    try {
      const base64 = fs.readFileSync(framePath, { encoding: "base64" });
      event.sender.send("dslr:preview-frame", `data:image/jpeg;base64,${base64}`);
    } catch {
      // frame belum siap ditulis — lewati, tunggu tick berikutnya
    }
  });
  return true;
});

ipcMain.handle("dslr:stop-preview", () => {
  dslrBridge.stopPreviewLoop();
  return true;
});
