import React, { useState } from "react";
import { updateMyAccount } from "../services/authService";
import { Field, inputCls } from "./editorKit";
import { Btn, Card, Notice, Page } from "./ui";

const ROLE_LABEL = { superadmin: "Super Admin", admin: "Admin", cashier: "Kasir" };

/** Semua akun boleh mengganti username & password-nya sendiri (wajib memasukkan password saat ini). */
export default function AccountPage({ user, onUserChange }) {
  const [username, setUsername] = useState(user.username);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setMsg(null);
    if (newPassword && newPassword !== confirmPassword) return setMsg({ tone: "error", text: "Konfirmasi password baru tidak sama." });
    if (username.trim() === user.username && !newPassword) return setMsg({ tone: "info", text: "Tidak ada yang diubah." });
    setBusy(true);
    try {
      const updated = await updateMyAccount({ currentPassword, username: username.trim(), newPassword: newPassword || undefined });
      onUserChange(updated);
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setMsg({ tone: "ok", text: newPassword ? "Tersimpan. Sesi di perangkat lain otomatis keluar." : "Tersimpan." });
    } catch (err) {
      setMsg({ tone: "error", text: err.message });
    } finally { setBusy(false); }
  }

  return (
    <Page title="Akun Saya" subtitle={`Peran: ${ROLE_LABEL[user.role]}`}>
      <Card title="DATA LOGIN">
        <div className="grid grid-cols-2 gap-3 max-w-2xl">
          <Field label="Username" className="col-span-2"><input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" /></Field>
          <Field label="Password baru (kosongkan jika tidak diganti)"><input className={inputCls} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Ulangi password baru"><input className={inputCls} type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Password saat ini (wajib, untuk konfirmasi)" className="col-span-2"><input className={inputCls} type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" onKeyDown={(e) => e.key === "Enter" && save()} /></Field>
        </div>
        {msg && <div className="mt-3 max-w-2xl"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
        <div className="mt-4"><Btn variant="primary" onClick={save} disabled={busy || !currentPassword}>{busy ? "Menyimpan..." : "Simpan"}</Btn></div>
      </Card>
      <Card title="HAK AKSES AKUNMU">
        <p className="text-[13px] text-[#262A38]">{user.permissions.length} hak aktif. Hak akses diatur oleh Super Admin; hubungi Super Admin jika butuh akses tambahan.</p>
      </Card>
    </Page>
  );
}
