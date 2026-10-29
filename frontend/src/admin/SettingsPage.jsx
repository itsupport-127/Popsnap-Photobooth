import React, { useEffect, useRef, useState } from "react";
import { getAdminSettings, getStoreSettings, saveAdminSettings, saveStoreSettings } from "../services/settingsService";
import { useOverview } from "./AdminApp";
import { Btn, Notice, Page, useSavedFlag } from "./ui";
import { Icon } from "./editorKit";
import SettingsGeneral from "./settings/SettingsGeneral";
import SettingsCamera from "./settings/SettingsCamera";
import SettingsDisplay from "./settings/SettingsDisplay";
import SettingsFilters from "./settings/SettingsFilters";
import SettingsMedia from "./settings/SettingsMedia";
import SettingsPrinting from "./settings/SettingsPrinting";

const TABS = [
  ["general", "Umum", "gear"],
  ["camera", "Kamera", "camera"],
  ["display", "Tampilan", "image"],
  ["filters", "Filter", "star"],
  ["media", "GIF & Video", "ticket"],
  ["printing", "Cetak", "printer"],
];

export default function SettingsPage() {
  const { refresh, overview } = useOverview();
  const [tab, setTab] = useState("general");
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
    if (pin.value && pin.value.length < 4) { setTab("general"); return setError("PIN minimal 4 angka."); }
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
        <h1 className="text-xl text-[#181B23]">Pengaturan</h1>
        <div className="flex gap-1 mt-3">
          {TABS.map(([id, label, icon]) => (
            <button key={id} onClick={() => setTab(id)} className={`flex flex-col items-center gap-1 px-5 py-2 text-[12px] border-b-2 ${tab === id ? "border-[#4082AE] text-[#181B23]" : "border-transparent text-[#55606E] hover:text-[#181B23]"}`}>
              <Icon name={icon} size={22} /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-5 flex flex-col gap-4">
        {error && <Notice tone="error">{error}</Notice>}
        {tab === "general" && <SettingsGeneral s={s} set={set} pin={pin} setPin={setPin} outputDir={overview?.system?.outputDir} />}
        {tab === "camera" && <SettingsCamera s={s} set={set} />}
        {tab === "display" && <SettingsDisplay s={s} set={set} setError={setError} />}
        {tab === "filters" && <SettingsFilters s={s} set={set} />}
        {tab === "media" && <SettingsMedia s={s} set={set} />}
        {tab === "printing" && <SettingsPrinting s={s} set={set} />}
        {tab === "general" && (
          <div className="grid grid-cols-[210px_1fr] gap-x-4 items-center">
            <div className="text-[13px] text-[#181B23] text-right">Nama toko / studio</div>
            <input className="bg-[#F4F7FA] border border-[#C7D0DA] text-[#181B23] px-2 py-1 text-[13px] max-w-md outline-none focus:border-[#4082AE]" value={storeName} onChange={(e) => setStoreName(e.target.value)} />
          </div>
        )}
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
