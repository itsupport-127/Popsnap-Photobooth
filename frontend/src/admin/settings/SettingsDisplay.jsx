import React, { useEffect, useState } from "react";
import ReminderView, { fmtReminderTimer } from "../../components/ReminderView";
import { listTemplates } from "../../services/templateService";
import { API_BASE } from "../../services/settingsService";
import { inputCls, NumInput } from "../editorKit";
import { Btn, Card, Notice } from "../ui";
import { Check, Color, ImagePicker, Range, Row, Select } from "./controls";

const LOCK_STYLES = [
  ["always", "Selalu terlihat", "Gembok tetap di pojok di semua layar (seperti dslrBooth). Seberapa jelas diatur lewat Opacity."],
  ["fade", "Muncul sebentar lalu menghilang", "Gembok tampil beberapa detik setiap pindah layar, lalu hilang. Ketuk atau seret di pojok untuk memunculkannya lagi."],
  ["hidden", "Tersembunyi", "Tidak terlihat sama sekali. Ketuk atau seret di pojok layar untuk memunculkan gembok, lalu ketuk gembok untuk membuka PIN."],
];
const CORNERS = [["top-left", "Kiri atas"], ["top-right", "Kanan atas"], ["bottom-left", "Kiri bawah"], ["bottom-right", "Kanan bawah"]];

/** Layar mini: gembok di pojok terpilih + area peka ketuk (diarsir). */
function LockPreview({ lock }) {
  const zone = Math.min(45, (lock.zoneSize / 1280) * 100 * 1.6);
  const [v, h] = lock.position.split("-");
  const place = { [v]: 0, [h]: 0 };
  const dim = lock.style === "always" ? lock.opacity / 100 : 1;
  return (
    <div className="relative w-64 aspect-video border border-[#C7D0DA] bg-gradient-to-br from-[#6DA1C7] to-[#305067] overflow-hidden">
      <div className="absolute bg-white/25 border border-dashed border-white/70" style={{ ...place, width: `${zone}%`, aspectRatio: "1/1" }} />
      <div className="absolute m-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center text-[11px]" style={{ ...place, opacity: dim }}>🔒</div>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] text-white/70">layar booth</span>
    </div>
  );
}

const abs = (u) => (u ? (u.startsWith("http") ? u : `${API_BASE}${u}`) : "");

