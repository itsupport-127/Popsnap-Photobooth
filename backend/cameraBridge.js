// ==========================================================
// cameraBridge — jembatan kamera DSLR / mirrorless (Canon, Nikon, Sony, dll) lewat digiCamControl (gratis).
//
// Kenapa lewat backend: browser (Chrome/Edge/Firefox) TIDAK bisa membuka DSLR — di Windows DSLR muncul di
// "Portable Devices" (PTP), bukan webcam. digiCamControl yang bicara ke kamera lewat USB, lalu menyediakan
// web server lokal (default http://localhost:5513). Backend POPSNAP meneruskan live view & jepretan ke layar booth,
// jadi jalan sama persis di Chrome maupun aplikasi .exe.
//
//   GET  /api/camera/dslr/status        -> { online, cameras:[nama], raw, error? }
//   GET  /api/camera/dslr/liveview.jpg  -> satu frame live view (JPEG)
//   POST /api/camera/dslr/liveview/stop -> matikan live view
//   POST /api/camera/dslr/capture       -> { image: "data:image/jpeg;base64,..." }  (resolusi penuh)
// ==========================================================
const net = require("net");
const sdkBridge = require("./sdkBridge");
const { requirePerm } = require("./auth");
const DEFAULT_HOST = "http://localhost:5513";

// Web server digiCamControl (HttpListener .NET) mengirim header yang tidak rapi (mis. Content-Length ganda).
// Chrome mentolerirnya, tapi parser HTTP Node menolak (HPE_UNEXPECTED_CONTENT_LENGTH). Jadi bicara HTTP/1.0 lewat
// socket mentah dan baca jawabannya sendiri secara longgar.
function httpGet(urlStr, timeout) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(e); }
    const host = u.hostname.replace(/^\[|\]$/g, "");
    const chunks = [];
    let settled = false;
    const sock = net.connect({ host, port: Number(u.port) || 80 });
    const finish = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); sock.destroy(); fn(v); } };
    const timer = setTimeout(() => { const e = new Error("timeout"); e.name = "AbortError"; finish(reject, e); }, timeout);
    function parse(final) {
      const buf = Buffer.concat(chunks);
      const i = buf.indexOf("\r\n\r\n");
      if (i < 0) return null;
      const head = buf.slice(0, i).toString("latin1").split("\r\n");
      const status = Number(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(head[0])?.[1] || 0);
      if (!status) return { error: new Error("balasan bukan HTTP") };
      let body = buf.slice(i + 4);
      const hv = (n) => head.slice(1).map((l) => l.split(/:\s*/)).filter((p) => p[0].toLowerCase() === n).map((p) => p.slice(1).join(":").trim());
      if (/chunked/i.test(hv("transfer-encoding").join(","))) {
        const out = []; let o = 0;
        while (o < body.length) {
          const e = body.indexOf("\r\n", o); if (e < 0) break;
          const n = parseInt(body.slice(o, e).toString("latin1"), 16); if (!n) { return { status, body: Buffer.concat(out) }; }
          if (e + 2 + n > body.length && !final) return null;
          out.push(body.slice(e + 2, e + 2 + n)); o = e + 2 + n + 2;
        }
        return final || !out.length ? { status, body: Buffer.concat(out) } : null;
      }
      const cl = hv("content-length").map(Number).find((n) => Number.isFinite(n) && n >= 0);
      if (cl !== undefined) { if (body.length >= cl) return { status, body: body.slice(0, cl) }; if (!final) return null; }
      return final ? { status, body } : null;
    }
    sock.on("connect", () => sock.write(`GET ${u.pathname}${u.search} HTTP/1.0\r\nHost: ${u.host}\r\nConnection: close\r\n\r\n`));
    sock.on("data", (c) => { chunks.push(c); const r = parse(false); if (r) r.error ? finish(reject, r.error) : finish(resolve, r); });
    sock.on("end", () => { const r = parse(true); r ? (r.error ? finish(reject, r.error) : finish(resolve, r)) : finish(reject, new Error("balasan kosong")); });
    sock.on("error", (e) => { const r = chunks.length && parse(true); r && !r.error ? finish(resolve, r) : finish(reject, e); });
  });
}

