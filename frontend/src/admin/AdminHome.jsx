import React from "react";
import { Link } from "react-router-dom";
import { useOverview } from "./AdminApp";
import { can } from "../services/authService";
import PaymentModeCard from "./PaymentModeCard";
import { Icon } from "./editorKit";
import { Page } from "./ui";

const TILES = [
  { to: "/admin/template", icon: "image", title: "Edit Template", desc: "Desain template: ukuran kertas, slot foto, teks, shape.", perm: ["template.manage"] },
  { to: "/admin/stickers", icon: "sticker", title: "Stiker", desc: "Unggah stiker untuk layar Add sticker, atur kategorinya.", perm: ["template.manage"] },
  { to: "/admin/voucher", icon: "ticket", title: "Voucher Kasir", desc: "Buat kode voucher setelah pelanggan bayar di kasir.", perm: ["voucher.manage"] },
  { to: "/admin/payment", icon: "wallet", title: "Pembayaran", desc: "Mode bayar, payment gateway, integrasi aplikasi kasir.", perm: ["payment.mode", "payment.gateway"] },
  { to: "/admin/settings", icon: "gear", title: "Pengaturan Umum", desc: "Nama event, kamera, timer sesi, jumlah foto.", perm: ["settings.manage"] },
  { to: "/admin/tools", icon: "wrench", title: "Tools", desc: "Info sistem dan pembersihan file.", perm: ["tools.maintenance"] },
  { to: "/admin/users", icon: "user", title: "Pengguna & Hak Akses", desc: "Buat akun, atur peran, dan hak akses tiap orang.", perm: ["users.manage"] },
  { to: "/admin/activity", icon: "history", title: "Log Aktivitas", desc: "Riwayat siapa mengubah apa dan kapan.", perm: ["activity.view"] },
  { to: "/admin/help", icon: "help", title: "Bantuan", desc: "Panduan singkat pemakaian booth.", perm: [] },
];

function Stat({ label, value }) {
  return (
    <div className="bg-white border border-[#D5DCE4] rounded-[20px] px-4 py-3 shadow-[0_2px_10px_rgba(24,27,35,0.06)]">
      <div className="eyebrow !text-[#55606E] !text-[11px]">{label}</div>
      <div className="font-display text-3xl text-[#181B23] mt-1">{value ?? "—"}</div>
    </div>
  );
}

export default function AdminHome({ user }) {
  const { overview } = useOverview();
  const t = overview?.today;
  const rupiah = (n) => `Rp ${Number(n || 0).toLocaleString("id-ID")}`;

  return (
    <Page title={`Halo, ${user.username}`} subtitle="Pilih menu yang mau dibuka. Menu yang tampil sesuai hak akses akunmu.">
      {t && (
        <div className="grid grid-cols-4 gap-3">
          <Stat label="Sesi foto hari ini" value={t.sessions} />
          <Stat label="Voucher dibuat hari ini" value={t.vouchersCreated} />
          <Stat label="Voucher terpakai hari ini" value={t.vouchersUsed} />
          <Stat label="QRIS masuk hari ini" value={rupiah(t.qrisRevenue)} />
        </div>
      )}

      <PaymentModeCard canEdit={can(user, "payment.mode")} />

      <div className="grid grid-cols-3 gap-3">
        {TILES.filter((x) => x.perm.length === 0 || can(user, ...x.perm)).map((x) => (
          <Link key={x.to} to={x.to} className="bg-white border border-[#D5DCE4] rounded-[20px] hover:border-[#4082AE] hover:shadow-pop transition-shadow p-4 flex gap-3">
            <Icon name={x.icon} size={30} className="text-[#E02843] flex-shrink-0" />
            <div>
              <div className="text-[15px] font-extrabold italic text-[#181B23]">{x.title}</div>
              <p className="text-[12px] text-[#55606E] mt-1">{x.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </Page>
  );
}
