// ==========================================================
// sdkBridge — penghubung kamera lewat program perantara SDK pabrikan (canon_sdk_bridge.exe / nikon_sdk_bridge.exe).
//
// Kenapa program terpisah: DLL Canon EDSDK itu 32-bit, sedangkan POPSNAP 64-bit — keduanya tidak bisa satu proses.
// Program perantara dijalankan sebagai proses anak; POPSNAP bicara lewat baris teks di stdin/stdout:
//   kirim: CONNECT | LIVEVIEW_START | LIVEVIEW_STOP | CAPTURE | DISCONNECT | QUIT
//   terima: READY_* | CONNECTED | CAMERA=nama | INCOMING_DIR=folder | LIVEVIEW_STARTED|FILE=path
//           CAPTURE_DOWNLOADED|FILE=path|BYTES=n | ERROR|pesan | DISCONNECTED
// (protokol diambil dari teks di dalam program perantara; belum diuji dengan kamera asli -> semua baris dicatat ke log
//  dan ditampilkan di Pengaturan > Kamera supaya mudah dicocokkan.)
//
// Lokasi file: backend/sdk/canon/ dan backend/sdk/nikon/<MODEL>/ (ikut terpasang di installer; disalin otomatis ke %AppData%\POPSNAP\sdk).
// ==========================================================
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const config = require("./config");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const isJpeg = (b) => b && b.length > 500 && b[0] === 0xff && b[1] === 0xd8;

// Cari program perantara. File SDK ikut terpasang bersama aplikasi (backend/sdk/...), tapi folder instalasi
// (Program Files) tidak bisa ditulisi, jadi pada pemakaian pertama disalin ke folder data (%AppData%\POPSNAP\sdk).
function findDir(brand, model) {
  const exe = `${brand}_sdk_bridge.exe`;
  const sub = brand === "nikon" ? String(model || "").replace(/[^A-Za-z0-9_\-]/g, "") : "";
  const userBase = path.join(config.dataDir, "sdk", brand);
  const bundled = path.join(__dirname, "sdk", brand);
  const has = (d) => { try { return fs.existsSync(path.join(d, exe)); } catch { return false; } };
  const tryPair = (u, b) => {
    if (has(b)) {
      try {
        const same = has(u) && fs.statSync(path.join(u, exe)).size === fs.statSync(path.join(b, exe)).size;
        if (!same) fs.cpSync(b, u, { recursive: true, force: true });
      } catch (e) { console.log("[sdk] gagal menyalin SDK:", e.message); }
    }
    return has(u) ? u : has(b) ? b : null;
  };
  return (sub && tryPair(path.join(userBase, sub), path.join(bundled, sub))) || tryPair(userBase, bundled);
}

class SdkBridge {
  constructor(brand) {
    this.brand = brand;
    this.proc = null;
    this.reset();
    this.lines = [];
    this.lvDir = path.join(os.tmpdir(), `popsnap-lv-${brand}`);
  }
  reset() { this.ready = false; this.connected = false; this.camera = ""; this.incoming = ""; this.lvFile = ""; this.lvOn = false; this.error = ""; this.waiters = []; }
  log(l) { this.lines.push(l); if (this.lines.length > 60) this.lines.shift(); console.log(`[sdk:${this.brand}]`, l); }