function mount(app, { settingsStore }) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const cfg = () => {
    const d = settingsStore.load().camera?.dslr ?? {};
    return { host: String(d.host || DEFAULT_HOST).replace(/\/+$/, ""), camera: String(d.camera || ""), driver: ["canon", "nikon", "sony"].includes(d.driver) ? d.driver : "digicam", model: String(d.model || ""), zModel: String(d.zModel || "") };
  };
  const q = (s) => encodeURIComponent(s);

  // Alamat bisa 127.0.0.1 (IPv4) atau localhost / [::1] (IPv6) tergantung digiCamControl -> coba semuanya, ingat yang berhasil
  let goodHost = "";
  function hostCandidates() {
    const h = cfg().host;
    const m = h.match(/^(https?:\/\/)([^:/]+|\[[^\]]+\])(:\d+)?$/);
    const list = [h];
    if (m) for (const alt of ["127.0.0.1", "localhost", "[::1]"]) { const u = `${m[1]}${alt}${m[3] || ""}`; if (!list.includes(u)) list.push(u); }
    return goodHost && list.includes(goodHost) ? [goodHost, ...list.filter((x) => x !== goodHost)] : list;
  }

  // digiCamControl memakai HttpListener yang hanya menerima Host yang cocok dengan alamat yang didaftarkannya
  // (biasanya "localhost"); permintaan ke 127.0.0.1 bisa ditolak (HTTP 400). Jadi coba beberapa bentuk alamat
  // dan ingat yang berhasil.
  let goodBase = null, goodFor = "";
  function bases() {
    const h = cfg().host;
    const list = [h, h.replace(/\/\/127\.0\.0\.1/, "//localhost"), h.replace(/\/\/localhost/, "//127.0.0.1"), h.replace(/\/\/(127\.0\.0\.1|localhost)/, "//[::1]")];
    const uniq = [...new Set(list)];
    if (goodBase && goodFor === h) return [goodBase, ...uniq.filter((x) => x !== goodBase)];
    return uniq;
  }
  async function dcc(path, { timeout = 4000, binary = false } = {}) {
    let firstErr = null;
    for (const base of bases()) {
      try {
        const res = await httpGet(`${base}${path}`, timeout);
        if (res.status < 200 || res.status >= 300) throw new Error(`digiCamControl membalas ${res.status}`);
        goodBase = base; goodFor = cfg().host;
        return binary ? res.body : res.body.toString("utf8").trim();
      } catch (err) {
        firstErr = firstErr || err;
        if (err.name === "AbortError" && goodBase === base) break; // server ada tapi lambat: jangan berputar ke alamat lain
      }
    }
    throw firstErr || new Error("digiCamControl tidak menjawab");
  }

  // Daftar kamera: format balasan digiCamControl bisa beda antar versi -> parse longgar (baris / koma / JSON).
  function parseCameras(raw) {
    if (!raw) return [];
    try {
      const j = JSON.parse(raw);
      const arr = Array.isArray(j) ? j : j.cameras ?? j.devices ?? [];
      return arr.map((x) => (typeof x === "string" ? x : x.name ?? x.Name ?? x.deviceName ?? x.DeviceName ?? "")).map((x) => String(x).trim()).filter(Boolean);
    } catch { /* bukan JSON */ }
    return raw.split(/\r?\n|,|;/).map((x) => x.replace(/^[\s\-*\d.)]+/, "").trim()).filter((x) => x && !/^(ok|error|-)$/i.test(x) && !/^<.*>$/.test(x));
  }

  // "digiCamControl Virtual Webcam" / perangkat DirectShow software (@device:sw:...) BUKAN kamera fisik — jangan dihitung sebagai kamera
  const isVirtual = (n) => /@device:sw|virtual\s*webcam|digicamcontrol\s*virtual/i.test(n);

  // Untuk halaman Pengaturan: hasil percobaan tiap bentuk alamat (membantu mencari kenapa tidak terhubung)
  async function probeAll() {
    const out = [];
    for (const base of bases()) {
      try {
        const r = await httpGet(`${base}/?slc=get&param1=lastcaptured&param2=`, 2500);
        out.push(`${base} -> HTTP ${r.status}`);
      } catch (e) { out.push(`${base} -> ${e.name === "AbortError" ? "timeout" : (e.code || e.message)}`); }
    }
    return out;
  }

  app.get("/api/camera/dslr/status", async (req, res) => {
    const c = cfg();
    if (c.driver !== "digicam") {
      const b = sdkBridge.get(c.driver, c.model);
      try { await b.ensure(c.model, c.zModel); } catch (e) { return res.json({ online: !!sdkBridge.findDir(c.driver, c.model), driver: c.driver, cameras: [], sdkError: e.message, sdk: b.status() }); }
      return res.json({ online: true, driver: c.driver, cameras: b.camera ? [b.camera] : ["(kamera)"], sdk: b.status(), fps: Date.now() - fpsT < 4000 ? fps : 0, stream: streamHealth() });
    }
    sdkBridge.stopAll(); // mode digiCamControl: pastikan program SDK tidak ikut memegang kamera
    try {
      let raw = "";
      for (const p of ["/?slc=list&param1=cameras&param2=", "/?slc=get&param1=cameras&param2="]) {
        try { raw = await dcc(p); if (raw && !/^error/i.test(raw)) break; } catch { /* coba perintah lain */ }
      }
      // server menjawab = online (walau daftar kosong)
      if (!raw) await dcc("/?slc=get&param1=lastcaptured&param2=");
      const all = parseCameras(raw);
      const cameras = all.filter((n) => !isVirtual(n));
      res.json({ online: true, host: goodHost || c.host, stream: streamHealth(), cameras, virtualOnly: all.length > 0 && cameras.length === 0, raw: raw.slice(0, 500) });
    } catch (err) {
      res.json({ online: false, host: c.host, cameras: [], tried: await probeAll(), error: err.name === "AbortError" ? "Tidak ada jawaban dari digiCamControl (timeout)." : `Tidak bisa terhubung ke ${c.host} (sudah dicoba 127.0.0.1, localhost, [::1]): ${err.cause?.code || err.message}` });
    }
  });

  // ---- Live view ----
  let lvOn = false, lvTry = 0;
  async function startLiveView() {
    if (Date.now() - lvTry < 2500) return;
    lvTry = Date.now();
    const c = cfg();
    if (c.camera) await dcc(`/?slc=set&param1=camera&param2=${q(c.camera)}`).catch(() => {});
    await dcc("/?CMD=LiveViewWnd_Show").catch(() => {});
  }
  app.get("/api/camera/dslr/liveview.jpg", async (req, res) => {
    const c0 = cfg();
    if (c0.driver !== "digicam") {
      try { const buf = await sdkBridge.get(c0.driver, c0.model).liveFrame(c0.model, c0.zModel); return res.set({ "Content-Type": "image/jpeg", "Cache-Control": "no-store" }).send(buf); }
      catch (err) { return res.status(503).json({ error: err.message }); }
    }
    try {
      if (!lvOn) { await startLiveView(); lvOn = true; }
      const buf = await dcc("/liveview.jpg", { binary: true, timeout: 3000 });
      if (buf.length < 500 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("live view belum siap");
      res.set({ "Content-Type": "image/jpeg", "Cache-Control": "no-store" }).send(buf);
    } catch (err) {
      lvOn = false; // coba nyalakan lagi di permintaan berikutnya
      res.status(503).json({ error: err.message });
    }
  });
  // Aliran video MJPEG: satu koneksi panjang, frame didorong secepat kamera menghasilkannya (jauh lebih mulus daripada
  // meminta gambar satu per satu). Browser/Electron menampilkannya langsung lewat <img src=...>.
  //  - 1 tulisan per frame (header+gambar+penutup digabung) -> tidak ada frame setengah terkirim
  //  - maks ~30 frame/detik: lebih dari itu hanya membuang CPU browser untuk menguraikan JPEG yang tak sempat tampil
  //  - klien lambat: frame dilewati (tampilan tetap "live"), tidak menumpuk
  //  - pemantau macet: kalau tidak ada frame baru beberapa detik padahal tidak sedang jepret, live view kamera dihidupkan ulang
  let fps = 0, fpsN = 0, fpsT = Date.now(); // frame/detik yang benar-benar dikirim ke layar (untuk diagnosa)
  const MIN_GAP_MS = 1000 / 30;
  const STALL_MS = 3500;
  let clients = 0, lastPutAt = 0, capturing = 0, captureEndedAt = 0, lastRecover = 0, recoveries = 0;
  const streamHealth = () => ({ clients, frameAgeMs: lastPutAt ? Date.now() - lastPutAt : null, recoveries, capturing: capturing > 0, stalled: clients > 0 && capturing === 0 && !!lastPutAt && Date.now() - lastPutAt > 6000 });
  const TAIL = Buffer.from("\r\n");
  app.get("/api/camera/dslr/stream", async (req, res) => {
    const c = cfg();
    let alive = true;
    const gone = () => { if (alive) { alive = false; clients = Math.max(0, clients - 1); } };
    clients++;
    req.on("close", gone);
    res.on("error", gone);
    let b = null;
    try { if (c.driver !== "digicam") { b = sdkBridge.get(c.driver, c.model); await b.ensure(c.model, c.zModel); } }
    catch (err) { gone(); return res.status(503).json({ error: err.message }); }
    res.writeHead(200, { "Content-Type": "multipart/x-mixed-replace; boundary=popsnapframe", "Cache-Control": "no-store", Connection: "keep-alive" });
    try { res.socket?.setNoDelay(true); } catch { /* abaikan */ }
    const startedAt = Date.now();
    let lastSent = 0;
    const put = (buf) => {
      const now = Date.now();
      if (now - lastSent < MIN_GAP_MS - 2) return;        // batas ~30 fps
      if (res.writableNeedDrain) return;                    // klien lambat: lewati frame ini
      lastSent = now; lastPutAt = now;
      fpsN++; if (now - fpsT >= 1000) { fps = Math.round((fpsN * 1000) / (now - fpsT) * 10) / 10; fpsN = 0; fpsT = now; }
      res.write(Buffer.concat([Buffer.from(`--popsnapframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`), buf, TAIL]));
    };
    let lastStart = 0;
    while (alive) {
      try {
        const now = Date.now();
        if (b) {
          if (!b.lvOn && now - lastStart > 2000 && capturing === 0) { lastStart = now; b.send("LIVEVIEW_START"); }
          const f = b.readFrameIfNew();
          if (f) put(f);
          else if (typeof b.waitFrame === "function") await b.waitFrame(100);
          else await wait(6);
          // Pemantau macet (mis. Nikon menolak live view lagi setelah jepret, atau kabel/driver tersendat sesaat)
          const ref = Math.max(b.lastFrameAt || 0, startedAt, captureEndedAt, lastRecover);
          if (capturing === 0 && Date.now() - ref > STALL_MS && Date.now() - lastRecover > STALL_MS) {
            lastRecover = Date.now(); recoveries++;
            log(`live view macet ${Math.round((Date.now() - ref) / 100) / 10} dtk tanpa frame -> hidupkan ulang (#${recoveries})`);
            b.send("LIVEVIEW_STOP"); await wait(500); if (!alive) break; b.send("LIVEVIEW_START");
          }
        } else {
          if (!lvOn) { await startLiveView(); lvOn = true; }
          const f = await dcc("/liveview.jpg", { binary: true, timeout: 3000 });
          if (f.length > 500 && f[0] === 0xff && f[1] === 0xd8) put(f);
          await wait(15);
        }
      } catch { lvOn = false; await wait(500); }
    }
    res.end();
  });

  app.post("/api/camera/dslr/liveview/stop", async (req, res) => {
    lvOn = false;
    const c0 = cfg();
    if (c0.driver !== "digicam") { sdkBridge.get(c0.driver, c0.model).send("LIVEVIEW_STOP"); return res.json({ ok: true }); }
    await dcc("/?CMD=LiveViewWnd_Hide").catch(() => {});
    res.json({ ok: true });
  });

  // ---- Jepret (satu per satu) ----
  const log = (...a) => console.log("[dslr]", ...a);
  const lastCaptured = () => dcc("/?slc=get&param1=lastcaptured&param2=").catch(() => "");

  // Satu kali percobaan jepret: perintah capture -> tunggu nama file baru -> unduh JPEG
  async function shoot(waitMs) {
    const c = cfg();
    const before = await lastCaptured();
    // sama seperti tombol Capture di halaman web digiCamControl; kalau nama kamera diisi di pengaturan, pakai perintah per-kamera
    const cmd = c.camera ? `/?slc=capture&camera=${q(c.camera)}&param1=&param2=` : "/?CMD=Capture";
    const ans = await dcc(cmd, { timeout: 15000 });
    log("capture ->", JSON.stringify(ans).slice(0, 120), "| sebelumnya:", before);
    if (/^error/i.test(ans)) throw new Error(ans);
    const t0 = Date.now();
    let name = "";
    while (Date.now() - t0 < waitMs) {
      await wait(400);
      const now = await lastCaptured();
      if (now && now !== "-" && now !== before && !/^error/i.test(now)) { name = now; break; }
    }
    if (!name) throw new Error("Foto tidak muncul dari kamera (timeout). Cek kamera menyala, mode M/foto, dan fokus berhasil.");
    log("file baru:", name);
    if (!/\.(jpe?g)$/i.test(name)) throw new Error(`Kamera menyimpan ${name} — atur kualitas foto ke JPEG (bukan RAW saja).`);
    for (let i = 0; i < 8; i++) {
      try { const b = await dcc(`/image/${q(name)}`, { binary: true, timeout: 15000 }); if (b.length > 1000) return b; } catch (e) { log("unduh gagal:", e.message); }
      await wait(500);
    }
    throw new Error("Gagal mengambil file foto dari digiCamControl.");
  }

  // Setelan kamera (menu Tools > Setelan Kamera): baca / ubah ISO, shutter, aperture, white balance lewat program perantara Canon/Nikon
  const nativeFor = () => {
    const c = cfg();
    if (c.driver === "digicam") return { err: "Setelan kamera hanya untuk mode Canon / Nikon langsung (bukan digiCamControl)." };
    const b = sdkBridge.get(c.driver, c.model);
    if (!b.native) return { err: "Setelan kamera butuh program perantara popsnap_canon_bridge.exe / popsnap_nikon_bridge.exe terbaru (belum ada di backend\\sdk)." };
    return { b, c };
  };
  app.get("/api/camera/exposure", requirePerm("settings.manage"), async (req, res) => {
    const n = nativeFor(); if (n.err) return res.status(400).json({ error: n.err });
    try { const info = await n.b.camInfo(n.c.model); if (info?.error) return res.status(502).json({ error: info.error }); res.json(info); }
    catch (e) { res.status(502).json({ error: e.message }); }
  });
  app.post("/api/camera/exposure", requirePerm("settings.manage"), async (req, res) => {
    const n = nativeFor(); if (n.err) return res.status(400).json({ error: n.err });
    const { prop, value } = req.body || {};
    try {
      const r = await n.b.camSet(n.c.model, String(prop || ""), String(value ?? ""));
      if (!r.ok) return res.status(502).json({ error: r.error || "Ditolak kamera", info: r.info || null });
      res.json({ ok: true, info: r.info });
    } catch (e) { res.status(502).json({ error: e.message }); }
  });

  let busy = Promise.resolve();
  app.post("/api/camera/dslr/capture", (req, res) => {
    capturing++; // selama jepret live view memang berhenti: pemantau macet jangan ikut campur
    const job = busy.then(async () => {
      let buf;
      const c0 = cfg();
      if (c0.driver !== "digicam") {
        buf = await sdkBridge.get(c0.driver, c0.model).capture(c0.model, c0.zModel);
        return `data:image/jpeg;base64,${buf.toString("base64")}`;
      }
      try {
        buf = await shoot(12000);
      } catch (err) {
        // Beberapa kamera (mis. Canon seri lama) menolak jepret saat jendela live view terbuka: tutup live view, coba sekali lagi
        log("percobaan 1 gagal:", err.message, "-> coba lagi tanpa live view");
        await dcc("/?CMD=LiveViewWnd_Hide").catch(() => {});
        await wait(1200);
        buf = await shoot(20000);
      }
      lvOn = false; // live view berhenti saat jepret -> nyalakan lagi otomatis
      return `data:image/jpeg;base64,${buf.toString("base64")}`;
    });
    busy = job.catch(() => {});
    job.finally(() => { capturing = Math.max(0, capturing - 1); captureEndedAt = Date.now(); }).catch(() => {});
    job.then((image) => res.json({ image })).catch((err) => { log("jepret gagal:", err.message); res.status(502).json({ error: err.message || "Gagal jepret." }); });
  });
}

module.exports = { mount };
