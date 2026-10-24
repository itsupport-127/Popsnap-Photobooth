import React, { useCallback, useEffect, useRef, useState } from "react";
import { getActivity, getActivityMeta } from "../services/settingsService";
import { inputCls } from "./editorKit";
import { chooseSaveTarget } from "./saveFile";
import { Btn, Card, Notice, Page } from "./ui";

const ACTIONS = {
  "auth.login": ["Login", "ok"],
  "auth.login_failed": ["Login gagal", "bad"],
  "auth.logout": ["Logout", ""],
  "auth.setup": ["Setup awal", "ok"],
  "account.update": ["Ubah akun sendiri", ""],
  "user.create": ["Buat akun", "ok"],
  "user.update": ["Ubah akun", "warn"],
  "user.delete": ["Hapus akun", "bad"],
  "role.update": ["Ubah hak akses peran", "warn"],
  "settings.update": ["Ubah pengaturan", "warn"],
  "payment.mode": ["Ganti mode pembayaran", "warn"],
  "pos.key_regenerate": ["Buat ulang API key kasir", "warn"],
  "template.create": ["Buat template", "ok"],
  "template.update": ["Simpan template", ""],
  "template.delete": ["Hapus template", "bad"],
  "template.import": ["Impor template", "ok"],
  "template.export": ["Ekspor template", ""],
  "template.print_test": ["Cetak tes template", ""],
  "files.cleanup": ["Bersihkan file", ""],
  "voucher.create": ["Buat voucher", "ok"],
  "voucher.void": ["Batalkan voucher", "bad"],
  "voucher.used": ["Voucher dipakai", ""],
  "voucher.rate_limited": ["Input voucher diblokir", "bad"],
  "kiosk.unlock": ["Layar penuh dibuka (PIN)", "warn"],
  "kiosk.pin_failed": ["PIN layar penuh salah", "bad"],
  "template.favorite": ["Tandai template favorit", ""],
  "template.unfavorite": ["Lepas template favorit", ""],
  "settings.upload": ["Unggah gambar pengaturan", ""],
};
const TONE = { ok: "text-emerald-600", warn: "text-amber-600", bad: "text-red-600", "": "text-[#181B23]" };

const CATEGORIES = [
  ["", "Semua aktivitas"], ["auth", "Login & logout"], ["account", "Akun sendiri"], ["user", "Pengguna"], ["role", "Hak akses peran"],
  ["settings", "Pengaturan"], ["payment", "Mode pembayaran"], ["pos", "Integrasi kasir"], ["template", "Template"], ["voucher", "Voucher"], ["files", "File"], ["kiosk", "Layar penuh / PIN"],
];

const PATHS = {
  "event.name": "Nama event", "event.subtitle": "Subjudul", "camera.mode": "Sumber kamera", "session.totalShots": "Jumlah foto", "session.maxRetakes": "Batas retake",
  "payment.mode": "Mode pembayaran", "general.security.pinHash": "PIN layar penuh", "general.security.pinSalt": "PIN layar penuh", "payment.voucherExpiryHours": "Masa berlaku voucher (jam)", "payment.qris.simulate": "Simulasi QRIS",
  "payment.qris.midtrans.serverKey": "Midtrans server key", "payment.qris.midtrans.clientKey": "Midtrans client key", "payment.qris.midtrans.isProduction": "Midtrans production",
  storeName: "Nama toko",
};
const pathLabel = (p) => PATHS[p] || (p.startsWith("session.timers.") ? `Timer ${p.split(".").pop()}` : p);
const val = (v) => (v === true ? "ya" : v === false ? "tidak" : v === null || v === undefined || v === "" ? "(kosong)" : Array.isArray(v) ? (v.join(", ") || "(kosong)") : String(v));

