import React, { useEffect, useRef, useState } from "react";
import { NumInput } from "../editorKit";
import { Btn, Card, Notice } from "../ui";
import { Check, Range, Row, Select } from "./controls";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
const RES_LABEL = ["640×480 · frame rate tertinggi", "1280×720 (HD)", "1920×1080 (Full HD)", "3840×2160 (4K) · kualitas tertinggi"];
const RES = [[640, 480], [1280, 720], [1920, 1080], [3840, 2160]];

export default function SettingsCamera({ s, set }) {
  const c = s.camera;
  const [devices, setDevices] = useState({ video: [], audio: [] });
  const [msg, setMsg] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  async function detect() {
    setMsg(null);
    try {
      // Nama perangkat baru terbaca setelah izin kamera/mikrofon diberikan
      const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch(() => navigator.mediaDevices.getUserMedia({ video: true }));
      tmp.getTracks().forEach((t) => t.stop());
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        video: all.filter((d) => d.kind === "videoinput").map((d) => [d.deviceId, d.label || "Kamera"]),
        audio: all.filter((d) => d.kind === "audioinput").map((d) => [d.deviceId, d.label || "Mikrofon"]),
      });
    } catch (err) {
      setMsg(err.message || "Tidak bisa membaca perangkat. Izinkan akses kamera di browser.");
    }
  }
  useEffect(() => { detect(); }, []);

  // ---- DSLR / mirrorless lewat digiCamControl ----
  const [dslr, setDslr] = useState(null);   // hasil /api/camera/dslr/status
  const [dslrBusy, setDslrBusy] = useState(false);
  const [lvTest, setLvTest] = useState(false);
  const [shot, setShot] = useState(null); // hasil tes jepret: { busy } | { image } | { error }
  const [lvSrc, setLvSrc] = useState(null);
  const d = c.dslr ?? { host: "http://localhost:5513", camera: "", driver: "digicam", model: "", zModel: "" };
  async function detectDslr() {
    setDslrBusy(true);
    try { setDslr(await fetch(`${API_BASE}/api/camera/dslr/status`).then((r) => r.json())); }
    catch (err) { setDslr({ online: false, cameras: [], error: err.message }); }
    setDslrBusy(false);
  }
  useEffect(() => { if (c.mode === "dslr") detectDslr(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.mode]);
  const [lvFps, setLvFps] = useState(null);
  useEffect(() => {
    if (!lvTest) return undefined;
    setLvSrc(`${API_BASE}/api/camera/dslr/stream?t=${Date.now()}`); // aliran MJPEG, sama seperti di layar sesi foto
    let stop = false;
    (async () => {
      while (!stop) {
        await new Promise((x) => setTimeout(x, 1500));
        try { const r = await fetch(`${API_BASE}/api/camera/dslr/status`).then((x) => x.json()); if (!stop) setLvFps(r.fps ?? null); } catch { /* abaikan */ }
      }
    })();
    return () => { stop = true; setLvFps(null); fetch(`${API_BASE}/api/camera/dslr/liveview/stop`, { method: "POST" }).catch(() => {}); };
  }, [lvTest]);

  async function startPreview() {
    stopPreview();
    try {
      const [w, h] = RES[c.resolution];
      const stream = await navigator.mediaDevices.getUserMedia({ video: { ...(c.videoDeviceId ? { deviceId: { ideal: c.videoDeviceId } } : {}), width: { ideal: w }, height: { ideal: h } } });
      streamRef.current = stream;
      setPreviewing(true);
      requestAnimationFrame(() => { if (videoRef.current) videoRef.current.srcObject = stream; });
    } catch (err) { setMsg(err.message); }
  }
  function stopPreview() { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setPreviewing(false); }
  useEffect(() => stopPreview, []);

  const lv = c.liveView;
  const sideways = lv.rotation === 90 || lv.rotation === 270;

  return (
    <>
      <Card title="CAMERA">
        <Row label="Sumber kamera" hint="Webcam = kamera yang terbaca browser. DSLR / mirrorless (Canon, Nikon, dll lewat USB) memakai program digiCamControl — jalan di Chrome maupun aplikasi .exe.">
          <Select value={c.mode} onChange={(v) => set(["camera", "mode"], v)} options={[["webcam", "Webcam / kamera USB (browser)"], ["dslr", "Kamera DSLR / mirrorless (Canon, Nikon, dll via digiCamControl)"]]} className="max-w-md" />
        </Row>
        <Row label="Orientasi kamera" hint="Otomatis = ikut bentuk gambar kamera. Pilih Portrait kalau kamera dipasang tegak (gambar diputar 90° otomatis; kalau terbalik, ubah Rotation di bawah jadi 180°), atau Landscape untuk kebalikannya. Berlaku juga ke hasil foto.">
          <Select value={c.orientation ?? "auto"} onChange={(v) => set(["camera", "orientation"], v)} options={[["auto", "Otomatis (ikut gambar kamera)"], ["landscape", "Landscape (melebar)"], ["portrait", "Portrait (tegak)"]]} className="max-w-xs" />
        </Row>
        <Row label="Auto Trigger Camera"><Check checked={c.autoTrigger} onChange={(v) => set(["camera", "autoTrigger"], v)} label="Jepret otomatis saat hitung mundur selesai" hint="Kalau dimatikan, tamu harus menekan tombol rana setelah hitung mundur." /></Row>
        <Row label="Webcam Resolution" hint={RES_LABEL[c.resolution]}>
          <div className="flex items-center gap-3 pt-1.5 text-[12px] text-[#55606E]">
            Faster Framerate
            <input type="range" className="w-56" min={0} max={3} value={c.resolution} onChange={(e) => set(["camera", "resolution"], Number(e.target.value))} />
            Higher Quality
          </div>
        </Row>
        <Row label="Webcam Video Input" hint="Kosong = kamera bawaan. Nama perangkat baru terbaca setelah izin kamera diberikan.">
          <div className="flex gap-2">
            <Select value={c.videoDeviceId} onChange={(v) => set(["camera", "videoDeviceId"], v)} options={[["", "(Otomatis)"], ...devices.video]} />
            <Btn onClick={detect}>Deteksi ulang</Btn>
          </div>
        </Row>
        <Row label="Webcam Audio Input" hint="Dipakai mode Video kalau perekaman suara diaktifkan di tab GIF & Video.">
          <Select value={c.audioDeviceId} onChange={(v) => set(["camera", "audioDeviceId"], v)} options={[["", "(Otomatis)"], ...devices.audio]} />
        </Row>
        {msg && <div className="mt-2"><Notice tone="warn">{msg}</Notice></div>}
      </Card>

      {c.mode === "dslr" && (
        <Card title="KAMERA DSLR / MIRRORLESS" hint="Kamera seperti Canon EOS & Nikon muncul di Windows sebagai 'Portable Devices', jadi tidak terbaca browser. POPSNAP memakai digiCamControl (gratis) sebagai penghubung.">
          <Row label="Penghubung kamera" hint="digiCamControl = aplikasi gratis terpisah. Canon / Nikon / Sony SDK = program perantara resmi pabrikan, sudah ikut terpasang di aplikasi. Pilih lalu Simpan.">
            <Select value={d.driver ?? "digicam"} onChange={(v) => set(["camera", "dslr", "driver"], v)} options={[["digicam", "digiCamControl"], ["canon", "Canon SDK (EDSDK)"], ["nikon", "Nikon SDK"], ["sony", "Sony SDK (Camera Remote)"]]} className="max-w-xs" />
            {d.driver === "nikon" && (
              <div className="mt-2 flex gap-2 flex-wrap">
                <Select value={d.model ?? ""} onChange={(v) => set(["camera", "dslr", "model"], v)} options={[["", "(pilih model Nikon)"], ...["D500", "D5000", "D5100", "D5200", "D5300", "D5500", "D5600", "D600", "D610", "D700", "D7000", "D7100", "D7200", "D750", "D7500", "D780", "D800", "D810", "D850", "Z_SERIES"].map((m) => [m, m === "Z_SERIES" ? "Z series (Z6, Z7, ...)" : m])]} className="max-w-xs" />
                {d.model === "Z_SERIES" && <input className="px-2.5 py-1.5 border border-[#C7D0DA] rounded text-[13px] w-40" placeholder="Model Z, mis. Z6" value={d.zModel ?? ""} onChange={(e) => set(["camera", "dslr", "zModel"], e.target.value)} />}
              </div>
            )}
          </Row>
          <Row label="Status">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${dslr?.online ? "bg-[#E6F6EE] text-[#0F5C52]" : "bg-[#FDE8EA] text-[#8A1C2B]"}`}>{dslr == null ? "Memeriksa…" : dslr.driver && dslr.driver !== "digicam" ? (dslr.sdkError ? "SDK belum tersambung" : "Kamera tersambung (SDK)") : dslr.online ? "digiCamControl tersambung" : "digiCamControl tidak terdeteksi"}</span>
              <Btn onClick={detectDslr} disabled={dslrBusy}>{dslrBusy ? "Mencari…" : "Deteksi kamera"}</Btn>
            </div>
            {dslr?.sdkError && <div className="mt-2"><Notice tone="warn">{dslr.sdkError}{dslr.sdk?.lines?.length ? ` — Log: ${dslr.sdk.lines.slice(-6).join(" | ")}` : ""}</Notice></div>}
            {dslr && !dslr.online && !dslr.driver && <div className="mt-2"><Notice tone="warn">{dslr.error || "Tidak ada jawaban."} Pasang digiCamControl, jalankan, lalu aktifkan Settings › Webserver › “Use web server” (port 5513).{dslr.tried?.length ? ` Percobaan: ${dslr.tried.join(" | ")}` : ""}</Notice></div>}
          </Row>
          <Row label="Kamera yang dipakai" hint="Kosong = kamera yang sedang aktif di digiCamControl. Kalau Canon & Nikon tersambung bersamaan, pilih salah satu.">
            <div className="flex gap-2 flex-wrap">
              <Select value={d.camera} onChange={(v) => set(["camera", "dslr", "camera"], v)} options={[["", "(Otomatis)"], ...(dslr?.cameras ?? []).map((n) => [n, n]), ...(d.camera && !(dslr?.cameras ?? []).includes(d.camera) ? [[d.camera, d.camera]] : [])]} className="max-w-md" />
            </div>
            {dslr?.online && dslr.cameras.length === 0 && <div className="mt-2"><Notice tone="warn">Belum ada kamera terbaca. Nyalakan kamera, set ke mode manual/foto, sambungkan USB, lalu klik Deteksi. Terbaca di digiCamControl = terbaca di sini.{dslr.raw ? ` (balasan: ${dslr.raw.slice(0, 120)})` : ""}</Notice></div>}
          </Row>
          <Row label="Alamat digiCamControl" hint="Bawaan http://localhost:5513 (PC yang sama). Ubah hanya kalau digiCamControl ada di PC lain.">
            <input className="w-full max-w-md px-2.5 py-1.5 border border-[#C7D0DA] rounded text-[13px]" value={d.host} onChange={(e) => set(["camera", "dslr", "host"], e.target.value)} />
          </Row>
          <Row label="Uji jepret" hint="Memotret satu foto lewat digiCamControl dan menampilkannya di sini. Kalau gagal, pesan error-nya menunjukkan penyebabnya.">
            <Btn disabled={shot?.busy} onClick={async () => {
              setShot({ busy: true });
              try {
                const r = await fetch(`${API_BASE}/api/camera/dslr/capture`, { method: "POST" });
                const j = await r.json().catch(() => ({}));
                setShot(r.ok && j.image ? { image: j.image } : { error: j.error || `Gagal (HTTP ${r.status})` });
              } catch (e) { setShot({ error: `Backend tidak terjangkau: ${e.message}` }); }
            }}>{shot?.busy ? "Memotret…" : "Jepret sekarang"}</Btn>
            {shot?.error && <div className="mt-2"><Notice tone="warn">{shot.error}</Notice></div>}
            {shot?.image && <img src={shot.image} alt="hasil tes jepret" className="mt-2 max-w-[360px] max-h-[240px] border border-[#C7D0DA]" />}
          </Row>
          <Row label="Uji live view" hint="Menampilkan live view kamera lewat POPSNAP. Jendela live view digiCamControl akan terbuka di layar PC — geser ke monitor lain / minimalkan.">
            {!lvTest ? <Btn onClick={() => setLvTest(true)}>Nyalakan live view</Btn> : (
              <div>
                <div className="bg-black w-[360px] h-[240px] flex items-center justify-center overflow-hidden">
                  {lvSrc ? <img src={lvSrc} alt="live view DSLR" style={{ maxWidth: "100%", maxHeight: "100%", transform: `rotate(${lv.rotation}deg) scaleX(${lv.mirror ? -1 : 1})` }} /> : <span className="text-white/70 text-[12px]">Menunggu live view…</span>}
                </div>
                <div className="mt-2 flex items-center gap-3"><Btn onClick={() => { setLvTest(false); setLvSrc(null); }}>Matikan live view</Btn>{lvFps != null && <span className="text-[12px] text-[#55606E]">Kecepatan: <b>{lvFps}</b> frame/detik{lvFps > 0 && lvFps < 10 ? " (rendah — dari kamera/USB, bukan layar)" : ""}</span>}</div>
              </div>
            )}
          </Row>
          <Notice tone="info">Atur kualitas foto kamera ke JPEG (bukan RAW saja). Live view DSLR lewat USB sekitar 10–25 fps; foto hasil jepret tetap resolusi penuh.</Notice>
        </Card>
      )}

      <Card title="LIVE VIEW" hint="Tampilan kamera saat hitung mundur.">
        <Row label="Enable"><Check checked={lv.enabled} onChange={(v) => set(["camera", "liveView", "enabled"], v)} label="Tampilkan video pratinjau saat hitung mundur" /></Row>
        <Row label="Mirror Image"><Check checked={lv.mirror} onChange={(v) => set(["camera", "liveView", "mirror"], v)} label="Pilihan awal: Mirror (seperti cermin). Tamu bisa memilih Mirror / No Mirror sendiri saat sesi foto & di editor" /></Row>
        <Row label="Bentuk bingkai" hint="Ikut kamera: bingkai mengikuti Orientasi & Rotasi kamera, seluruh pandangan kamera tampil, bagian di luar slot digelapkan (lihat Area template). Ikut slot template: bingkai berbentuk slot foto, yang terlihat = yang tercetak (sisi yang tidak masuk slot terpotong). Penuhi area layar: kotak memakai seluruh ruang yang tersedia di layar portrait/persegi (kamera landscape dipotong di kiri-kanan; tanpa penanda area template).">
          <Select value={lv.frameMode ?? (lv.fitTemplate ? "template" : "camera")} onChange={(v) => set(["camera", "liveView", "frameMode"], v)} options={[["camera", "Ikut kamera (portrait / landscape kamera)"], ["template", "Ikut slot template (yang terlihat = yang tercetak)"], ["screen", "Penuhi area layar (layar portrait: kotak lebih tinggi)"]]} className="max-w-md" />
        </Row>
        <Row label="Live view apa adanya"><Check checked={lv.asIs === true} onChange={(v) => set(["camera", "liveView", "asIs"], v)} label="Tampilkan live view persis dari kamera (seperti dslrBooth)" hint="Mematikan gamma/kecerahan, Samakan dengan foto, dan Auto Exposure sekaligus. Gambar lebih bersih (tidak pecah/berbintik) tapi mengikuti eksposur kamera, jadi bisa gelap bila setelan untuk flash. Atur terang dengan lampu atau menu Tools → Setelan Kamera." /></Row>
        <Row label="Kecerahan live view"><div className="flex items-center gap-3 flex-wrap"><div className="w-28"><NumInput value={lv.brightness ?? 100} min={10} onCommit={(v) => set(["camera", "liveView", "brightness"], Math.round(Math.min(1000, Math.max(10, v))))} /></div><span className="text-[12px] text-[#55606E]">% (bebas, 10–1000; 100 = apa adanya). Hanya tampilan & video Live; foto tidak berubah. Rekomendasi: Canon 100 (dengan Auto Exposure aktif); Nikon 100–130 (naikkan bila masih gelap, mulai dari 120).</span></div></Row>
        <Row label="Profil warna live view" hint="Hanya tampilan (foto tidak berubah). Operasi ini tidak menguatkan noise, jadi lebih bersih daripada menaikkan kecerahan. Pakai preset sebagai titik awal, lalu sesuaikan dengan melihat live view dan hasil foto berdampingan.">
          <div className="flex items-center gap-3 flex-wrap">
            <Select value="" onChange={(v) => { const P = { d7100: [95, 120, 8], c1100: [100, 108, 4], netral: [100, 100, 0] }[v]; if (P) { set(["camera", "liveView", "contrast"], P[0]); set(["camera", "liveView", "saturation"], P[1]); set(["camera", "liveView", "warmth"], P[2]); } }} options={[["", "Preset…"], ["d7100", "Nikon D7100 (dicocokkan dengan contoh foto)"], ["c1100", "Canon EOS 1100D (perkiraan, belum ada contoh)"], ["netral", "Netral (apa adanya)"]]} className="max-w-xs" />
            <span className="text-[12px] text-[#55606E]">Kontras</span><div className="w-20"><NumInput value={lv.contrast ?? 100} min={50} onCommit={(v) => set(["camera", "liveView", "contrast"], Math.round(Math.min(160, Math.max(50, v))))} /></div>
            <span className="text-[12px] text-[#55606E]">Saturasi</span><div className="w-20"><NumInput value={lv.saturation ?? 100} min={0} onCommit={(v) => set(["camera", "liveView", "saturation"], Math.round(Math.min(200, Math.max(0, v))))} /></div>
            <span className="text-[12px] text-[#55606E]">Hangat (-30…30)</span><div className="w-20"><NumInput value={lv.warmth ?? 0} min={-30} onCommit={(v) => set(["camera", "liveView", "warmth"], Math.round(Math.min(30, Math.max(-30, v))))} /></div>
          </div>
        </Row>
        <Row label="Samakan dengan foto"><Check checked={lv.autoBright !== false} onChange={(v) => set(["camera", "liveView", "autoBright"], v)} label="Otomatis cocokkan kecerahan live view dengan hasil jepret" hint="Dihitung dari perbandingan foto dengan live view tiap kali jepret (berlaku untuk semua kamera, termasuk yang memakai flash/strobo). Makin sering jepret makin pas." /></Row>
        <Row label="Auto Exposure (Canon/Nikon)"><div className="flex items-center gap-3 flex-wrap"><Check checked={lv.canonAutoExposure !== false} onChange={(v) => set(["camera", "liveView", "canonAutoExposure"], v)} label="Terangkan live view di kamera (seperti Canon Auto Exposure di dslrBooth)" /><div className="w-20"><NumInput value={lv.canonBoost ?? 3} min={0} onCommit={(v) => set(["camera", "liveView", "canonBoost"], Math.round(Math.min(6, v)))} /></div><span className="text-[12px] text-[#55606E]">stop (0–6; 3 = 8x lebih terang)</span></div><div className="text-[12px] text-[#55606E] mt-1">Catatan: menaikkan ISO membuat live view berbintik. Kalau bisa, tambah cahaya studio dan matikan opsi ini. Selama live view, kamera menaikkan ISO / memperlambat shutter sementara supaya preview terang walau setelan foto untuk flash. Sebelum jepret setelan asli kamera dikembalikan otomatis, jadi hasil foto tidak berubah. Canon: mode Manual (M), ISO angka (bukan Auto); Nikon: hanya ISO yang dinaikkan (maks 6400), jadi pakai 2–3 stop. Perlu build ulang popsnap_canon_bridge.exe / popsnap_nikon_bridge.exe.</div></Row>
        <Row label="Area template"><Check checked={lv.guide !== false} onChange={(v) => set(["camera", "liveView", "guide"], v)} label="Gelapkan bagian kamera yang tidak masuk ke slot foto template" hint="Bagian terang = yang akan tercetak di template; bagian gelap = terpotong." /></Row>
        <Row label="Rotation" hint="Untuk kamera yang dipasang miring/portrait. Berlaku juga ke hasil foto.">
          <Select value={String(lv.rotation)} onChange={(v) => set(["camera", "liveView", "rotation"], Number(v))} options={[["0", "0 derajat"], ["90", "90 derajat"], ["180", "180 derajat"], ["270", "270 derajat"]]} className="max-w-xs" />
        </Row>
        <Row label="Display on Start Screen"><Check checked={lv.displayOnStart} onChange={(v) => set(["camera", "liveView", "displayOnStart"], v)} label="Tampilkan live view sebagai latar layar Start" hint="Kamera menyala terus selama layar Start tampil." /></Row>

        <Row label="Uji kamera" hint="Pratinjau memakai pengaturan di atas (perangkat, resolusi, mirror, rotasi) sebelum disimpan.">
          {!previewing ? <Btn onClick={startPreview}>Nyalakan pratinjau</Btn> : (
            <div>
              <div className="relative bg-black overflow-hidden w-[360px] h-[220px]" style={{ containerType: "size" }}>
                <video ref={videoRef} autoPlay playsInline muted style={{
                  position: "absolute", left: "50%", top: "50%", width: sideways ? "100cqh" : "100cqw", height: sideways ? "100cqw" : "100cqh",
                  objectFit: "cover", opacity: lv.enabled ? 1 : 0.15, transform: `translate(-50%,-50%) rotate(${lv.rotation}deg) scaleX(${lv.mirror ? -1 : 1})`,
                }} />
              </div>
              <div className="mt-2"><Btn onClick={stopPreview}>Matikan pratinjau</Btn></div>
            </div>
          )}
        </Row>
      </Card>
    </>
  );
}
