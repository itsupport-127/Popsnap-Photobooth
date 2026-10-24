import logo from "../assets/logo-popsnap.png";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { logout, can, refreshMe, recordLogout } from "../services/authService";
import { getOverview } from "../services/settingsService";
import TemplateSlotEditor from "./TemplateSlotEditor";
import AdminHome from "./AdminHome";
import PaymentPage from "./PaymentPage";
import VoucherPage from "./VoucherPage";
import SettingsPage from "./SettingsPage";
import ToolsPage from "./ToolsPage";
import CameraSettingsPage from "./CameraSettingsPage";
import HelpPage from "./HelpPage";
import UsersPage from "./UsersPage";
import AccountPage from "./AccountPage";
import ActivityPage from "./ActivityPage";
import StickersPage from "./StickersPage";
import { Icon } from "./editorKit";
import { StatusDot } from "./ui";

// Info ringkas (online, mode bayar, statistik hari ini) dibagi ke semua halaman admin
const OverviewContext = createContext({ overview: null, refresh: () => {} });
export const useOverview = () => useContext(OverviewContext);

export const MODE_LABEL = {
  voucher: "Voucher (bayar di kasir)",
  qris: "QRIS (payment gateway)",
  both: "Voucher + QRIS",
  auto: "Otomatis (QRIS saat online)",
};

// perm = daftar hak (cukup punya salah satu) agar menu tampil. Kosong = semua akun.
const NAV = [
  { to: "/admin/settings", icon: "gear", label: "Pengaturan", perm: ["settings.manage"] },
  { to: "/admin/template", icon: "image", label: "Template", perm: ["template.manage"] },
  { to: "/admin/stickers", icon: "sticker", label: "Stiker", perm: ["template.manage"] },
  { to: "/admin/payment", icon: "wallet", label: "Pembayaran", perm: ["payment.mode", "payment.gateway"] },
  { to: "/admin/voucher", icon: "ticket", label: "Voucher", perm: ["voucher.manage"] },
  { to: "/admin/tools", icon: "wrench", label: "Tools", perm: ["tools.maintenance"] },
  { to: "/admin/users", icon: "user", label: "Pengguna", perm: ["users.manage"] },
  { to: "/admin/activity", icon: "history", label: "Log", perm: ["activity.view"] },
  { to: "/admin/help", icon: "help", label: "Bantuan", perm: [] },
];

export default function AdminApp({ user: initialUser, onLogout }) {
  const [user, setUser] = useState(initialUser);
  const [overview, setOverview] = useState(null);
  const navigate = useNavigate();

  // Ikut menyegarkan data akun: kalau Super Admin mengubah hak aksesmu, menu ikut berubah (maks. 15 detik)
  const refresh = useCallback(() => {
    refreshMe().then((u) => u && setUser(u)).catch(() => {});
    return getOverview().then((o) => o && setOverview(o)).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  async function handleLogout() {
    await recordLogout();
    logout();
    onLogout();
  }

  // Halaman dibuka lewat URL langsung pun tetap dicek hak aksesnya (server juga menolak di sisi API)
  const guard = (el, ...perms) => (can(user, ...perms) ? el : <Navigate to="/admin" replace />);

  return (
    <OverviewContext.Provider value={{ overview, refresh }}>
      <Routes>
        {/* Template Editor punya toolbar sendiri (layar penuh), jadi tanpa header menu */}
        <Route path="template" element={guard(<TemplateSlotEditor currentUser={user} onLogout={handleLogout} />, "template.manage")} />
        <Route
          path="*"
          element={
            <div className="h-screen w-screen flex flex-col bg-[#F4F7FA] text-[#181B23] overflow-hidden">
              <header
                className="flex items-center gap-1 px-3 py-2 bg-white border-b border-[#D5DCE4] shadow-[0_2px_10px_rgba(24,27,35,0.06)] overflow-x-auto overflow-y-hidden [&>*]:shrink-0 [scrollbar-width:thin]"
                onWheel={(e) => { if (e.deltaY && !e.deltaX) e.currentTarget.scrollLeft += e.deltaY; }}
              >
                <img src={logo} alt="PopSnap" className="h-11 w-auto mr-3 select-none" draggable={false} />
                <Link to="/admin" className="flex flex-col items-center gap-1 px-3 py-1 text-[12px] text-[#262A38] hover:text-[#E02843]">
                  <Icon name="home" size={26} /> Menu
                </Link>
                {NAV.filter((n) => n.perm.length === 0 || can(user, ...n.perm)).map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    className={({ isActive }) => `flex flex-col items-center gap-1 px-3 py-1 text-[12px] hover:text-[#E02843] ${isActive ? "text-[#E02843] font-bold border-b-2 border-[#E02843]" : "text-[#262A38] border-b-2 border-transparent"}`}
                  >
                    <Icon name={n.icon} size={26} /> {n.label}
                  </NavLink>
                ))}

                <div className="ml-6 flex flex-col">
                  <span className="text-[11px] text-[#6B7684]">Event</span>
                  <span className="text-[16px] font-bold italic text-[#181B23] border border-[#C7D0DA] bg-[#F4F7FA] rounded-full px-4 py-1 min-w-[180px]">
                    {overview?.event?.name || "—"}
                  </span>
                </div>

                <div className="flex-1" />
                <div className="flex flex-col items-end gap-1 mr-4 text-[#262A38]">
                  <StatusDot on={!!overview?.payment?.online} label={overview?.payment?.online ? "Online" : "Offline"} />
                  <span className="text-[12px] text-[#55606E]">Bayar: {MODE_LABEL[overview?.payment?.mode] || "—"}</span>
                </div>
                <button onClick={() => navigate("/")} className="flex flex-col items-center gap-1 px-4 py-2 bg-[#FFD23F] text-[#3A2E00] font-bold italic border border-black/35 rounded-[20px] shadow-pop hover:brightness-95 text-[12px]">
                  <Icon name="camera" size={24} /> Buka Photo Booth
                </button>
                <Link to="/admin/account" title="Akun saya" className="flex flex-col items-center gap-1 px-3 py-1 text-[12px] text-[#262A38] hover:text-[#E02843]">
                  <Icon name="user" size={24} /> {user.username}
                </Link>
                <button onClick={handleLogout} className="flex flex-col items-center gap-1 px-3 py-1 text-[12px] text-[#262A38] hover:text-[#E02843]">
                  <Icon name="logout" size={24} /> Keluar
                </button>
              </header>

              <main className="flex-1 overflow-auto">
                <Routes>
                  <Route index element={<AdminHome user={user} />} />
                  <Route path="stickers" element={guard(<StickersPage />, "template.manage")} />
                  <Route path="payment" element={guard(<PaymentPage user={user} />, "payment.mode", "payment.gateway")} />
                  <Route path="voucher" element={guard(<VoucherPage />, "voucher.manage")} />
                  <Route path="settings" element={guard(<SettingsPage />, "settings.manage")} />
                  <Route path="tools/camera" element={guard(<CameraSettingsPage />, "settings.manage")} />
                  <Route path="tools" element={guard(<ToolsPage />, "tools.maintenance")} />
                  <Route path="users" element={guard(<UsersPage user={user} />, "users.manage")} />
                  <Route path="activity" element={guard(<ActivityPage />, "activity.view")} />
                  <Route path="account" element={<AccountPage user={user} onUserChange={setUser} />} />
                  <Route path="help" element={<HelpPage />} />
                  <Route path="*" element={<Navigate to="/admin" replace />} />
                </Routes>
              </main>
            </div>
          }
        />
      </Routes>
    </OverviewContext.Provider>
  );
}
