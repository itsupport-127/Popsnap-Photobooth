// ==========================================================
// nativeBridge — penghubung ke popsnap_canon_bridge.exe (program perantara buatan POPSNAP sendiri, 32-bit).
// Frame live view & foto datang LANGSUNG lewat pipa (tanpa file di disk) sebagai paket biner:
//   [1 byte jenis][4 byte panjang little-endian][isi]   jenis: T = teks, F = frame live view (JPEG), P = foto (JPEG)
// Antarmukanya sama dengan SdkBridge (ensure/status/liveFrame/readFrameIfNew/capture/send/stop), jadi bisa saling menggantikan.
// ==========================================================
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const config = require("./config");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const EXE_BY_BRAND = { canon: "popsnap_canon_bridge.exe", nikon: "popsnap_nikon_bridge.exe" };
const EXE = EXE_BY_BRAND.canon; // (kompatibel dengan pemakai lama)

// Sama seperti SdkBridge: salin bundel (backend/sdk/<brand>) ke %AppData%\POPSNAP\sdk bila perlu (folder instalasi tak bisa ditulisi).
// Canon: exe + DLL satu folder (sdk/canon). Nikon: exe di sdk/nikon, file md3/DLL per model di sdk/nikon/<MODEL> (diberikan sebagai argumen).
// Hasil: { dir: folder exe, arg: folder model (Nikon) }  atau null bila belum ada.
function findDir(brand, model) {
  const exe = EXE_BY_BRAND[brand];
  if (!exe) return null;
  const sub = brand === "nikon" ? String(model || "").replace(/[^A-Za-z0-9_\-]/g, "") : "";
  const user = path.join(config.dataDir, "sdk", brand);
  const bundled = path.join(__dirname, "sdk", brand);
  const has = (d) => { try { return fs.existsSync(path.join(d, exe)); } catch { return false; } };
  const sync = (from, to) => { try { fs.cpSync(from, to, { recursive: true, force: true }); } catch (e) { console.log("[native] gagal menyalin SDK:", e.message); } };
  if (!has(bundled) && !has(user)) return null;
  if (brand === "canon") {
    if (has(bundled)) { const same = has(user) && fs.statSync(path.join(user, exe)).size === fs.statSync(path.join(bundled, exe)).size; if (!same) sync(bundled, user); }
    return { dir: has(user) ? user : bundled, arg: null };
  }
  // nikon
  if (has(bundled)) {
    const same = has(user) && fs.statSync(path.join(user, exe)).size === fs.statSync(path.join(bundled, exe)).size;
    if (!same) fs.copyFileSync(path.join(bundled, exe), (fs.mkdirSync(user, { recursive: true }), path.join(user, exe)));
    if (sub && fs.existsSync(path.join(bundled, sub)) && !fs.existsSync(path.join(user, sub))) sync(path.join(bundled, sub), path.join(user, sub));
  }
  const root = has(user) ? user : bundled;
  if (!sub) return { dir: root, arg: null, needModel: true };
  const md = [path.join(user, sub), path.join(bundled, sub)].find((d) => fs.existsSync(d));
  return md ? { dir: root, arg: md } : { dir: root, arg: null, missingModel: sub };
}

/**
 * Rapikan satu frame JPEG dari program perantara: harus diawali penanda awal (FFD8); buang byte sisa setelah penanda akhir (FFD9).
 * Frame tanpa penanda akhir (terpotong) diberi FFD9 supaya browser selesai menguraikannya, dan ditandai `noEoi` untuk diagnosa.
 * null = bukan JPEG (dibuang, jangan ditampilkan).
 */
function normalizeJpeg(b) {
  if (!b || b.length < 500) return null;
  let start = 0;
  if (b[0] !== 0xff || b[1] !== 0xd8) {
    start = -1;
    const lim = Math.min(b.length - 3, 2048);
    for (let i = 1; i < lim; i++) if (b[i] === 0xff && b[i + 1] === 0xd8 && b[i + 2] === 0xff) { start = i; break; }
    if (start < 0) return null;
  }
  const from = Math.max(start + 2, b.length - 65536);
  for (let i = b.length - 2; i >= from; i--) {
    if (b[i] === 0xff && b[i + 1] === 0xd9) return { buf: b.subarray(start, i + 2), noEoi: false };
  }
  return { buf: Buffer.concat([b.subarray(start), Buffer.from([0xff, 0xd9])]), noEoi: true };
}