function describe(detail) {
  if (!detail) return "";
  if (Array.isArray(detail.changes)) {
    return detail.changes.map((c) => (c.secret ? `${pathLabel(c.path)} diubah` : `${pathLabel(c.path)}: ${val(c.from)} → ${val(c.to)}`)).join("; ");
  }
  return Object.entries(detail).map(([k, v]) => {
    if (v && typeof v === "object" && !Array.isArray(v) && "from" in v) return `${k}: ${val(v.from)} → ${val(v.to)}`;
    if (v && typeof v === "object" && !Array.isArray(v)) return `${k}: ${Object.entries(v).map(([a, b]) => `${a} ${val(b)}`).join(", ")}`;
    return v === true ? k : `${k}: ${val(v)}`;
  }).join("; ");
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export default function ActivityPage() {
  const [rows, setRows] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [filters, setFilters] = useState({ q: "", cat: "", user: "", from: "", to: "" });
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reqId = useRef(0);

  const query = useCallback((f, before) => ({
    q: f.q.trim(), cat: f.cat, user: f.user, before,
    from: f.from ? new Date(`${f.from}T00:00:00`).toISOString() : "",
    to: f.to ? new Date(`${f.to}T23:59:59.999`).toISOString() : "",
    limit: 50,
  }), []);

  const load = useCallback(async (f, before) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const data = await getActivity(query(f, before));
      if (!data || id !== reqId.current) return;
      setRows((prev) => (before ? [...prev, ...data.rows] : data.rows));
      setNextBefore(data.nextBefore);
    } catch (err) { setError(err.message); }
    finally { if (id === reqId.current) setLoading(false); }
  }, [query]);

  useEffect(() => { getActivityMeta().then((m) => m && setUsers(m.users)).catch(() => {}); }, []);
  // Filter berubah -> muat ulang dari awal (pencarian teks ditunda 300 ms supaya tidak menembak server tiap ketukan)
  useEffect(() => {
    const t = setTimeout(() => load(filters, undefined), filters.q ? 300 : 0);
    return () => clearTimeout(t);
  }, [filters, load]);

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));

  async function exportCsv() {
    const target = await chooseSaveTarget(`log-aktivitas-${new Date().toISOString().slice(0, 10)}.csv`, { description: "Log aktivitas (CSV)", mime: "text/csv", ext: ".csv", idKey: "popsnap-reports" });
    if (!target) return;
    const header = ["Waktu", "Pengguna", "Aksi", "Objek", "Rincian", "IP"];
    const lines = rows.map((r) => [fmtTime(r.at), r.username, (ACTIONS[r.action]?.[0]) || r.action, r.target, describe(r.detail), r.ip].map(csvCell).join(","));
    try {
      await target.write(new Blob(["\uFEFF" + [header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" }));
    } catch (err) { await target.discard(); setError(err.message); }
  }

  return (
    <Page
      title="Log Aktivitas"
      subtitle="Riwayat siapa melakukan apa dan kapan. Hanya bisa dibaca; password dan key rahasia tidak pernah dicatat. Dibersihkan otomatis setelah 180 hari."
      right={<div className="flex gap-2"><Btn onClick={() => load(filters, undefined)}>Muat ulang</Btn><Btn onClick={exportCsv} disabled={!rows.length}>Unduh CSV</Btn></div>}
    >
      <Card>
        <div className="grid grid-cols-5 gap-3 text-[12px]">
          <label className="flex flex-col gap-1 col-span-2 text-[#262A38]">Cari<input className={inputCls} placeholder="Nama pengguna, template, kode voucher..." value={filters.q} onChange={(e) => set({ q: e.target.value })} /></label>
          <label className="flex flex-col gap-1 text-[#262A38]">Jenis<select className={inputCls} value={filters.cat} onChange={(e) => set({ cat: e.target.value })}>{CATEGORIES.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
          <label className="flex flex-col gap-1 text-[#262A38]">Pengguna<select className={inputCls} value={filters.user} onChange={(e) => set({ user: e.target.value })}><option value="">Semua</option>{users.map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
          <div className="flex gap-2">
            <label className="flex flex-col gap-1 text-[#262A38] flex-1">Dari<input type="date" className={inputCls} value={filters.from} onChange={(e) => set({ from: e.target.value })} /></label>
            <label className="flex flex-col gap-1 text-[#262A38] flex-1">Sampai<input type="date" className={inputCls} value={filters.to} onChange={(e) => set({ to: e.target.value })} /></label>
          </div>
        </div>
      </Card>

      {error && <Notice tone="error">{error}</Notice>}

      <Card>
        <table className="w-full text-[13px]">
          <thead className="text-left text-[#6B7684] text-[12px]">
            <tr><th className="pb-2 w-[170px]">Waktu</th><th className="w-[130px]">Pengguna</th><th className="w-[170px]">Aksi</th><th>Objek &amp; rincian</th><th className="w-[110px]">IP</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const [label, tone] = ACTIONS[r.action] || [r.action, ""];
              const d = describe(r.detail);
              return (
                <tr key={r.id} className="border-t border-[#D5DCE4] align-top">
                  <td className="py-2 text-[#55606E] whitespace-nowrap">{fmtTime(r.at)}</td>
                  <td className="text-[#181B23]">{r.username || "—"}</td>
                  <td className={TONE[tone]}>{label}</td>
                  <td className="pr-3"><span className="text-[#181B23] break-words">{r.target || ""}</span>{d && <div className="text-[12px] text-[#6B7684] break-words">{d}</div>}</td>
                  <td className="text-[#6B7684]">{r.ip || "—"}</td>
                </tr>
              );
            })}
            {!rows.length && !loading && <tr><td colSpan={5} className="py-8 text-center text-[#6B7684]">Belum ada aktivitas yang cocok.</td></tr>}
          </tbody>
        </table>
        {loading && <p className="text-center text-[#6B7684] text-[12px] pt-3">Memuat...</p>}
        {nextBefore && !loading && <div className="text-center pt-3"><Btn onClick={() => load(filters, nextBefore)}>Muat lebih banyak</Btn></div>}
      </Card>
    </Page>
  );
}
