import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createUser, deleteUser, getPermissionCatalog, listUsers, saveRoleDefaults, updateUser } from "../services/authService";
import { Field, Modal, inputCls } from "./editorKit";
import { Btn, Card, Notice, Page, useSavedFlag } from "./ui";

const ROLE_LABEL = { superadmin: "Super Admin", admin: "Admin", cashier: "Kasir" };
const ROLE_DESC = {
  superadmin: "Selalu punya semua hak. Satu-satunya yang bisa mengelola pengguna.",
  admin: "Pengelola booth. Hak default-nya bisa diatur di tab Hak Akses Peran.",
  cashier: "Petugas kasir (CS). Hak default-nya bisa diatur di tab Hak Akses Peran.",
};
const sameSet = (a = [], b = []) => a.length === b.length && a.every((x) => b.includes(x));

function fmt(iso) {
  if (!iso) return "Belum pernah";
  return new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function UsersPage({ user: me }) {
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState([]);
  const [catalog, setCatalog] = useState(null);
  const [editing, setEditing] = useState(null); // null | "new" | user
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [u, c] = await Promise.all([listUsers(), getPermissionCatalog()]);
      if (u) setUsers(u);
      if (c) setCatalog(c);
    } catch (err) { setError(err.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function remove(u) {
    if (!confirm(`Hapus akun "${u.username}"? Ini tidak bisa dibatalkan.`)) return;
    try { await deleteUser(u.id); load(); } catch (err) { alert(err.message); }
  }

  return (
    <Page
      title="Pengguna & Hak Akses"
      subtitle="Hanya Super Admin yang bisa membuka halaman ini. Atur siapa boleh melakukan apa."
      right={tab === "users" && <Btn variant="primary" onClick={() => setEditing("new")} disabled={!catalog}>+ Tambah Pengguna</Btn>}
    >
      <div className="flex gap-1 border-b border-[#D5DCE4]">
        {[["users", "Pengguna"], ["roles", "Hak Akses Peran"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-4 py-2 text-[13px] border-b-2 ${tab === id ? "border-[#4082AE] text-[#181B23]" : "border-transparent text-[#55606E] hover:text-[#181B23]"}`}>{label}</button>
        ))}
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      {tab === "users" && catalog && (
        <Card>
          <table className="w-full text-[13px]">
            <thead className="text-left text-[#6B7684] text-[12px]">
              <tr><th className="pb-2">Username</th><th>Peran</th><th>Hak akses</th><th>Status</th><th>Login terakhir</th><th /></tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const defaults = u.role === "superadmin" ? null : catalog.roleDefaults[u.role];
                return (
                  <tr key={u.id} className="border-t border-[#D5DCE4]">
                    <td className="py-2 text-[#181B23]">{u.username}{u.id === me.id && <span className="text-[#6B7684]"> (kamu)</span>}</td>
                    <td>{ROLE_LABEL[u.role]}</td>
                    <td className="text-[#55606E]">
                      {u.role === "superadmin" ? "Semua" : u.customPermissions ? <span className="text-amber-600">Khusus ({u.permissions.length})</span> : `Ikut peran (${defaults?.length ?? 0})`}
                    </td>
                    <td className={u.active ? "text-emerald-600" : "text-red-600"}>{u.active ? "Aktif" : "Nonaktif"}</td>
                    <td className="text-[#55606E]">{fmt(u.lastLoginAt)}</td>
                    <td className="text-right whitespace-nowrap">
                      <button onClick={() => setEditing(u)} className="text-[#4082AE] hover:text-[#4082AE] text-[12px] mr-3">Edit</button>
                      {u.id !== me.id && <button onClick={() => remove(u)} className="text-red-600 hover:text-red-600 text-[12px]">Hapus</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "roles" && catalog && <RolesTab catalog={catalog} onSaved={load} />}

      {editing && catalog && <UserModal catalog={catalog} target={editing === "new" ? null : editing} isSelf={editing !== "new" && editing.id === me.id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </Page>
  );
}

// ---------- Tab: hak akses default tiap peran ----------
function RolesTab({ catalog, onSaved }) {
  const [draft, setDraft] = useState(catalog.roleDefaults);
  const [saved, flash] = useSavedFlag();
  const [error, setError] = useState(null);
  const groups = useMemo(() => [...new Set(catalog.permissions.map((p) => p.group))], [catalog]);
  const dirty = !sameSet(draft.admin, catalog.roleDefaults.admin) || !sameSet(draft.cashier, catalog.roleDefaults.cashier);

  const toggle = (role, perm) => setDraft((d) => ({ ...d, [role]: d[role].includes(perm) ? d[role].filter((x) => x !== perm) : [...d[role], perm] }));

  async function save() {
    setError(null);
    try { await saveRoleDefaults(draft); await onSaved(); flash(); } catch (err) { setError(err.message); }
  }

  return (
    <Card title="APA YANG BOLEH DILAKUKAN TIAP PERAN" hint="Berlaku untuk semua akun dengan peran itu, kecuali akun yang diberi hak khusus. Perubahan langsung berlaku, tanpa login ulang.">
      <table className="w-full text-[13px]">
        <thead className="text-left text-[#6B7684] text-[12px]">
          <tr><th className="pb-2">Fitur</th><th className="w-24 text-center">Super Admin</th><th className="w-24 text-center">Admin</th><th className="w-24 text-center">Kasir</th></tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <React.Fragment key={g}>
              <tr><td colSpan={4} className="pt-3 pb-1 text-[11px] uppercase tracking-wider text-[#6B7684]">{g}</td></tr>
              {catalog.permissions.filter((p) => p.group === g).map((p) => (
                <tr key={p.id} className="border-t border-[#D5DCE4]">
                  <td className="py-2 pr-4"><div className="text-[#181B23]">{p.label}</div><div className="text-[12px] text-[#6B7684]">{p.desc}</div></td>
                  <td className="text-center text-emerald-600">✓</td>
                  {["admin", "cashier"].map((role) => (
                    <td key={role} className="text-center">
                      {p.locked ? <span className="text-[#55606E]">—</span> : <input type="checkbox" checked={draft[role].includes(p.id)} onChange={() => toggle(role, p.id)} />}
                    </td>
                  ))}
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-3 mt-4">
        <Btn variant="primary" onClick={save} disabled={!dirty}>Simpan Hak Akses Peran</Btn>
        {saved && <span className="text-emerald-600 text-[13px]">Tersimpan ✓</span>}
        {error && <span className="text-red-600 text-[13px]">{error}</span>}
      </div>
    </Card>
  );
}

// ---------- Modal tambah / edit pengguna ----------
function UserModal({ catalog, target, isSelf, onClose, onSaved }) {
  const isNew = !target;
  const [username, setUsername] = useState(target?.username ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(target?.role ?? "cashier");
  const [active, setActive] = useState(target?.active ?? true);
  const [custom, setCustom] = useState(!!target?.customPermissions);
  const [perms, setPerms] = useState(target?.customPermissions ?? catalog.roleDefaults[target?.role ?? "cashier"] ?? []);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const grantable = catalog.permissions.filter((p) => !p.locked);
  const groups = [...new Set(grantable.map((p) => p.group))];
  const isSuper = role === "superadmin";

  function changeRole(r) {
    setRole(r);
    if (r !== "superadmin") setPerms(catalog.roleDefaults[r] ?? []);
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const customPermissions = isSuper || !custom ? null : perms;
      if (isNew) {
        await createUser({ username, password, role, customPermissions: customPermissions ?? undefined });
      } else {
        const body = { username, ...(password ? { password } : {}) };
        if (!isSelf) Object.assign(body, { role, active, customPermissions });
        await updateUser(target.id, body);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={isNew ? "Tambah Pengguna" : `Edit: ${target.username}`} onClose={onClose} width="w-[620px]">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Username"><input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" /></Field>
          <Field label={isNew ? "Password (min. 6 karakter)" : "Reset password (kosongkan jika tidak diganti)"}>
            <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
        </div>
        {!isNew && password && <p className="text-[12px] text-amber-600">Mengganti password akan mengeluarkan akun ini dari semua perangkat.</p>}

        <Field label="Peran">
          <select className={inputCls} value={role} disabled={isSelf} onChange={(e) => changeRole(e.target.value)}>
            {Object.entries(ROLE_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </Field>
        <p className="text-[12px] text-[#6B7684] -mt-1">{ROLE_DESC[role]}</p>
        {isSelf && <Notice tone="info">Ini akunmu sendiri: peran, status, dan hak akses tidak bisa diubah di sini. Ganti username atau password-mu lewat "Akun Saya".</Notice>}
        {role === "superadmin" && !isSelf && isNew && <Notice tone="warn">Super Admin bisa mengelola semua pengguna dan hak akses. Berikan hanya ke orang yang benar-benar dipercaya.</Notice>}

        {!isSuper && (
          <div className="border border-[#C7D0DA] p-3">
            <div className="flex gap-6 mb-3 text-[13px]">
              <label className="flex items-center gap-2"><input type="radio" disabled={isSelf} checked={!custom} onChange={() => { setCustom(false); setPerms(catalog.roleDefaults[role] ?? []); }} /> Ikuti hak akses peran {ROLE_LABEL[role]}</label>
              <label className="flex items-center gap-2"><input type="radio" disabled={isSelf} checked={custom} onChange={() => setCustom(true)} /> Atur khusus untuk akun ini</label>
            </div>
            {groups.map((g) => (
              <div key={g} className="mb-2">
                <div className="text-[11px] uppercase tracking-wider text-[#6B7684] mb-1">{g}</div>
                {grantable.filter((p) => p.group === g).map((p) => (
                  <label key={p.id} className={`flex items-start gap-2 py-1 ${custom && !isSelf ? "" : "opacity-60"}`}>
                    <input type="checkbox" className="mt-1" disabled={!custom || isSelf} checked={perms.includes(p.id)} onChange={() => setPerms((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]))} />
                    <span><span className="text-[13px] text-[#181B23]">{p.label}</span><span className="block text-[12px] text-[#6B7684]">{p.desc}</span></span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}

        {!isNew && !isSelf && (
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Akun aktif <span className="text-[#6B7684]">(nonaktif = tidak bisa login dan langsung dikeluarkan)</span></label>
        )}

        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex justify-end gap-2 pt-1">
          <Btn onClick={onClose}>Batal</Btn>
          <Btn variant="primary" onClick={submit} disabled={busy}>{busy ? "Menyimpan..." : isNew ? "Buat Akun" : "Simpan"}</Btn>
        </div>
      </div>
    </Modal>
  );
}