class NativeBridge {
  constructor(brand) { this.brand = brand; this.proc = null; this.native = true; this.lines = []; this.reset(); }
  reset() {
    this.ready = false; this.connected = false; this.camera = ""; this.lvOn = false; this.error = "";
    this.waiters = []; this.frame = null; this.frameSeq = 0; this.lastSeq = 0; this.frameOk = 0; this.frameRejected = 0; this.frameNoEoi = 0; this.resyncBytes = 0; this.bridgeFps = 0;
    this.lastFrameAt = 0; this.frameWaiters = []; this.camWaiters = []; this.camInfoData = null; this.camSetResult = null; this.camOld = false;
    this.rx = Buffer.alloc(0); this.pend = []; this.pendBytes = 0;
  }
  log(l) { this.lines.push(l); if (this.lines.length > 60) this.lines.shift(); console.log(`[native:${this.brand}]`, l); }

  start(model) {
    if (this.proc) return null;
    this.model = model;
    const f = findDir(this.brand, model);
    if (!f) return `${EXE_BY_BRAND[this.brand]} tidak ditemukan di sdk\\${this.brand}`;
    if (f.needModel) return "Model kamera Nikon belum dipilih di Pengaturan > Kamera.";
    if (f.missingModel) return `Folder model ${f.missingModel} tidak ada di sdk\\nikon.`;
    const dir = f.arg || f.dir;
    this.reset();
    let p;
    try { p = spawn(path.join(f.dir, EXE_BY_BRAND[this.brand]), f.arg ? [f.arg] : [], { cwd: dir, env: { ...process.env, PATH: `${dir};${process.env.PATH || ""}` }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (e) { return e.message; }
    this.proc = p;
    p.stdout.on("data", (d) => this.onData(d));
    p.stderr.on("data", (d) => this.log("stderr: " + d.toString().trim().slice(0, 200)));
    p.on("error", (e) => { this.error = e.message; this.log("gagal jalan: " + e.message); this.proc = null; });
    p.on("exit", (code) => { this.log(`program perantara berhenti (kode ${code})`); this.proc = null; const e = this.error; this.reset(); this.error = e; });
    p.stdin.on("error", () => {});
    return null;
  }

  // Paket masuk lewat pipa dalam potongan acak. Potongan hanya digabung SEKALI per paket (bukan tiap potongan: untuk frame
  // ratusan KB itu O(n²) dan membebani CPU). Byte penanda jenis yang tidak dikenal = aliran bergeser -> geser 1 byte sampai sinkron lagi.
  onData(d) {
    this.pend.push(d); this.pendBytes += d.length;
    this.parse();
  }

  parse() {
    for (;;) {
      if (this.rx.length < 5) {
        if (!this.pend.length) return;
        this.rx = Buffer.concat([this.rx, ...this.pend]); this.pend = []; this.pendBytes = 0;
        if (this.rx.length < 5) return;
      }
      const k = this.rx[0];
      if (k !== 0x46 && k !== 0x50 && k !== 0x54) { this.rx = this.rx.subarray(1); this.resyncBytes++; continue; } // bukan F / P / T
      const len = this.rx.readUInt32LE(1);
      if (len > 64 * 1024 * 1024) { this.rx = this.rx.subarray(1); this.resyncBytes++; continue; }
      const total = 5 + len;
      if (this.rx.length < total) {
        if (this.rx.length + this.pendBytes < total) return; // belum lengkap: tunggu potongan berikutnya
        this.rx = Buffer.concat([this.rx, ...this.pend]); this.pend = []; this.pendBytes = 0;
      }
      const type = String.fromCharCode(k);
      const body = Buffer.from(this.rx.subarray(5, total)); // salin: bufer gabungan dipakai terus untuk paket berikutnya
      this.rx = this.rx.subarray(total);
      if (type === "F") this.onFrame(body);
      else if (type === "P") this.photo = body;
      else this.onText(body.toString("utf8"));
    }
  }

  onFrame(raw) {
    const j = normalizeJpeg(raw);
    if (!j) { this.frameRejected++; return; } // bukan JPEG: jangan tampilkan (ini yang tampak sebagai layar pecah)
    if (j.noEoi && ++this.frameNoEoi === 1) this.log("INFO|frame live view tanpa penanda akhir JPEG (terpotong?) — diperbaiki otomatis");
    this.frame = j.buf; this.frameSeq++; this.frameOk++; this.lvOn = true; this.lastFrameAt = Date.now();
    if (this.frameWaiters.length) for (const f of this.frameWaiters.splice(0)) f();
  }

  /** Tunggu frame baru (maks `ms`) tanpa polling cepat. */
  waitFrame(ms) {
    if (this.frameSeq !== this.lastSeq) return Promise.resolve();
    return new Promise((resolve) => {
      let t;
      const done = () => { clearTimeout(t); const i = this.frameWaiters.indexOf(done); if (i >= 0) this.frameWaiters.splice(i, 1); resolve(); };
      t = setTimeout(done, ms);
      this.frameWaiters.push(done);
    });
  }

  onText(line) {
    if (!/^FPS\|/.test(line)) this.log(line);
    if (/^READY/.test(line)) { this.ready = true; this.send("CONNECT"); }
    else if (/^CONNECTED\|/.test(line)) { this.syncBoost(true); this.connected = true; this.camera = line.slice(10).trim(); this.error = ""; }
    else if (/^DISCONNECTED/.test(line)) { this.connected = false; this.lvOn = false; }
    else if (/^LIVEVIEW_STARTED/.test(line)) this.lvOn = true;
    else if (/^LIVEVIEW_STOPPED/.test(line)) { this.lvOn = false; this.frame = null; }
    else if (/^FPS\|/.test(line)) this.bridgeFps = Number(line.slice(4)) || 0;
    else if (/^CAPTURE_OK/.test(line)) { const p = this.photo; this.photo = null; for (const w of this.waiters.splice(0)) p ? w.resolve(p) : w.reject(new Error("Foto kosong")); }
    else if (/^CAPTURE_FAILED\|/.test(line)) { this.lvOn = false; for (const w of this.waiters.splice(0)) w.reject(new Error(line.slice(15))); }
    else if (/^CAMINFO\|/.test(line)) { try { this.camInfoData = JSON.parse(line.slice(8)); } catch { this.camInfoData = { error: "Balasan kamera tidak terbaca" }; } for (const w of this.camWaiters.splice(0)) w(this.camInfoData); }
    else if (/^CAMSET_OK\|/.test(line)) this.camSetResult = { ok: true, prop: line.slice(10) };
    else if (/^CAMSET_FAILED\|/.test(line)) { const [, prop, ...why] = line.split("|"); this.camSetResult = { ok: false, prop, error: why.join("|") || "Ditolak kamera" }; }
    else if (/^ERROR\|Perintah tidak dikenal: CAM_/.test(line)) { this.camOld = true; for (const w of this.camWaiters.splice(0)) w({ error: "Program perantara kamera masih versi lama. Build ulang popsnap_" + this.brand + "_bridge.exe dan salin ke backend\\sdk." }); }
    else if (/^ERROR\|Perintah tidak dikenal: LV_BOOST/.test(line)) this.log("(exe Canon lama: belum mendukung Canon Auto Exposure, build ulang popsnap_canon_bridge.exe)");
    else if (/^ERROR\|/.test(line)) this.error = line.slice(6);
  }

  /** "Auto Exposure" live view (Admin > Kamera; Canon: ISO+shutter, Nikon: ISO): jumlah stop eksposur kamera diterangkan selama live view. Dikirim sebelum LIVEVIEW_START bila berubah. */
  syncBoost(force) {
    let n = 0;
    try { const lv = require("./settings").load().camera?.liveView ?? {}; n = (lv.canonAutoExposure === false || lv.asIs === true) ? 0 : Math.max(0, Math.min(6, Math.round(Number(lv.canonBoost ?? 3)))); } catch { /* pakai 0 */ }
    if (force || n !== this.boostSent) { this.boostSent = n; this.log("> LV_BOOST " + n); try { this.proc?.stdin.write(`LV_BOOST ${n}\n`); } catch { /* proses mati */ } }
  }

  send(cmd) { if (cmd === "LIVEVIEW_START" && this.ready) this.syncBoost(false); this.log("> " + cmd); try { this.proc?.stdin.write(cmd + "\n"); } catch { /* proses sudah mati */ } }

  async ensure(model) {
    const err = this.start(model);
    if (err) throw new Error(err);
    const t0 = Date.now();
    while (!this.connected && Date.now() - t0 < 12000) {
      if (!this.proc) throw new Error(this.error || "Program perantara berhenti. Cek kabel USB & tutup aplikasi kamera lain.");
      if (this.error && this.ready) { await wait(1500); if (!this.connected && this.proc) this.send("CONNECT"); } // coba sambung ulang sekali-dua kali
      else await wait(200);
    }
    if (!this.connected) throw new Error(this.error || "Kamera belum tersambung (timeout). Nyalakan kamera & colok USB.");
  }

  /** Setelan kamera (ISO / shutter / aperture / white balance + daftar pilihan dari kamera). */
  async camInfo(model) {
    await this.ensure(model);
    return new Promise((resolve) => {
      const t = setTimeout(() => { const i = this.camWaiters.indexOf(done); if (i >= 0) this.camWaiters.splice(i, 1); resolve({ error: "Kamera tidak menjawab. Coba lagi, atau build ulang program perantara kamera." }); }, 6000);
      const done = (d) => { clearTimeout(t); resolve(d); };
      this.camWaiters.push(done);
      this.send("CAM_INFO");
    });
  }

  /** Ubah satu setelan; hasilnya { ok, error, info } (info = setelan terbaru dari kamera). */
  async camSet(model, prop, value) {
    await this.ensure(model);
    if (!/^(iso|av|tv|wb)$/.test(prop) || !/^\d{1,10}$/.test(String(value))) return { ok: false, error: "Setelan tidak valid" };
    this.camSetResult = null;
    const info = new Promise((resolve) => { const t = setTimeout(() => resolve(null), 8000); this.camWaiters.push((d) => { clearTimeout(t); resolve(d); }); });
    this.send(`CAM_SET ${prop} ${value}`);
    const d = await info;
    const r = this.camSetResult || { ok: false, error: "Kamera tidak menjawab" };
    this.camSetResult = null;
    return { ...r, info: d };
  }

  status() { return { running: !!this.proc, connected: this.connected, camera: this.camera, error: this.error, native: true, bridgeFps: this.bridgeFps, framesOk: this.frameOk, framesRejected: this.frameRejected, framesNoEoi: this.frameNoEoi, resyncBytes: this.resyncBytes, lines: this.lines.slice(-20) }; }

  async liveFrame(model) {
    await this.ensure(model);
    if (!this.lvOn) this.send("LIVEVIEW_START");
    for (let i = 0; i < 40; i++) { if (this.frame) return this.frame; await wait(100); }
    throw new Error("live view belum siap");
  }

  readFrameIfNew() {
    if (this.frameSeq === this.lastSeq || !this.frame) return null;
    this.lastSeq = this.frameSeq; return this.frame;
  }

  async capture(model) {
    await this.ensure(model);
    const p = new Promise((resolve, reject) => {
      const w = { resolve, reject }; this.waiters.push(w);
      setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) { this.waiters.splice(i, 1); reject(new Error("Foto tidak datang dari kamera (timeout). Cek JPEG, fokus, mode kamera.")); } }, 35000);
    });
    this.photo = null;
    this.send("CAPTURE");
    return p;
  }

  stop() { try { this.send("QUIT"); setTimeout(() => this.proc?.kill(), 1500); } catch { /* sudah mati */ } }
}

module.exports = { NativeBridge, findDir, EXE, EXE_BY_BRAND, normalizeJpeg };