  start(model, zModel) {
    if (this.proc) return null;
    this.model = model;
    const dir = findDir(this.brand, this.model);
    if (!dir) return `File SDK ${this.brand} tidak ditemukan${this.brand === "nikon" ? " untuk model " + (this.model || "(belum dipilih)") : ""}. Pastikan folder sdk\\${this.brand} sudah ikut di aplikasi.`;
    fs.mkdirSync(this.lvDir, { recursive: true });
    this.reset();
    const env = { ...process.env, YMT_LIVEVIEW_DIR: this.lvDir, PATH: `${dir};${process.env.PATH || ""}` };
    if (zModel) env.YMT_NIKON_MODEL = zModel;
    let p;
    try { p = spawn(path.join(dir, `${this.brand}_sdk_bridge.exe`), [], { cwd: dir, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (e) { return e.message; }
    this.proc = p;
    let buf = "";
    p.stdout.on("data", (d) => { buf += d.toString("utf8"); let i; while ((i = buf.search(/\r?\n/)) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(buf.indexOf("\n", i) + 1); if (line) this.onLine(line); } });
    p.stderr.on("data", (d) => this.log("stderr: " + d.toString().trim().slice(0, 200)));
    p.on("error", (e) => { this.error = e.message; this.log("gagal jalan: " + e.message); this.proc = null; });
    p.on("exit", (code) => { this.log(`program perantara berhenti (kode ${code})`); this.proc = null; this.reset(); });
    p.stdin.on("error", () => {});
    return null;
  }

  send(cmd) { this.log("> " + cmd); try { this.proc?.stdin.write(cmd + "\n"); } catch { /* proses sudah mati */ } }

  onLine(line) {
    if (!/^(STATUS\|)?EVF_HEARTBEAT|\|SEQ=/.test(line) || (this.noisy = (this.noisy || 0) + 1) % 100 === 1) this.log(line); // jangan banjiri log dengan baris per-frame
    line = line.replace(/^STATUS\|/, ""); // balasan bisa berawalan "STATUS|" (mis. STATUS|READY_X86_...)
    if (/^READY/.test(line)) { this.ready = true; this.send("CONNECT"); }
    else if (/^CONNECTED/.test(line)) { this.connected = true; this.error = ""; }
    else if (/^DISCONNECTED/.test(line)) { this.connected = false; }
    else if (/^CAMERA=/.test(line)) this.camera = line.slice(7).trim();
    else if (/^INCOMING_DIR=/.test(line)) this.incoming = line.slice(13).trim();
    else if (/^LIVEVIEW_ALREADY_RUNNING/.test(line)) { this.lvOn = true; }
    else if (/^LIVEVIEW_STARTED/.test(line)) { this.lvOn = true; const m = /FILE=([^|]+)/.exec(line); if (m) this.lvFile = m[1].trim(); }
    else if (/^LIVEVIEW_STOPPED/.test(line)) this.lvOn = false;
    else if (/^ERROR\|/.test(line)) { this.error = line.slice(6); }
    const m = /^CAPTURE_DOWNLOADED\|FILE=([^|]+)/.exec(line);
    if (m) for (const w of this.waiters.splice(0)) w.resolve(m[1].trim());
    if (/^ERROR\||^CAPTURE_SKIPPED|failed/i.test(line)) for (const w of this.waiters.splice(0)) w.reject(new Error(line.replace(/^ERROR\|/, "")));
  }

  async ensure(model, zModel) {
    const err = this.start(model, zModel);
    if (err) throw new Error(err);
    const t0 = Date.now();
    while (!this.connected && Date.now() - t0 < 12000) {
      if (!this.proc) throw new Error(this.error || "Program perantara berhenti. Cek kabel USB, tutup aplikasi kamera lain (EOS Utility / digiCamControl / NX Tether).");
      if (this.error && !this.connected && this.ready) break;
      await wait(250);
    }
    if (!this.connected) throw new Error(this.error || "Kamera belum tersambung (timeout). Nyalakan kamera & colok USB.");
  }

  status() {
    return { running: !!this.proc, connected: this.connected, camera: this.camera, error: this.error, bridgeFps: this.bridgeFps || 0, framesOk: this.frameOk || 0, framesRejected: this.frameRejected || 0, lines: this.lines.slice(-20) };
  }

  async liveFrame(model, zModel) {
    await this.ensure(model, zModel);
    if (!this.lvOn) { this.send("LIVEVIEW_START"); await wait(600); }
    const candidates = [this.lvFile, path.join(this.lvDir, "liveview.jpg")].filter(Boolean);
    for (const f of candidates) { try { const b = fs.readFileSync(f); if (isJpeg(b)) return b; } catch { /* belum ada */ } }
    throw new Error("live view belum siap");
  }

  // Frame live view terbaru HANYA kalau file-nya berubah sejak dibaca terakhir (dipakai aliran MJPEG)
  readFrameIfNew() {
    for (const f of [this.lvFile, path.join(this.lvDir, "liveview.jpg")].filter(Boolean)) {
      try {
        const st = fs.statSync(f);
        const sig = `${f}|${st.mtimeMs}|${st.size}`;
        if (sig === this.lastSig) return null;
        const b = fs.readFileSync(f);
        if (!isJpeg(b)) continue;
        // JPEG sah = ada penanda akhir (FFD9). Buffer live view Canon bisa berisi sisa byte kosong setelahnya, jadi cari
        // penanda itu di bagian belakang file (bukan harus tepat di byte terakhir) lalu buang sisanya.
        const from = Math.max(2, b.length - 8192);
        let end = -1;
        for (let i = b.length - 2; i >= from; i--) if (b[i] === 0xff && b[i + 1] === 0xd9) { end = i + 2; break; }
        if (end < 0) { this.frameRejected = (this.frameRejected || 0) + 1; continue; } // file sedang ditulis / terpotong
        this.lastSig = sig; this.frameOk = (this.frameOk || 0) + 1; this.lastFrameAt = Date.now();
        // hitung frame/detik yang benar-benar dihasilkan program perantara (supaya kelihatan: lag dari kamera atau dari aplikasi)
        const now = Date.now(); this._fn = (this._fn || 0) + 1; this._ft = this._ft || now;
        if (now - this._ft >= 1000) { this.bridgeFps = Math.round(this._fn * 1000 / (now - this._ft) * 10) / 10; this._fn = 0; this._ft = now; }
        return end === b.length ? b : b.subarray(0, end);
      } catch { /* belum ada / sedang ditulis */ }
    }
    return null;
  }

  async capture(model, zModel) {
    await this.ensure(model, zModel);
    const p = new Promise((resolve, reject) => {
      const w = { resolve, reject };
      this.waiters.push(w);
      setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) { this.waiters.splice(i, 1); reject(new Error("Foto tidak datang dari kamera (timeout). Cek JPEG, fokus, mode kamera.")); } }, 30000);
    });
    this.send("CAPTURE");
    const file = await p;
    this.lvOn = false; // live view berhenti saat jepret -> nyalakan lagi otomatis
    for (let i = 0; i < 10; i++) {
      try { const b = fs.readFileSync(file); if (isJpeg(b)) return b; } catch { /* file belum selesai */ }
      await wait(300);
    }
    throw new Error(`File foto tidak terbaca atau bukan JPEG: ${file}`);
  }

