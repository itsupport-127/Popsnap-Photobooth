// ==========================================================
// Preload Script
//
// Ini "jembatan aman" antara kode frontend (React, jalan di
// Chromium sandbox) dan proses Electron utama (Node.js, akses
// penuh ke sistem). Frontend TIDAK bisa langsung require('child_process')
// dsb karena alasan keamanan — semua akses sistem harus lewat sini.
//
// Frontend memanggilnya lewat `window.electronAPI.dslr.xxx(...)`
// ==========================================================

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  dslr: {
    checkConnection: () => ipcRenderer.invoke("dslr:check-connection"),
    capture: () => ipcRenderer.invoke("dslr:capture"),
    startPreview: () => ipcRenderer.invoke("dslr:start-preview"),
    stopPreview: () => ipcRenderer.invoke("dslr:stop-preview"),
    onPreviewFrame: (callback) => {
      // Return fungsi "unsubscribe" — WAJIB dipanggil saat komponen unmount,
      // supaya listener gak numpuk kalau layar sesi foto dibuka-tutup
      // berkali-kali selama app kiosk jalan lama tanpa restart.
      const handler = (_event, dataUrl) => callback(dataUrl);
      ipcRenderer.on("dslr:preview-frame", handler);
      return () => ipcRenderer.removeListener("dslr:preview-frame", handler);
    },
  },
  // Layar penuh / kunci kiosk (lihat frontend/src/hooks/useKiosk.jsx)
  kiosk: {
    isFullscreen: () => ipcRenderer.invoke("kiosk:is-fullscreen"),
    setFullscreen: (on) => ipcRenderer.invoke("kiosk:set-fullscreen", on),
    quit: () => ipcRenderer.invoke("kiosk:quit"),
    showTouchKeyboard: () => ipcRenderer.invoke("kiosk:show-touch-keyboard"),
    onRequestQuit: (cb) => {
      const h = () => cb();
      ipcRenderer.on("kiosk:request-quit", h);
      return () => ipcRenderer.removeListener("kiosk:request-quit", h);
    },
    onF11: (cb) => {
      const h = () => cb();
      ipcRenderer.on("kiosk:f11", h);
      return () => ipcRenderer.removeListener("kiosk:f11", h);
    },
    onFullscreenChange: (cb) => {
      const h = () => cb();
      ipcRenderer.on("kiosk:fullscreen-changed", h);
      return () => ipcRenderer.removeListener("kiosk:fullscreen-changed", h);
    },
  },
  pickFolder: () => ipcRenderer.invoke("kiosk:pick-folder"),
  // Dialog "Simpan sebagai" bawaan Windows (dipakai Export template & unduh CSV)
  chooseSavePath: (opts) => ipcRenderer.invoke("files:choose-save-path", opts),
  writeChosenFile: (filePath, bytes) => ipcRenderer.invoke("files:write-chosen", filePath, bytes),
  // Penanda buat frontend supaya tau dia jalan di dalam Electron
  // (dipakai di useCamera.js untuk memilih mode webcam vs DSLR)
  isElectron: true,
});