export default function SettingsDisplay({ s, set, setError }) {
  const d = s.display;
  const ss = d.startScreen, cap = d.capture, sh = d.sharing, rm = d.reminder, lk = d.lock;
  const pinSet = s.general.security.pinSet;
  const [templates, setTemplates] = useState([]);
  useEffect(() => { listTemplates().then((t) => setTemplates(t || [])).catch(() => {}); }, []);
  const favCount = templates.filter((t) => t.favorite).length;

  const items = rm.items;
  const setItem = (i, key, value) => set(["display", "reminder", "items"], items.map((it, idx) => (idx === i ? { ...it, [key]: value } : it)));
  const previewReminder = { ...rm, backgroundImage: abs(rm.backgroundImage), logoImage: abs(rm.logoImage) };

  return (
    <>
      <Card title="OPTIONS">
        <Row label="Start App in Full Screen" hint="Aplikasi desktop (.exe) dibuka dalam layar penuh.">
          <Check checked={d.startFullscreen} onChange={(v) => set(["display", "startFullscreen"], v)} label="Buka aplikasi dalam layar penuh" />
        </Row>
        <Row label="Auto Full Screen" hint="Tekan Start atau tombol layar penuh = masuk layar penuh seperti F11. Keluar lewat ikon gembok / F11 (butuh PIN kalau diatur di tab Umum).">
          <Check checked={d.autoFullscreen} onChange={(v) => set(["display", "autoFullscreen"], v)} label="Masuk layar penuh otomatis saat Start ditekan" />
        </Row>
        <Row label="Background Color" hint="Warna latar layar-layar booth."><Color value={d.colors.background} onChange={(v) => set(["display", "colors", "background"], v)} /></Row>
        <Row label="Primary Color" hint="Tombol utama dan garis."><Color value={d.colors.primary} onChange={(v) => set(["display", "colors", "primary"], v)} /></Row>
        <Row label="Button Font Color" hint="Warna tulisan di tombol utama."><Color value={d.colors.buttonText} onChange={(v) => set(["display", "colors", "buttonText"], v)} /></Row>
        <Row label="Secondary Color" hint="Layar Start (jika tanpa gambar), tombol mode, dan gembok."><Color value={d.colors.secondary} onChange={(v) => set(["display", "colors", "secondary"], v)} /></Row>
      </Card>

      <Card title="START SCREEN">
        <Row label="Start Screen Image" hint="Latar layar Start. Tidak ditampilkan kalau live view di layar Start aktif."><ImagePicker value={ss.image} onChange={(v) => set(["display", "startScreen", "image"], v)} onError={setError} /></Row>
        <Row label="Stretch">
          <Select value={ss.stretch} onChange={(v) => set(["display", "startScreen", "stretch"], v)} className="max-w-sm"
            options={[["cover", "Stretch to Fill Screen With Cropping"], ["contain", "Fit inside screen (tanpa potong)"], ["fill", "Stretch to fill (gambar bisa melar)"], ["center", "Ukuran asli, di tengah"]]} />
        </Row>
        <Row label="Template" hint={ss.templateChoice !== "single" ? `${favCount} template Live (favorit ★) tampil di booth · ${templates.length - favCount} Draft tidak tampil. Atur di Template Editor: klik bintang ★.` : undefined}>
          <Select value={ss.templateChoice} onChange={(v) => set(["display", "startScreen", "templateChoice"], v)} className="max-w-sm"
            options={[["favorites", "Tamu memilih dari template Live (favorit ★)"], ["single", "Pakai satu template saja (tamu tidak memilih)"]]} />
          {ss.templateChoice !== "single" && templates.length > 0 && favCount === 0 && (
            <div className="mt-2"><Notice tone="warn">Belum ada template Live. Booth tidak akan menampilkan template apa pun sampai kamu menandai minimal satu template dengan bintang ★ di Template Editor.</Notice></div>
          )}
          {ss.templateChoice === "single" && (
            <select className={`${inputCls} max-w-sm mt-2`} value={ss.singleTemplateId} onChange={(e) => set(["display", "startScreen", "singleTemplateId"], e.target.value)}>
              <option value="">— pilih template —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </Row>
        <Row label="Start Session Trigger">
          <Check checked disabled label="Touch Screen / klik tombol mode" />
          <Check checked={ss.triggerKeys} onChange={(v) => set(["display", "startScreen", "triggerKeys"], v)} label="Tombol Spasi, S, Page Up, Page Down, F13" hint="Berguna untuk tombol fisik / remote presentasi." />
        </Row>
      </Card>

      <Card title="TOMBOL KUNCI (GEMBOK → PIN)" hint="Tombol untuk membuka menu admin / keluar dari layar penuh. Muncul di SEMUA layar booth, tidak hanya layar Start.">
        {!pinSet && <div className="mb-3"><Notice tone="warn">PIN belum dibuat (tab Umum → Security Pin). Tanpa PIN, siapa pun yang mengetuk gembok langsung diarahkan ke halaman login admin.</Notice></div>}
        <Row label="Posisi" hint="Pilih pojok yang paling jarang tertutup tombol lain.">
          <div className="flex items-start gap-4">
            <div className="grid grid-cols-2 gap-1.5">
              {CORNERS.map(([id, label]) => (
                <button key={id} onClick={() => set(["display", "lock", "position"], id)}
                  className={`px-3 py-2 text-[13px] border ${lk.position === id ? "border-[#4082AE] bg-[#DCEBF6] text-[#181B23]" : "border-[#C7D0DA] bg-[#F4F7FA] text-[#262A38] hover:bg-[#FFFFFF]"}`}>{label}</button>
              ))}
            </div>
            <LockPreview lock={lk} />
          </div>
        </Row>
        <Row label="Tampilan gembok">
          <div className="flex flex-col gap-1.5">
            {LOCK_STYLES.map(([id, title, desc]) => (
              <button key={id} onClick={() => set(["display", "lock", "style"], id)}
                className={`text-left px-3 py-2 border max-w-xl ${lk.style === id ? "border-[#4082AE] bg-[#DCEBF6]" : "border-[#C7D0DA] bg-[#F4F7FA] hover:bg-[#FFFFFF]"}`}>
                <div className="flex items-center gap-2 text-[13px] text-[#181B23]">
                  <span className={`w-3.5 h-3.5 rounded-full border-2 ${lk.style === id ? "border-[#4082AE] bg-[#4082AE]" : "border-[#C7D0DA]"}`} />{title}
                </div>
                <p className="text-[12px] text-[#55606E] mt-0.5 pl-[22px]">{desc}</p>
              </button>
            ))}
          </div>
        </Row>
        <Row label="Opacity" hint={lk.style === "always" ? "Seberapa jelas gembok terlihat. 5 = hampir tak terlihat, 100 = jelas." : "Hanya untuk gaya “Selalu terlihat”. Gaya lain tampil penuh saat dimunculkan."}>
          <div className={lk.style === "always" ? "" : "opacity-40 pointer-events-none"}><Range value={lk.opacity} min={5} max={100} unit="%" onChange={(v) => set(["display", "lock", "opacity"], v)} /></div>
        </Row>
        <Row label="Lama tampil" hint="Detik gembok terlihat setelah dimunculkan, sebelum hilang lagi.">
          <div className={lk.style === "always" ? "opacity-40 pointer-events-none" : ""}><Range value={lk.hideAfterSeconds} min={2} max={30} unit=" dtk" onChange={(v) => set(["display", "lock", "hideAfterSeconds"], v)} /></div>
        </Row>
        <Row label="Luas area pojok" hint="Area peka untuk mengetuk / menyeret memunculkan gembok (kotak putus-putus pada pratinjau). Tombol lain di pojok tetap bisa ditekan.">
          <div className={lk.style === "always" ? "opacity-40 pointer-events-none" : ""}><Range value={lk.zoneSize} min={60} max={240} step={4} unit=" px" onChange={(v) => set(["display", "lock", "zoneSize"], v)} /></div>
        </Row>
      </Card>

      <Card title="CAPTURE SCREEN">
        <Row label="Manual Trigger" hint="Tamu mengetuk layar atau tombol bulat untuk memotret. Hitung mundur baru dimulai setelah ketukan, dan kamera melebar penuh layar sampai foto diambil. Berlaku untuk setiap foto."><Check checked={cap.manualTrigger !== false} onChange={(v) => set(["display", "capture", "manualTrigger"], v)} label="Foto diambil setelah tamu mengetuk (bukan otomatis)" /></Row>
        <Row label="Automatic Sequence" hint="Hanya dipakai kalau Manual Trigger dimatikan: hitung mundur → jepret → tampilkan foto → foto berikutnya, tanpa menekan tombol."><Check checked={cap.autoSequence} onChange={(v) => set(["display", "capture", "autoSequence"], v)} label="Ambil foto berurutan otomatis" /></Row>
        <Row label="Countdown Before Photo 1"><div className="w-24"><NumInput value={cap.countdownFirst} min={0} onCommit={(v) => set(["display", "capture", "countdownFirst"], Math.round(v))} /></div></Row>
        <Row label="Countdown Before Photos" hint="Hitung mundur sebelum foto ke-2 dan seterusnya (detik)."><div className="w-24"><NumInput value={cap.countdownOthers} min={0} onCommit={(v) => set(["display", "capture", "countdownOthers"], Math.round(v))} /></div></Row>
        <Row label="Duration to Display Photo" hint="Detik foto ditampilkan tepat setelah diambil."><div className="w-24"><NumInput value={cap.displayPhotoSeconds} min={0} onCommit={(v) => set(["display", "capture", "displayPhotoSeconds"], Math.round(v))} /></div></Row>
        <Row label="Countdown Color"><Color value={cap.countdownColor} onChange={(v) => set(["display", "capture", "countdownColor"], v)} /></Row>
        <Row label="Crop Liveview" hint="Sesi foto sekarang menampilkan SELURUH pandangan kamera (tidak dipotong) di bingkai, lalu penuh layar saat dipotret. Opsi ini hanya berlaku untuk mode GIF / Boomerang / Video."><Check checked={cap.cropLiveview} onChange={(v) => set(["display", "capture", "cropLiveview"], v)} label="Potong live view sesuai ukuran slot foto di template" /></Row>
        <Row label="Hide Cancel Button"><Check checked={cap.hideCancel} onChange={(v) => set(["display", "capture", "hideCancel"], v)} label="Sembunyikan tombol Batal saat pengambilan foto" /></Row>
        <Row label="Show Photo Thumbnails"><Check checked={cap.showThumbnails} onChange={(v) => set(["display", "capture", "showThumbnails"], v)} label="Tampilkan thumbnail foto yang sudah diambil (tombol Retake ada di sini)" hint="Kalau dimatikan, tamu tidak bisa retake." /></Row>
        <Row label="Say Cheese Image" hint="Ditampilkan sekejap saat kamera menjepret."><ImagePicker value={cap.sayCheeseImage} onChange={(v) => set(["display", "capture", "sayCheeseImage"], v)} onError={setError} /></Row>
      </Card>

      <Card title="REMINDER SCREEN" hint="Layar pengingat setelah pembayaran dan sebelum sesi foto. Mode GIF / Boomerang / Video memakai teks bawaan sendiri.">
        <Row label="Enable"><Check checked={rm.enabled} onChange={(v) => set(["display", "reminder", "enabled"], v)} label="Tampilkan pengingat sebelum sesi dimulai" /></Row>
        <Row label="Durasi tampil" hint="Detik. Setelah habis, sesi dimulai otomatis."><div className="w-24"><NumInput value={rm.seconds} min={2} onCommit={(v) => set(["display", "reminder", "seconds"], Math.max(2, Math.min(60, Math.round(v))))} /></div></Row>
        <Row label="Skip"><Check checked={rm.skippable} onChange={(v) => set(["display", "reminder", "skippable"], v)} label="Ketuk layar = langsung mulai" /></Row>
        <Row label="Background Image" hint="Disarankan rasio sama dengan layar booth."><ImagePicker value={rm.backgroundImage} onChange={(v) => set(["display", "reminder", "backgroundImage"], v)} onError={setError} /></Row>
        <Row label="Logo" hint="Tampil di pojok kiri atas."><ImagePicker value={rm.logoImage} onChange={(v) => set(["display", "reminder", "logoImage"], v)} onError={setError} /></Row>
        <Row label="Panel Color"><Color value={rm.panelColor} onChange={(v) => set(["display", "reminder", "panelColor"], v)} /></Row>
        <Row label="Text Color"><Color value={rm.textColor} onChange={(v) => set(["display", "reminder", "textColor"], v)} /></Row>
        <Row label="Isi pengingat" hint="Maksimal 5 baris. Pakai {shots} untuk jumlah foto dan {retakes} untuk batas retake — angkanya otomatis mengikuti pengaturan sesi.">
          <div className="flex flex-col gap-2">
            {items.map((it, i) => (
              <div key={i} className="flex gap-2 items-start border border-[#C7D0DA] p-2">
                <div className="flex-1 flex flex-col gap-1">
                  <input className={inputCls} maxLength={120} placeholder="Judul (mis. bahasa Inggris)" value={it.text} onChange={(e) => setItem(i, "text", e.target.value)} />
                  <input className={inputCls} maxLength={160} placeholder="Subjudul (mis. bahasa Indonesia)" value={it.sub} onChange={(e) => setItem(i, "sub", e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Btn disabled={i === 0} onClick={() => set(["display", "reminder", "items"], items.map((x, idx, a) => (idx === i - 1 ? a[i] : idx === i ? a[i - 1] : x)))}>↑</Btn>
                  <Btn disabled={i === items.length - 1} onClick={() => set(["display", "reminder", "items"], items.map((x, idx, a) => (idx === i + 1 ? a[i] : idx === i ? a[i + 1] : x)))}>↓</Btn>
                </div>
                <Btn variant="danger" onClick={() => set(["display", "reminder", "items"], items.filter((_, idx) => idx !== i))}>Hapus</Btn>
              </div>
            ))}
            {items.length < 5 && <div><Btn onClick={() => set(["display", "reminder", "items"], [...items, { text: "", sub: "" }])}>+ Tambah baris</Btn></div>}
            {items.length === 0 && <Notice tone="warn">Belum ada baris. Layar pengingat akan kosong.</Notice>}
          </div>
        </Row>
        <Row label="Pratinjau">
          <div className="w-[520px] aspect-video border border-[#C7D0DA] overflow-hidden">
            <ReminderView reminder={previewReminder} items={items.filter((i) => i.text)} vars={{ shots: s.session.totalShots, retakes: s.session.maxRetakes }} timerText={fmtReminderTimer(previewReminder.seconds ?? 8)} />
          </div>
        </Row>
      </Card>

      <Card title="SHARING SCREEN">
        <Row label="Mode akhir sesi" hint="QR: pelanggan scan QR / ketik kode untuk mengunduh (butuh Galeri cloud). Preview saja: hanya menampilkan hasil + tombol Done + timer, tanpa QR dan tanpa unggah ke cloud (foto tetap tersimpan di PC booth, seperti dslrBooth tanpa sharing). Timer habis = kembali ke layar awal.">
          <Select value={sh.mode ?? "qr"} onChange={(v) => set(["display", "sharing", "mode"], v)} className="max-w-[280px]" options={[["qr", "QR + preview (pelanggan unduh)"], ["preview", "Preview saja (tanpa QR)"]]} />
        </Row>
        <Row label="Final Screen Timeout" hint="Detik layar hasil/QR tampil sebelum kembali ke layar Start. 0 = tidak otomatis (mode Preview saja minimal 5 detik; kalau lebih kecil otomatis jadi 30)."><div className="w-24"><NumInput value={s.session.timers.downloadQr} min={0} onCommit={(v) => set(["session", "timers", "downloadQr"], Math.round(v))} /></div></Row>
        <Row label="Mode offline" hint="Kalau internet booth mati, layar akhir otomatis tanpa QR (seperti 'Preview saja') dengan pesan di bawah. Foto tetap tersimpan, terunggah ke galeri saat internet kembali, lalu CS mengirim link lewat WhatsApp.">
          <Select value={sh.offline ?? "auto"} onChange={(v) => set(["display", "sharing", "offline"], v)} className="max-w-[320px]" options={[["auto", "Otomatis (tanpa QR saat internet mati)"], ["force", "Selalu tanpa QR (paksa offline)"], ["off", "Selalu tampilkan QR"]]} />
        </Row>
        <Row label="Pesan offline"><input className="bg-[#F4F7FA] border border-[#C7D0DA] text-[#181B23] px-2 py-1 text-[13px] w-full max-w-xl outline-none focus:border-[#4082AE]" maxLength={200} value={sh.offlineText ?? ""} onChange={(e) => set(["display", "sharing", "offlineText"], e.target.value)} /></Row>
        <Row label="Hide Done Button" hint="Kalau aktif, satu-satunya cara kembali ke awal adalah timeout (otomatis minimal 5 detik)."><Check checked={sh.hideDone} onChange={(v) => set(["display", "sharing", "hideDone"], v)} label="Sembunyikan tombol Done" /></Row>
        <Row label="Sharing Icons Location"><Select value={sh.iconsLocation} onChange={(v) => set(["display", "sharing", "iconsLocation"], v)} className="max-w-[160px]" options={[["right", "Right"], ["left", "Left"], ["bottom", "Bottom"]]} /></Row>
        <Row label="Show Text Labels"><Check checked={sh.showLabels} onChange={(v) => set(["display", "sharing", "showLabels"], v)} label="Tampilkan teks di samping QR (mis. “Scan untuk download foto”)" /></Row>
      </Card>
    </>
  );
}
