import React, { useEffect, useRef, useState } from "react";
import { getAdminSettings, getStoreSettings, saveAdminSettings, saveStoreSettings } from "../services/settingsService";
import { useOverview } from "./AdminApp";
import { Btn, Card, Notice, Page, useSavedFlag } from "./ui";
import { Row } from "./settings/controls";
import { Icon } from "./editorKit";
import SettingsGeneral from "./settings/SettingsGeneral";
import SettingsCamera from "./settings/SettingsCamera";
import SettingsDisplay from "./settings/SettingsDisplay";
import SettingsFilters from "./settings/SettingsFilters";
import SettingsMedia from "./settings/SettingsMedia";
import SettingsPrinting from "./settings/SettingsPrinting";

// Pengelompokan menurut urutan yang dilihat tamu. Tiap item = kartu pengaturan dari satu komponen (nilai yang tersimpan tidak berubah).
const COMP = { general: SettingsGeneral, camera: SettingsCamera, display: SettingsDisplay, filters: SettingsFilters, media: SettingsMedia, printing: SettingsPrinting };
const GROUPS = [
  { id: "booth", label: "Booth & Event", icon: "gear", desc: "Nama studio, event, mode booth, PIN, keyboard, folder data, dan tombol kunci.",
    items: [["store"], ["general", ["EVENT", "BOOTH MODE", "KEYBOARD & PIN", "DIRECTORIES"]], ["display", ["TOMBOL KUNCI (GEMBOK → PIN)"]]] },
  { id: "tampilan", label: "Tampilan & Layar Awal", icon: "image", desc: "Layar penuh, warna, gambar layar Start, dan pilihan template.",
    items: [["display", ["LAYAR PENUH & WARNA", "START SCREEN"]]] },
  { id: "pengingat", label: "Pengingat & Izin", icon: "ticket", desc: "Disclaimer, izin foto, dan layar pengingat sebelum sesi foto.",
    items: [["general", ["DISCLAIMER", "IZIN FOTO (SOSMED & DIPAJANG DI TOKO)"]], ["display", ["REMINDER SCREEN"]]] },
  { id: "sesi", label: "Sesi Foto", icon: "camera", desc: "Jumlah foto, retake, hitung mundur, mode ketuk, dan tampilan layar jepret.",
    items: [["general", ["ATURAN SESI FOTO"]], ["display", ["CAPTURE SCREEN"]]] },
  { id: "kamera", label: "Kamera & Live View", icon: "eye", desc: "Sumber kamera, DSLR, live view, dan profil warna.",
    items: [["camera", ["CAMERA", "KAMERA DSLR / MIRRORLESS", "LIVE VIEW"]]] },
  { id: "hasil", label: "Hasil Akhir", icon: "star", desc: "Layar akhir (QR, ucapan, offline), tombol hasil, dan filter foto.",
    items: [["display", ["SHARING SCREEN"]], ["media", ["HASIL AKHIR (FOTO / LIVE / GIF)"]], ["filters", ["Filter foto"]]] },
  { id: "media", label: "GIF, Live & Video", icon: "history", desc: "Pengaturan GIF, Live (video momen), boomerang, dan video.",
    items: [["media", ["GIF", "LIVE (VIDEO MOMEN)", "BOOMERANG", "VIDEO"]]] },
  { id: "cetak", label: "Cetak", icon: "printer", desc: "Printer, ukuran kertas, dan perilaku cetak.",
    items: [["printing", ["CETAK (PRINTING)", "PERILAKU CETAK"]]] },
];