  stop() { try { this.send("QUIT"); setTimeout(() => this.proc?.kill(), 1500); } catch { /* sudah mati */ } }
}

const bridges = {};
const native = require("./nativeBridge");
// Pakai program perantara buatan POPSNAP (popsnap_<merek>_bridge.exe, live view lebih lancar) bila ada; kalau tidak, program bawaan lama.
// Kamera Nikon seri Z belum punya bridge buatan sendiri (pembungkus MAID3 hanya untuk seri D) -> pakai program bawaan.
const get = (brand, model) => {
  const z = brand === "nikon" && /^Z/i.test(String(model || ""));
  const key = z ? "nikon-z" : brand;
  if (!bridges[key]) bridges[key] = !z && native.EXE_BY_BRAND[brand] && native.findDir(brand, "-") ? new native.NativeBridge(brand) : new SdkBridge(brand);
  return bridges[key];
};
process.on("exit", () => Object.values(bridges).forEach((b) => b.proc?.kill()));

// Matikan semua program perantara SDK (dipanggil saat memakai digiCamControl, supaya kamera tidak diperebutkan dua program)
function stopAll() {
  for (const b of Object.values(bridges)) { try { if (b.proc) { b.send("QUIT"); const p = b.proc; setTimeout(() => p.kill(), 800); } } catch { /* sudah mati */ } }
}
// Sisa program perantara dari sesi sebelumnya (yatim saat aplikasi ditutup paksa) menahan kamera -> bunuh saat backend mulai
function killOrphans() {
  if (process.platform !== "win32") return;
  for (const n of ["canon_sdk_bridge.exe", "nikon_sdk_bridge.exe", "sony_sdk_bridge.exe", "popsnap_canon_bridge.exe", "popsnap_nikon_bridge.exe"]) {
    try { spawn("taskkill", ["/F", "/IM", n], { windowsHide: true, stdio: "ignore" }).on("error", () => {}); } catch { /* abaikan */ }
  }
}
killOrphans();

module.exports = { get, findDir, stopAll };
