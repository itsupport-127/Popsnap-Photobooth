// ==========================================================
// DSLR Bridge
//
// Jembatan antara Electron dan software kontrol kamera DSLR.
// Browser TIDAK bisa akses DSLR langsung (alasan keamanan OS),
// jadi ini jalan di proses Electron (Node.js), yang punya akses
// penuh ke sistem.
//
// Windows -> digiCamControl (gratis, https://digicamcontrol.com)
//            TIDAK pakai CLI (CameraControlCmd.exe TIDAK BISA
//            dipakai bersamaan sama app-nya lagi jalan — itu
//            batasan resmi dari digiCamControl sendiri).
//            Sebagai gantinya, pakai WEB SERVER bawaan digiCamControl
//            (harus diaktifkan di Settings > Webserver, port default 5513)
//            yang bisa diakses selagi app-nya tetap jalan di background.
//            Referensi resmi: https://digicamcontrol.com/doc/userguide/web
//
// Mac/Linux -> gPhoto2 (gratis, biasanya sudah ada di paket linux,
//              di Mac lewat `brew install gphoto2`)
//
// CATATAN PENTING: kode ini butuh kamera fisik + software tsb
// ter-install untuk bisa dites beneran. Struktur & alurnya sudah
// disesuaikan dengan dokumentasi resmi masing-masing tool, tapi
// WAJIB dites ulang dengan kamera asli di lokasi kamu sebelum
// dipakai produksi.
// ==========================================================

const { exec } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

// Alamat web server digiCamControl. WAJIB diaktifkan dulu di:
// digiCamControl > Settings > Webserver > centang "Use web server" +
// "Allow interaction via webserver" > port 5513 (default) > RESTART app.
const DIGICAM_HOST = process.env.DIGICAM_HOST || "http://localhost:5513";

const platform = os.platform(); // 'win32' | 'darwin' | 'linux'

function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      resolve(stdout.trim());
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cek apakah kamera DSLR terdeteksi & siap dipakai.
 */
async function checkCameraConnected() {
  try {
    if (platform === "win32") {
      // "list cameras" lewat Single Command System digiCamControl — return daftar
      // kamera yang tersambung ke sesi (dipisah baris baru kalau lebih dari satu).
      // CATATAN: endpoint ini TIDAK didokumentasikan resmi di digicamcontrol.com/doc/userguide/web
      // (cuma dicontohkan ?slc=get untuk "lastcaptured"), tapi pola "slc=list&param1=cameras&param2="
      // dikonfirmasi dipakai tool pihak ketiga (digipy, wrapper Python resmi buat API ini) lewat
      // perintah "slc list cameras". WAJIB dites ulang langsung di PC kiosk — kalau ternyata
      // responsnya kosong padahal digiCamControl sudah menampilkan nama kameranya sendiri, berarti
      // param-nya masih belum pas dan perlu disesuaikan lagi (cek log konsol Electron untuk teks
      // mentah yang dikembalikan server).
      const res = await fetch(`${DIGICAM_HOST}/?slc=list&param1=cameras&param2=`);
      if (!res.ok) return false;
      const text = (await res.text()).trim();
      console.log("[dslr] Respons mentah cek kamera (?slc=list&param1=cameras):", JSON.stringify(text));
      if (!text || text.toLowerCase().includes("error")) return false;
      // Respons bisa berupa daftar nama dipisah baris baru, ATAU array JSON — tangani keduanya.
      try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed.length > 0 : !!parsed;
      } catch {
        return text.split(/\r?\n/).filter(Boolean).length > 0;
      }
    } else {
      const out = await runCommand("gphoto2 --auto-detect");
      // Output punya minimal 2 baris (header + separator) kalau tidak ada kamera
      return out.split("\n").length > 2;
    }
  } catch (err) {
    console.error(
      "[dslr] Gagal cek kamera. Kalau di Windows, pastikan digiCamControl JALAN dan " +
        "Webserver diaktifkan di Settings (port 5513). Detail:",
      err.message
    );
    return false;
  }
}

/**
 * Ambil satu foto dan simpan ke path tujuan. Return path file yang tersimpan.
 * @param {string} outputPath - path lengkap file tujuan (misal: C:\popsnap\temp\shot1.jpg)
 */
async function capturePhoto(outputPath) {
  if (platform === "win32") {
    // 1) Perintahkan capture lewat webserver
    const captureRes = await fetch(`${DIGICAM_HOST}/?CMD=Capture`);
    if (!captureRes.ok) throw new Error("Gagal kirim perintah capture ke digiCamControl");

    // 2) Tunggu sebentar biar file selesai ditulis di sisi digiCamControl
    await sleep(800);

    // 3) Tanya nama file yang barusan kecapture
    const lastRes = await fetch(`${DIGICAM_HOST}/?slc=get&param1=lastcaptured&param2=`);
    const filename = (await lastRes.text()).trim();
    if (!filename || filename === "-") {
      throw new Error("digiCamControl belum selesai capture, coba lagi.");
    }

    // 4) Download file hasil capture itu lewat endpoint /image/<filename>
    const imgRes = await fetch(`${DIGICAM_HOST}/image/${encodeURIComponent(filename)}`);
    if (!imgRes.ok) throw new Error(`Gagal download hasil capture: ${filename}`);
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
  } else {
    // gPhoto2: --capture-image-and-download langsung ambil + simpan
    const dir = path.dirname(outputPath);
    const filename = path.basename(outputPath);
    await runCommand(`cd "${dir}" && gphoto2 --capture-image-and-download --filename "${filename}"`);
  }
  return outputPath;
}

/**
 * Mulai live preview (dipakai untuk feed video di layar sesi foto).
 *
 * Windows: pakai endpoint /liveview.jpg dari webserver digiCamControl,
 *          di-polling berulang tiap `intervalMs` — ini pendekatan resmi
 *          yang didokumentasikan digiCamControl sendiri untuk live preview.
 * Mac/Linux: gPhoto2 --capture-preview ditulis ke file, di-polling sama
 *          seperti Windows (gPhoto2 gak punya webserver bawaan).
 */
let previewInterval = null;

function startPreviewLoop(previewPath, onFrame, intervalMs = 200) {
  stopPreviewLoop();

  if (platform === "win32") {
    // Pastikan jendela live view aktif dulu di sisi digiCamControl
    fetch(`${DIGICAM_HOST}/?CMD=LiveViewWnd_Show`).catch(() => {});

    previewInterval = setInterval(async () => {
      try {
        const res = await fetch(`${DIGICAM_HOST}/liveview.jpg`, { cache: "no-store" });
        if (!res.ok) return; // live view belum siap, coba lagi tick berikutnya
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(previewPath, buffer);
        onFrame(previewPath);
      } catch {
        // sela sesaat / kamera belum siap — abaikan, coba lagi di tick berikutnya
      }
    }, intervalMs);
  } else {
    previewInterval = setInterval(async () => {
      try {
        await runCommand(`gphoto2 --capture-preview --filename "${previewPath}" --force-overwrite`);
        onFrame(previewPath);
      } catch {
        // sela sesaat / kamera belum siap — abaikan, coba lagi di tick berikutnya
      }
    }, intervalMs);
  }
}

function stopPreviewLoop() {
  if (previewInterval) clearInterval(previewInterval);
  previewInterval = null;
  if (platform === "win32") {
    fetch(`${DIGICAM_HOST}/?CMD=LiveViewWnd_Hide`).catch(() => {});
  }
}

module.exports = {
  checkCameraConnected,
  capturePhoto,
  startPreviewLoop,
  stopPreviewLoop,
};
