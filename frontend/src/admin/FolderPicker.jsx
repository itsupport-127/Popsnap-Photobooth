import React, { useCallback, useEffect, useState } from "react";
import { browseFolders, makeFolder } from "../services/settingsService";
import { inputCls } from "./editorKit";
import { Btn } from "./ui";

/**
 * Dialog "Pilih folder" ala jendela Open Windows. Daftar folder dibaca backend (PC booth yang sama),
 * karena browser tidak boleh memberi alamat folder lengkap. Di aplikasi desktop (Electron) dipakai dialog bawaan sistem.
 */
export default function FolderPicker({ start = "", title = "Pilih folder", onPick, onClose }) {
  const [data, setData] = useState(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState(null); // null = tidak sedang membuat folder baru

  const go = useCallback(async (dir) => {
    setBusy(true);
    setError(null);
    try {
      const d = await browseFolders(dir);
      if (d) { setData(d); setTyped(d.path); setNewName(null); }
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { go(start); }, [go, start]);

  async function createFolder() {
    const name = (newName ?? "").trim();
    if (!name || !data?.path) return;
    try {
      const r = await makeFolder(data.path, name);
      if (r?.path) go(r.path);
    } catch (err) { setError(err.message); }
  }

  const atRoot = !data?.path;
  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-[#C7D0DA] shadow-2xl w-[760px] max-w-full max-h-[90vh] flex flex-col text-[13px] text-[#181B23]" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#D5DCE4]">
          <b>{title}</b>
          <button onClick={onClose} className="text-[18px] leading-none px-2 hover:text-[#E02843]" aria-label="Tutup">×</button>
        </div>

        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#D5DCE4]">
          <button className="px-3 py-1.5 whitespace-nowrap border border-[#C7D0DA] rounded hover:bg-[#F4F7FA] disabled:opacity-40" disabled={busy || atRoot} onClick={() => go(data.parent)} title="Naik satu tingkat" aria-label="Naik satu tingkat">↑ Naik</button>
          <input className={`${inputCls} font-mono`} value={typed} placeholder="Ketik alamat folder lalu Enter, contoh D:\POPSNAP-Foto" onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(typed.trim()); }} />
          <Btn onClick={() => go(typed.trim())} disabled={busy}>Buka</Btn>
        </div>

        <div className="flex min-h-0 flex-1" style={{ height: 380 }}>
          <div className="w-[170px] flex-shrink-0 border-r border-[#D5DCE4] overflow-y-auto py-2 bg-[#F8FAFC]">
            <p className="px-3 pb-1 text-[11px] uppercase text-[#6B7684]">Pintasan</p>
            {(data?.shortcuts ?? []).map((x) => (
              <button key={x.path} onClick={() => go(x.path)} className="block w-full text-left px-3 py-1.5 hover:bg-[#E8EEF4] truncate" title={x.path}>📁 {x.label}</button>
            ))}
            <p className="px-3 pt-3 pb-1 text-[11px] uppercase text-[#6B7684]">Komputer ini</p>
            {(data?.drives ?? []).map((x) => (
              <button key={x.path} onClick={() => go(x.path)} className="block w-full text-left px-3 py-1.5 hover:bg-[#E8EEF4] truncate" title={x.path}>💽 {x.label}</button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {error && <p className="m-3 p-2 bg-[#FDECEF] text-[#B81E36] border-l-2 border-[#E02843]">{error}</p>}
            {!error && data && data.entries.length === 0 && <p className="m-4 text-[#6B7684]">Tidak ada subfolder di sini.</p>}
            {newName !== null && (
              <div className="flex items-center gap-2 px-3 py-2 border-b border-[#EEF2F6] bg-[#FFFBEA]">
                <span>📁</span>
                <input autoFocus className={inputCls} placeholder="Nama folder baru" maxLength={80} value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") setNewName(null); }} />
                <Btn variant="primary" onClick={createFolder} disabled={!newName.trim()}>Buat</Btn>
                <Btn onClick={() => setNewName(null)}>Batal</Btn>
              </div>
            )}
            {(data?.entries ?? []).map((x) => (
              <button key={x.path} onClick={() => go(x.path)} className="flex items-center gap-2 w-full text-left px-3 py-2 border-b border-[#EEF2F6] hover:bg-[#E8F1F8]" title={x.path}>
                <span>{atRoot ? "💽" : "📁"}</span><span className="truncate">{x.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[#D5DCE4]">
          <div className="min-w-0">
            <p className="text-[11px] text-[#6B7684]">Folder terpilih</p>
            <p className="font-mono truncate" title={data?.path}>{data?.path || "(pilih drive atau folder)"}</p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <Btn onClick={() => setNewName("")} disabled={atRoot || busy}>+ Folder baru</Btn>
            <Btn onClick={onClose}>Batal</Btn>
            <Btn variant="primary" onClick={() => onPick(data.path)} disabled={atRoot || busy}>Pilih folder ini</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
