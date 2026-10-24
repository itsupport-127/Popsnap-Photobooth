import Backdrop from "../components/Backdrop";
import logo from "../assets/logo-popsnap.png";
import React, { useEffect, useState } from "react";
import { getAuthStatus, setupFirstAdmin, login } from "../services/authService";

/**
 * Halaman ini otomatis nampilin salah satu dari 2 mode:
 * - SETUP WIZARD: kalau PC ini belum pernah di-setup sama sekali (belum ada
 *   akun admin). Cuma muncul SEKALI seumur hidup instalasi.
 * - LOGIN biasa: kalau sudah ada akun, buat admin/kasir masuk tiap mau pakai.
 */
export default function LoginScreen({ onAuthenticated }) {
  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [storeName, setStoreName] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getAuthStatus()
      .then((status) => {
        setNeedsSetup(status.needsSetup);
        setChecking(false);
      })
      .catch(() => {
        setError("Gagal terhubung ke backend. Pastikan backend sudah jalan (npm start di folder backend).");
        setChecking(false);
      });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = needsSetup
        ? await setupFirstAdmin({ username, password, storeName })
        : await login(username, password);
      onAuthenticated(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="kiosk-root h-screen w-screen flex items-center justify-center">
        <Backdrop />
        <p className="relative z-10 font-bold italic">Memeriksa status...</p>
      </div>
    );
  }

  return (
    <div className="kiosk-root h-screen w-screen flex flex-col items-center justify-center p-4 overflow-y-auto">
      <Backdrop />
      <img src={logo} alt="PopSnap" draggable={false} className="relative z-10 w-[min(260px,60vw)] h-auto mb-4 select-none" />
      <form onSubmit={handleSubmit} className="modal-card relative z-10 p-6 sm:p-8 w-full max-w-sm flex flex-col gap-4">
        <h1 className="display-h3 text-center">
          {needsSetup ? "Setup Akun Super Admin" : "Login Admin / Kasir"}
        </h1>
        {needsSetup && (
          <p className="text-xs sm:text-sm text-[#6B7684] text-center -mt-2">
            Ini cuma muncul sekali di awal. Akun ini adalah Super Admin: satu-satunya yang bisa membuat akun lain dan mengatur hak akses.
          </p>
        )}

        {needsSetup && (
          <label className="flex flex-col gap-1 text-sm">
            Nama Toko
            <input type="text" value={storeName} onChange={(e) => setStoreName(e.target.value)}
              placeholder="Misal: POPSNAP Malioboro" className="border-2 border-[#C7D0DA] focus:border-[#4082AE] outline-none rounded-xl px-3 py-2" />
          </label>
        )}

        <label className="flex flex-col gap-1 text-sm">
          Username
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
            required className="border-2 border-[#C7D0DA] focus:border-[#4082AE] outline-none rounded-xl px-3 py-2" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Password {needsSetup && <span className="text-[#55606E]">(min. 6 karakter)</span>}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            required minLength={needsSetup ? 6 : undefined} className="border-2 border-[#C7D0DA] focus:border-[#4082AE] outline-none rounded-xl px-3 py-2" />
        </label>

        {error && <p className="text-[#E02843] font-bold text-sm">{error}</p>}

        <button type="submit" disabled={loading}
          className="btn-pop btn-flash mt-2 px-6 py-3">
          {loading ? "Memproses..." : needsSetup ? "Buat Akun & Masuk" : "Masuk"}
        </button>
      </form>
    </div>
  );
}
