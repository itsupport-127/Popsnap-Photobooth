import React, { useState } from "react";
import { Link } from "react-router-dom";
import { cleanupOrphanedFiles } from "../services/templateService";
import { useOverview } from "./AdminApp";
import { Btn, Card, Page, StatusDot } from "./ui";
import { useKiosk } from "../hooks/useKiosk";
import appConfig from "../config/appConfig";

export default function ToolsPage() {
  const { overview } = useOverview();
  const sys = overview?.system;
  const [cleanMsg, setCleanMsg] = useState(null);
  const kiosk = useKiosk();
  // Tutup aplikasi selalu lewat PIN (walau sudah login admin); tanpa PIN terpasang cukup konfirmasi
  function quitApp() {
    if (appConfig.settings?.general?.pinSet) kiosk.requestUnlock(() => window.electronAPI.kiosk.quit(), "PIN untuk menutup aplikasi");
    else if (confirm("Tutup aplikasi POPSNAP sekarang?")) window.electronAPI.kiosk.quit();
  }

  async function cleanup() {
    if (!confirm("Bersihkan file yang sudah tidak dipakai template mana pun? Jalankan saat tidak ada pelanggan yang sedang sesi foto.")) return;
    try { const r = await cleanupOrphanedFiles(); setCleanMsg(`Selesai — ${r.deletedCount} file tidak terpakai dibersihkan.`); }
    catch (err) { setCleanMsg(err.message); }
  }

  return (
    <Page title="Tools">
      <Card title="INFO SISTEM">
        <div className="grid grid-cols-2 gap-y-2 text-[13px]">
          <span className="text-[#55606E]">Internet</span><span><StatusDot on={!!overview?.payment?.online} label={overview?.payment?.online ? "Tersambung" : `Terputus${overview?.payment?.onlineReason ? " (" + overview.payment.onlineReason + ")" : ""}`} /></span>
          <span className="text-[#55606E]">Alamat backend (LAN)</span><span className="text-[#181B23]">{sys ? `http://${sys.publicHost}:${sys.port}` : "—"}</span>
          <span className="text-[#55606E]">Retensi foto</span><span className="text-[#181B23]">{sys ? `${sys.retentionDays} hari` : "—"}</span>
          <span className="text-[#55606E]">Folder arsip foto</span><span className="text-[#181B23] break-all">{sys?.outputDir || "—"}</span>
        </div>
      </Card>

      <Card title="SETELAN KAMERA" hint="Atur ISO, shutter, aperture, dan white balance kamera Canon/Nikon langsung dari sini, plus wizard flash dan foto tes (seperti dslrBooth).">
        <Link to="/admin/tools/camera" className="inline-block px-4 py-2 text-[13px] font-bold italic rounded-full bg-white hover:bg-[#F4F7FA] text-[#181B23] border border-[#C7D0DA]">Buka Setelan Kamera</Link>
      </Card>

      {window.electronAPI?.kiosk && (
        <Card title="APLIKASI DESKTOP" hint="Di aplikasi desktop, tombol tutup jendela dan Alt+F4 dikunci supaya tamu tidak bisa menutup booth. Keluar lewat sini.">
          <Btn variant="danger" onClick={quitApp}>Keluar dari Aplikasi</Btn>
        </Card>
      )}

      <Card title="PEMBERSIHAN" hint="Menghapus file gambar template yang tidak lagi dipakai.">
        <Btn onClick={cleanup}>Bersihkan File Tidak Terpakai</Btn>
        {cleanMsg && <p className="text-[13px] text-[#262A38] mt-3">{cleanMsg}</p>}
      </Card>
    </Page>
  );
}
