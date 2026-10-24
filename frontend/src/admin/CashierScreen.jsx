import React, { useState } from "react";
import { getCurrentUser, logout, authHeader, handleAuthError } from "../services/authService";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

/**
 * Halaman khusus KASIR — akses dibatasi, cuma bisa generate kode voucher
 * buat dikasih ke konsumen yang bayar cash/EDC di kasir. Gak ada akses ke
 * Template Editor (itu cuma buat role "admin").
 */
export default function CashierScreen({ onLogout }) {
  const user = getCurrentUser();
  const [vouchers, setVouchers] = useState([]);
  const [generating, setGenerating] = useState(false);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/api/voucher/generate`, { method: "POST", headers: authHeader() });
      if (handleAuthError(res.status)) return; // paksa balik ke login kalau sesi habis
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Gagal generate voucher.");
        return;
      }
      setVouchers((prev) => [data.code, ...prev]);
    } catch (err) {
      alert("Gagal terhubung ke backend: " + err.message);
    } finally {
      setGenerating(false);
    }
  }

  function handleLogout() {
    logout();
    onLogout();
  }

  return (
    <div className="h-screen w-screen bg-[#F4F7FA] text-[#181B23] flex flex-col items-center p-6 sm:p-10 overflow-y-auto">
      <div className="w-full max-w-md flex justify-between items-center mb-8">
        <div>
          <p className="font-bold">{user?.username}</p>
          <p className="eyebrow !text-[#6B7684] !text-xs">Kasir</p>
        </div>
        <button onClick={handleLogout} className="btn-pop btn-outline !border-[#181B23] !text-[#181B23] px-4 py-2 text-sm">Keluar</button>
      </div>

      <h1 className="display-h2 mb-6">Generate Kode Voucher</h1>
      <button onClick={handleGenerate} disabled={generating}
        className="btn-pop px-10 py-4 text-lg mb-8">
        {generating ? "Membuat..." : "+ Buat Kode Baru"}
      </button>

      <div className="w-full max-w-md flex flex-col gap-2">
        {vouchers.map((code, i) => (
          <div key={i} className="bg-white border border-[#D5DCE4] rounded-[20px] px-4 py-3 flex justify-between items-center">
            <span className="font-mono text-xl tracking-widest">{code}</span>
            {i === 0 && <span className="text-xs font-bold bg-[#FFD23F] text-[#3A2E00] px-2 py-1 rounded-full">Baru</span>}
          </div>
        ))}
        {vouchers.length === 0 && <p className="text-center text-[#6B7684] text-sm">Belum ada kode dibuat sesi ini.</p>}
      </div>
    </div>
  );
}
