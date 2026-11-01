import React from "react";
import { NumInput } from "../editorKit";
import { Card, Notice } from "../ui";
import { Check, Row, Select } from "./controls";

const N = ({ value, min, onCommit }) => <div className="w-28"><NumInput value={value} min={min} onCommit={(v) => onCommit(Math.round(v))} /></div>;

export default function SettingsMedia({ s, set, only }) {
  const vis = (t) => !only || only.includes(t); // tampilkan hanya kartu yang diminta halaman Pengaturan (pengelompokan baru)
  const g = s.gif, b = s.boomerang, v = s.video, a = s.animated, r = s.result ?? { live: true, gif: true, defaultView: "photo", gifStyle: "template", gifHoldMs: 1800 };
  const F = ({ value, min, step = 0.5, onCommit }) => <div className="w-28"><NumInput value={value} min={min} step={step} onCommit={onCommit} /></div>;
  return (
    <>
      {vis("HASIL AKHIR (FOTO / LIVE / GIF)") && (
      <Card title="HASIL AKHIR (FOTO / LIVE / GIF)" hint="Tombol di bawah template pada layar hasil. Foto selalu ada. Yang dimatikan tidak dibuat, jadi sesi lebih cepat.">
        <Row label="Foto"><Check checked disabled onChange={() => {}} label="Selalu aktif" /></Row>
        <Row label="Live"><Check checked={r.live} onChange={(x) => set(["result", "live"], x)} label="Video momen bergerak di tiap slot template" /></Row>
        <Row label="GIF"><Check checked={r.gif} onChange={(x) => set(["result", "gif"], x)} label="GIF stop-motion: foto muncul satu per satu" /></Row>
        <Row label="Tampilan awal"><Select value={r.defaultView} onChange={(x) => set(["result", "defaultView"], x)} options={[["photo", "Foto"], ["live", "Live"], ["gif", "GIF"]]} /></Row>
        <Row label="Gaya GIF"><Select value={r.gifStyle} onChange={(x) => set(["result", "gifStyle"], x)} options={[["template", "Di dalam template"], ["plain", "Polos (foto saja)"], ["both", "Keduanya"]]} /></Row>
        <Row label="Tahan hasil akhir (ms)" hint="0–6000. Lama frame terakhir GIF di dalam template."><N value={r.gifHoldMs} min={0} onCommit={(x) => set(["result", "gifHoldMs"], x)} /></Row>
        <Notice tone="info">Jeda antar foto dan lebar GIF memakai kartu GIF di bawah. Kalau tampilan awal tidak tersedia, yang dibuka adalah Foto.</Notice>
      </Card>)}
      {vis("GIF") && (
      <Card title="GIF" hint="Berlaku untuk mode GIF dan GIF dari foto sesi. Hitung mundur mengikuti Sesi Foto → Capture Screen.">
        <Row label="Jumlah foto (frame)" hint="Hanya untuk mode GIF (2–12)."><N value={g.frames} min={2} onCommit={(x) => set(["gif", "frames"], x)} /></Row>
        <Row label="Jeda antar frame (ms)" hint="100–3000. Makin kecil makin cepat."><N value={g.frameDelayMs} min={100} onCommit={(x) => set(["gif", "frameDelayMs"], x)} /></Row>
        <Row label="Lebar GIF (px)" hint="240–1200. Makin besar makin tajam tapi file lebih berat."><N value={g.width} min={240} onCommit={(x) => set(["gif", "width"], x)} /></Row>
      </Card>)}
      {vis("LIVE (VIDEO MOMEN)") && (
      <Card title="LIVE (VIDEO MOMEN)" hint="Dinyalakan di kartu Hasil Akhir. Tiap foto merekam klip singkat sebelum & sesudah jepret; hasilnya video Live (momen bergerak di tiap slot template) + klip mentah per foto.">
        <Row label="Sebelum jepret (detik)" hint="0–5. Momen bersiap sebelum rana."><F value={a.secondsBefore} min={0} onCommit={(x) => set(["animated", "secondsBefore"], x)} /></Row>
        <Row label="Sesudah jepret (detik)" hint="0–4. Reaksi setelah rana."><F value={a.secondsAfter} min={0} onCommit={(x) => set(["animated", "secondsAfter"], x)} /></Row>
        <Row label="Frame per detik" hint="5–15"><N value={a.fps} min={5} onCommit={(x) => set(["animated", "fps"], x)} /></Row>
        <Row label="Pola putar"><Select value={a.loop} onChange={(x) => set(["animated", "loop"], x)} options={[["pingpong", "Maju-mundur (mulus)"], ["loop", "Ulang dari awal"]]} /></Row>
        <Row label="Lebar GIF template (px)" hint="240–800"><N value={a.gifWidth} min={240} onCommit={(x) => set(["animated", "gifWidth"], x)} /></Row>
        <Row label="Video MP4 template"><Check checked={a.templateMp4} onChange={(x) => set(["animated", "templateMp4"], x)} label="Buat juga MP4 (lebih tajam & ringan; hanya jika browser mendukung)" /></Row>
        <Row label="Klip mentah per foto"><Check checked={a.rawClips} onChange={(x) => set(["animated", "rawClips"], x)} label="Sertakan klip tiap foto" /></Row>
        <Row label="Format klip mentah"><Select value={a.rawFormat} onChange={(x) => set(["animated", "rawFormat"], x)} options={[["mp4", "MP4 (GIF jika tidak didukung)"], ["gif", "GIF"]]} /></Row>
        <Row label="Lebar klip mentah (px)" hint="240–1280"><N value={a.clipWidth} min={240} onCommit={(x) => set(["animated", "clipWidth"], x)} /></Row>
        <Notice tone="info">Klip mengikuti pilihan Mirror & Filter tamu. Untuk kamera DSLR, klip diambil dari live view yang tampil di layar.</Notice>
      </Card>)}
      {vis("BOOMERANG") && (
      <Card title="BOOMERANG" hint="Merekam gerakan singkat, diputar maju lalu mundur berulang. Hasilnya berupa GIF loop (bukan MP4).">
        <Row label="Durasi rekam (detik)" hint="1–6"><N value={b.seconds} min={1} onCommit={(x) => set(["boomerang", "seconds"], x)} /></Row>
        <Row label="Frame per detik" hint="5–15"><N value={b.fps} min={5} onCommit={(x) => set(["boomerang", "fps"], x)} /></Row>
        <Row label="Lebar (px)" hint="240–800"><N value={b.width} min={240} onCommit={(x) => set(["boomerang", "width"], x)} /></Row>
      </Card>)}
      {vis("VIDEO") && (
      <Card title="VIDEO">
        <Row label="Durasi maksimal (detik)" hint="3–120. Tamu bisa menekan Stop lebih awal."><N value={v.seconds} min={3} onCommit={(x) => set(["video", "seconds"], x)} /></Row>
        <Row label="Rekam suara"><Check checked={v.audio} onChange={(x) => set(["video", "audio"], x)} label="Ikut rekam audio dari mikrofon (pilih perangkat di Kamera & Live View)" /></Row>
        <Notice tone="info">Satu klip per sesi. Format MP4 jika browser mendukung, selain itu WebM. Rotasi live view tidak diterapkan ke video.</Notice>
      </Card>)}
    </>
  );
}