export default function SettingsPage() {
  const { refresh, overview } = useOverview();
  const [tab, setTab] = useState("booth");
  const [q, setQ] = useState("");
  const bodyRef = useRef(null);
  const [s, setS] = useState(null);
  const original = useRef(null);
  const [storeName, setStoreName] = useState("");
  const [pin, setPin] = useState({ value: "", clear: false });
  const [saved, flash] = useSavedFlag();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const d = await getAdminSettings();
    if (d) { setS(d); original.current = JSON.stringify(d); }
  };
  useEffect(() => {
    load();
    getStoreSettings().then((d) => d && setStoreName(d.storeName ?? d.store_name ?? "")).catch(() => {});
  }, []);

  // Pencarian: saat ada kata kunci, semua kelompok tampil berurutan lalu baris/kartu yang tidak cocok disembunyikan.
  // Judul/keterangan kartu cocok -> seluruh kartu tampil; selain itu hanya baris yang cocok.
  useEffect(() => {
    const root = bodyRef.current; if (!root) return;
    const needle = q.trim().toLowerCase();
    const words = needle.split(/\s+/).filter(Boolean);
    const match = (text) => { const t = text.toLowerCase(); return words.every((w) => t.includes(w)); };
    root.querySelectorAll("[data-group]").forEach((g) => {
      let groupHits = 0;
      const order = (g.dataset.order || "").split("||"); // urutan kartu sesuai daftar kelompok, bukan urutan file
      g.querySelectorAll("[data-card]").forEach((card) => {
        const head = card.firstElementChild?.matches("div") && card.querySelector("h2") ? card.querySelector("h2").parentElement.textContent : "";
        const title = card.querySelector("h2")?.textContent ?? "";
        const oi = order.indexOf(title); if (oi >= 0) card.style.order = String(oi + 1);
        const rows = [...card.querySelectorAll("[data-row]")];
        let any = false;
        if (!words.length) { rows.forEach((r) => { r.style.display = ""; }); card.style.display = ""; return; }
        const headHit = match(head);
        rows.forEach((r) => { const label = r.firstElementChild?.textContent || ""; const hint = r.querySelector(":scope > div:last-child > p:last-child")?.textContent || ""; const hit = headHit || match(label + " " + hint); r.style.display = hit ? "" : "none"; any = any || hit; });
        const show = headHit || any;
        card.style.display = show ? "" : "none";
        if (show) groupHits++;
      });
      g.style.display = !words.length || groupHits ? "" : "none";
    });
    const none = root.querySelector("[data-nohits]");
    if (none) none.style.display = words.length && ![...root.querySelectorAll("[data-group]")].some((g) => g.style.display !== "none") ? "" : "none";
  });

  if (!s) return <Page title="Pengaturan"><p className="text-[#6B7684] text-[13px]">Memuat...</p></Page>;

  const set = (path, value) => setS((prev) => {
    const next = JSON.parse(JSON.stringify(prev));
    let o = next;
    for (const k of path.slice(0, -1)) o = o[k];
    o[path[path.length - 1]] = value;
    return next;
  });
  const dirty = JSON.stringify(s) !== original.current || pin.value !== "" || pin.clear;

  async function save() {
    setError(null);
    if (pin.value && pin.value.length < 4) { setTab("booth"); setQ(""); return setError("PIN minimal 4 angka."); }
    setBusy(true);
    try {
      const security = pin.clear ? { clearPin: true } : pin.value ? { pin: pin.value } : undefined;
      const body = {
        event: s.event, editor: s.editor, camera: s.camera, printing: s.printing, display: s.display, session: s.session, gif: s.gif, result: s.result, boomerang: s.boomerang, video: s.video, animated: s.animated,
        general: { modes: s.general.modes, dataDir: s.general.dataDir ?? "", virtualKeyboard: s.general.virtualKeyboard, disclaimer: s.general.disclaimer, consent: s.general.consent, export: s.general.export, ...(security ? { security } : {}) },
      };
      const res = await saveAdminSettings(body);
      if (res) { setS(res); original.current = JSON.stringify(res); }
      await saveStoreSettings({ storeName });
      setPin({ value: "", clear: false });
      refresh();
      flash();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  function discard() { setS(JSON.parse(original.current)); setPin({ value: "", clear: false }); setError(null); }

  return (
    <div className="pb-24">
      <div className="sticky top-0 z-10 bg-[#F4F7FA] border-b border-[#D5DCE4] px-6 pt-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-xl text-[#181B23]">Pengaturan</h1>
          <div className="relative w-full max-w-sm">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari pengaturan… (mis. countdown, printer, voucher)" aria-label="Cari pengaturan"
              className="w-full bg-white border border-[#C7D0DA] text-[#181B23] rounded-full pl-4 pr-9 py-1.5 text-[13px] outline-none focus:border-[#4082AE]" />
            {q && <button onClick={() => setQ("")} aria-label="Hapus pencarian" className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6B7684] hover:text-[#181B23] text-[16px] leading-none px-1">×</button>}
          </div>
        </div>
        <div className="flex gap-1 mt-3 overflow-x-auto">
          {GROUPS.map((g) => (
            <button key={g.id} onClick={() => { setTab(g.id); setQ(""); }} className={`flex flex-col items-center gap-1 px-4 py-2 text-[12px] border-b-2 whitespace-nowrap ${!q && tab === g.id ? "border-[#4082AE] text-[#181B23]" : "border-transparent text-[#55606E] hover:text-[#181B23]"}`}>
              <Icon name={g.icon} size={22} /> {g.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={bodyRef} className="max-w-5xl mx-auto px-6 py-5 flex flex-col gap-4">
        {error && <Notice tone="error">{error}</Notice>}
        {(q.trim() ? GROUPS : GROUPS.filter((g) => g.id === tab)).map((g) => (
          <div key={g.id} data-group data-order={g.items.flatMap(([c, cards]) => (c === "store" ? ["NAMA TOKO / STUDIO"] : cards)).join("||")} className="flex flex-col gap-4">
            <div>
              <h2 className="text-[16px] text-[#181B23] font-bold">{g.label}</h2>
              <p className="text-[12px] text-[#6B7684]">{g.desc}</p>
            </div>
            {g.items.map(([c, cards], i) => {
              if (c === "store") {
                return (
                  <Card key={i} title="NAMA TOKO / STUDIO">
                    <Row label="Nama toko / studio"><input className="bg-[#F4F7FA] border border-[#C7D0DA] text-[#181B23] px-2 py-1 text-[13px] max-w-md w-full outline-none focus:border-[#4082AE]" value={storeName} onChange={(e) => setStoreName(e.target.value)} /></Row>
                  </Card>
                );
              }
              const C = COMP[c];
              const extra = c === "general" ? { pin, setPin, outputDir: overview?.system?.outputDir } : c === "display" ? { setError } : {};
              return <C key={i} s={s} set={set} only={cards} {...extra} />;
            })}
          </div>
        ))}
        <p data-nohits style={{ display: "none" }} className="text-[13px] text-[#6B7684]">Tidak ada pengaturan yang cocok dengan “{q}”.</p>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-[#FFFFFF] border-t border-[#D5DCE4] px-6 py-3 flex items-center justify-end gap-3 z-20">
        {saved && <span className="text-emerald-600 text-[13px]">Tersimpan ✓</span>}
        {dirty && !saved && <span className="text-amber-600 text-[13px]">Ada perubahan yang belum disimpan</span>}
        <Btn onClick={discard} disabled={!dirty || busy}>Cancel</Btn>
        <Btn variant="primary" onClick={save} disabled={!dirty || busy}>{busy ? "Menyimpan..." : "Save"}</Btn>
      </div>
    </div>
  );
}
