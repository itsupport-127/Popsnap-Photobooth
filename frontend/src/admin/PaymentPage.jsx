import React, { useEffect, useState } from "react";
import { API_BASE, getAdminSettings, regeneratePosApiKey, saveAdminSettings, getCloudStatus, getCloudTransactions, testCloud, syncCloudNow, testDoku, getGalleryStatus, testGallery, syncGalleryNow, getGalleryArchive, uploadGalleryArchive } from "../services/settingsService";
import { useOverview } from "./AdminApp";
import { can } from "../services/authService";
import PaymentModeCard from "./PaymentModeCard";
import { inputCls, Field, NumInput } from "./editorKit";
import { Btn, Card, Notice, Page, Toggle, useSavedFlag } from "./ui";
import { copyText } from "./clipboard";

export default function PaymentPage({ user }) {
  return (
    <Page title="Pembayaran" subtitle="Atur cara pelanggan membayar. Voucher bekerja tanpa internet; QRIS butuh internet.">
      <PaymentModeCard canEdit={can(user, "payment.mode")} />
      {can(user, "payment.gateway") ? <AdminSections /> : <Notice tone="info">Pengaturan payment gateway dan integrasi kasir membutuhkan hak "Payment gateway & integrasi kasir".</Notice>}
    </Page>
  );
}

function AdminSections() {
  const { refresh } = useOverview();
  const [s, setS] = useState(null);
  const [mt, setMt] = useState({ serverKey: "", clientKey: "", isProduction: false });
  const [simulate, setSimulate] = useState(false);
  const [provider, setProvider] = useState("midtrans");
  const [dk, setDk] = useState({ clientId: "", secretKey: "", privateKey: "", keyPassphrase: "", merchantId: "", terminalId: "", postalCode: "", isProduction: false });
  const [dkMsg, setDkMsg] = useState(null);
  const [expiry, setExpiry] = useState(24);
  const [saved, flash] = useSavedFlag();
  const [error, setError] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const [keyCopied, setKeyCopied] = useState(null);

  function apply(data) {
    setS(data);
    setMt({ serverKey: "", clientKey: data.payment.qris.midtrans.clientKey, isProduction: data.payment.qris.midtrans.isProduction });
    setSimulate(data.payment.qris.simulate);
    setProvider(data.payment.qris.provider || "midtrans");
    { const d = data.payment.qris.doku; setDk({ clientId: d.clientId, secretKey: "", privateKey: "", keyPassphrase: "", merchantId: d.merchantId, terminalId: d.terminalId, postalCode: d.postalCode, isProduction: d.isProduction }); }
    setExpiry(data.payment.voucherExpiryHours);
  }
  useEffect(() => { getAdminSettings().then((d) => d && apply(d)); }, []);

  async function save() {
    setError(null);
    try {
      const body = { payment: { voucherExpiryHours: expiry, qris: { simulate, provider, doku: { clientId: dk.clientId, merchantId: dk.merchantId, terminalId: dk.terminalId, postalCode: dk.postalCode, isProduction: dk.isProduction, ...(dk.secretKey ? { secretKey: dk.secretKey } : {}), ...(dk.privateKey ? { privateKey: dk.privateKey } : {}), ...(dk.keyPassphrase ? { keyPassphrase: dk.keyPassphrase } : {}) }, midtrans: { clientKey: mt.clientKey, isProduction: mt.isProduction, ...(mt.serverKey ? { serverKey: mt.serverKey } : {}) } } } };
      apply(await saveAdminSettings(body));
      refresh();
      flash();
    } catch (err) { setError(err.message); }
  }

  async function regenerate() {
    if (!confirm("Buat API key baru? Aplikasi kasir yang memakai key lama harus diperbarui.")) return;
    const r = await regeneratePosApiKey();
    setS((prev) => ({ ...prev, payment: { ...prev.payment, pos: { apiKey: r.apiKey } } }));
    setShowKey(true);
  }

  if (!s) return <p className="text-[#6B7684] text-[13px]">Memuat...</p>;
  const m = s.payment.qris.midtrans;
  const dd = s.payment.qris.doku;
  async function checkDoku() {
    setDkMsg(null);
    try { await save(); } catch { /* ditampilkan oleh save */ }
    const r = await testDoku().catch((e) => ({ ok: false, error: e.message }));
    setDkMsg(r?.ok ? { tone: "ok", text: `Terhubung ke DOKU (${r.env}). Token berhasil didapat; tanda tangan RSA diterima.` } : { tone: "error", text: r?.error || "Gagal terhubung." });
  }
  const apiKey = s.payment.pos.apiKey;
  const host = `${API_BASE}`;

  return (
    <>
      <Card title="PAYMENT GATEWAY (QRIS)" hint="Hanya dipakai kalau mode pembayaran mengikutsertakan QRIS.">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Provider">
            <select className={inputCls} value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="midtrans">Midtrans</option>
              <option value="doku">DOKU (QRIS SNAP)</option>
              <option disabled>Xendit (belum tersedia)</option>
            </select>
          </Field>
          {provider === "midtrans" && (<>
          <Field label="Lingkungan">
            <select className={inputCls} value={mt.isProduction ? "prod" : "sandbox"} onChange={(e) => setMt({ ...mt, isProduction: e.target.value === "prod" })}>
              <option value="sandbox">Sandbox (uji coba, uang tidak asli)</option>
              <option value="prod">Production (uang asli)</option>
            </select>
          </Field>
          <Field label={`Server key ${m.serverKeySet ? `(tersimpan: ${m.serverKey})` : "(belum diisi)"}`}>
            <input className={inputCls} type="password" autoComplete="off" placeholder={m.serverKeySet ? "Kosongkan kalau tidak diganti" : "Mid-server-..."} value={mt.serverKey} onChange={(e) => setMt({ ...mt, serverKey: e.target.value })} />
          </Field>
          <Field label="Client key">
            <input className={inputCls} autoComplete="off" placeholder="Mid-client-..." value={mt.clientKey} onChange={(e) => setMt({ ...mt, clientKey: e.target.value })} />
          </Field>
          </>)}
          {provider === "doku" && (<>
          <Field label="Lingkungan">
            <select className={inputCls} value={dk.isProduction ? "prod" : "sandbox"} onChange={(e) => setDk({ ...dk, isProduction: e.target.value === "prod" })}>
              <option value="sandbox">Sandbox (uji coba, uang tidak asli)</option>
              <option value="prod">Production (uang asli)</option>
            </select>
          </Field>
          <Field label="Client ID (X-PARTNER-ID)"><input className={inputCls} autoComplete="off" placeholder="BRN-xxxx-xxxxxxxx" value={dk.clientId} onChange={(e) => setDk({ ...dk, clientId: e.target.value })} /></Field>
          <Field label={`Secret key ${dd.secretKeySet ? `(tersimpan: ${dd.secretKey})` : "(belum diisi)"}`}>
            <input className={inputCls} type="password" autoComplete="off" placeholder={dd.secretKeySet ? "Kosongkan kalau tidak diganti" : "SK-..."} value={dk.secretKey} onChange={(e) => setDk({ ...dk, secretKey: e.target.value })} />
          </Field>
          <Field label="Merchant ID (dari DOKU setelah QRIS disetujui)"><input className={inputCls} autoComplete="off" value={dk.merchantId} onChange={(e) => setDk({ ...dk, merchantId: e.target.value })} /></Field>
          <Field label="Terminal ID (3–16 huruf/angka, bebas, mis. BOOTH1)"><input className={inputCls} maxLength={16} autoComplete="off" value={dk.terminalId} onChange={(e) => setDk({ ...dk, terminalId: e.target.value.replace(/[^A-Za-z0-9]/g, "") })} /></Field>
          <Field label="Kode pos (5 angka)"><input className={inputCls} maxLength={5} autoComplete="off" placeholder="mis. 12345" value={dk.postalCode} onChange={(e) => setDk({ ...dk, postalCode: e.target.value.replace(/\D/g, "") })} /></Field>
          <Field label={`Passphrase private key (kalau ada) ${dd.keyPassphraseSet ? "(tersimpan)" : ""}`}><input className={inputCls} type="password" autoComplete="off" placeholder={dd.keyPassphraseSet ? "Kosongkan kalau tidak diganti" : "kosongkan bila key tanpa passphrase"} value={dk.keyPassphrase} onChange={(e) => setDk({ ...dk, keyPassphrase: e.target.value })} /></Field>
          <div className="col-span-2">
            <Field label={`Private key RSA (PEM) ${dd.privateKeySet ? "— tersimpan; kosongkan kalau tidak diganti" : "— belum diisi"}`}>
              <textarea className={inputCls} rows={5} spellCheck={false} autoComplete="off" placeholder={"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"} value={dk.privateKey} onChange={(e) => setDk({ ...dk, privateKey: e.target.value })} style={{ fontFamily: "monospace", fontSize: 12 }} />
            </Field>
          </div>
          </>)}
        </div>
        {provider === "midtrans" && !m.serverKeySet && <div className="mt-3"><Notice tone="warn">Server key belum diisi di sini. Kalau key sudah ada di file .env backend, itu yang dipakai.</Notice></div>}
        {provider === "doku" && (
          <div className="mt-3 text-[12px] text-[#55606E]">
            <p>Buat sepasang kunci RSA sekali saja: <code>openssl genrsa -out private.pem 2048</code> lalu <code>openssl rsa -in private.pem -pubout -out public.pem</code>. Tempel isi <b>private.pem</b> di atas; unggah <b>public.pem</b> ke DOKU Back Office (menu SNAP / API Keys). Client ID &amp; Secret key juga dari Back Office. Merchant ID diberikan DOKU setelah pendaftaran QRIS disetujui.</p>
            <div className="flex items-center gap-2 mt-2"><Btn onClick={checkDoku}>Simpan &amp; tes koneksi DOKU</Btn></div>
            {dkMsg && <div className="mt-2"><Notice tone={dkMsg.tone}>{dkMsg.text}</Notice></div>}
          </div>
        )}
        <div className="mt-3">
          <Toggle checked={simulate} onChange={setSimulate} label="Mode simulasi QRIS (khusus testing)" hint="QRIS otomatis dianggap LUNAS dalam 6 detik tanpa uang asli. Matikan saat booth dipakai sungguhan." />
        </div>
        {simulate && <div className="mt-2"><Notice tone="error">Simulasi aktif: pelanggan bisa foto gratis lewat QRIS. Jangan dipakai di booth produksi.</Notice></div>}
      </Card>

      <Card title="VOUCHER" hint="Voucher dibuat kasir setelah pelanggan membayar tunai/transfer di kasir.">
        <div className="w-64">
          <Field label="Masa berlaku voucher (jam, 0 = tidak kedaluwarsa)">
            <NumInput value={expiry} min={0} onCommit={(v) => setExpiry(Math.round(v))} />
          </Field>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Btn variant="primary" onClick={save}>Simpan Pengaturan Pembayaran</Btn>
        {saved && <span className="text-emerald-600 text-[13px]">Tersimpan ✓</span>}
        {error && <span className="text-red-600 text-[13px]">{error}</span>}
      </div>

      <CloudCard cloud={s.payment.cloud} onSaved={apply} />
      <GalleryCard cloud={s.payment.cloud} onSaved={apply} />

      <Card title="INTEGRASI APLIKASI KASIR (POS)" hint="Supaya aplikasi kasir milikmu bisa membuat voucher otomatis begitu transaksi dibayar.">
        <Field label="API key">
          <div className="flex gap-2">
            <input readOnly className={inputCls} type={showKey ? "text" : "password"} value={apiKey} onFocus={(e) => e.target.select()} />
            <Btn onClick={() => setShowKey((v) => !v)}>{showKey ? "Sembunyi" : "Lihat"}</Btn>
            <Btn onClick={async () => { const ok = await copyText(apiKey); setKeyCopied(ok ? "ok" : "fail"); setTimeout(() => setKeyCopied(null), 1600); }}>{keyCopied === "ok" ? "Tersalin ✓" : keyCopied === "fail" ? "Gagal" : "Salin"}</Btn>
            <Btn variant="danger" onClick={regenerate}>Buat Baru</Btn>
          </div>
        </Field>
        <p className="text-[12px] text-[#55606E] mt-3">Kirim header <code className="text-[#181B23]">X-API-Key</code> di setiap permintaan. Jika <code className="text-[#181B23]">reference</code> sama dikirim dua kali (misal POS mengulang karena koneksi putus), voucher yang sama dikembalikan, bukan dibuat dobel.</p>
        <pre className="mt-2 bg-[#F4F7FA] border border-[#C7D0DA] p-3 text-[12px] text-[#262A38] overflow-x-auto whitespace-pre-wrap">{`# Buat voucher setelah transaksi dibayar di kasir
curl -X POST ${host}/api/integration/vouchers \\
  -H "X-API-Key: ${showKey ? apiKey : "<API_KEY>"}" -H "Content-Type: application/json" \\
  -d '{"reference":"INV-0001","note":"Paket 2 strip"}'
# -> {"codes":["K7M2XQ4P"],"expiresAt":"...","reused":false}

# Cek status voucher (active / used / expired / voided)
curl ${host}/api/integration/vouchers/K7M2XQ4P -H "X-API-Key: <API_KEY>"

# Batalkan voucher yang belum dipakai (misal transaksi di-refund)
curl -X POST ${host}/api/integration/vouchers/K7M2XQ4P/void -H "X-API-Key: <API_KEY>"`}</pre>
        <p className="text-[12px] text-[#6B7684] mt-2">Alamat di atas adalah alamat backend PC booth ini. Dari PC kasir lain di WiFi/LAN yang sama, ganti <code>localhost</code> dengan IP PC booth (lihat menu Tools).</p>
      </Card>
    </>
  );
}


const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "-");
const rp = (n) => `Rp ${Number(n || 0).toLocaleString("id-ID")}`;

/** Sinkron riwayat transaksi ke aplikasi kasir online. Nomor transaksi dibuat booth dan sama persis di kasir. */
function CloudCard({ cloud, onSaved }) {
  const [f, setF] = useState({ enabled: cloud.enabled, url: cloud.url, token: "", studioCode: cloud.studioCode, countVoucherRevenue: cloud.countVoucherRevenue });
  const [info, setInfo] = useState(null);
  const [rows, setRows] = useState([]);
  const [msg, setMsg] = useState(null); // { tone, text }
  const [busy, setBusy] = useState(false);

  async function reload() {
    const [st, tx] = await Promise.all([getCloudStatus().catch(() => null), getCloudTransactions(15).catch(() => null)]);
    if (st) setInfo(st);
    if (tx) setRows(tx.transactions);
    if (st?.studioCode && !f.studioCode) setF((p) => ({ ...p, studioCode: st.studioCode }));
  }
  useEffect(() => { reload(); const t = setInterval(reload, 10000); return () => clearInterval(t); }, []); // eslint-disable-line

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const { token, ...rest } = f;
      const data = await saveAdminSettings({ payment: { cloud: { ...rest, ...(token ? { token } : {}) } } });
      onSaved(data);
      setF((p) => ({ ...p, token: "" }));
      setMsg({ tone: "ok", text: "Tersimpan." });
      reload();
    } catch (err) { setMsg({ tone: "error", text: err.message }); }
    setBusy(false);
  }
  async function test() {
    setBusy(true); setMsg(null);
    const r = await testCloud().catch((e) => ({ ok: false, error: e.message }));
    setMsg(r?.ok ? { tone: "ok", text: `Terhubung ke kasir sebagai studio "${r.studio}".` } : { tone: "error", text: r?.error || "Gagal terhubung." });
    setBusy(false);
  }
  async function syncNow() {
    setBusy(true); setMsg(null);
    const r = await syncCloudNow().catch((e) => ({ ok: false, error: e.message }));
    setMsg(r?.ok ? { tone: "ok", text: r.sent ? `${r.sent} transaksi terkirim.` : "Tidak ada yang perlu dikirim." } : { tone: "error", text: r?.error || "Belum bisa mengirim." });
    if (r?.status) setInfo(r.status);
    reload();
    setBusy(false);
  }

  const STATUS = { paid: ["Lunas", "text-emerald-700"], pending: ["Menunggu", "text-[#6B7684]"], failed: ["Gagal", "text-red-600"], expired: ["Kedaluwarsa", "text-[#6B7684]"] };
  return (
    <Card title="KASIR ONLINE (SINKRON TRANSAKSI)" hint="Kirim riwayat transaksi ke aplikasi kasir. Nomor transaksi dibuat di booth dan sama persis di kasir. Booth tetap jalan tanpa internet; yang belum terkirim dikirim otomatis nanti.">
      <Toggle checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="Kirim transaksi ke kasir" />
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Field label="Alamat kasir"><input className={inputCls} placeholder="https://kasir.contoh.com" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
        <Field label={`Token studio ${cloud.tokenSet ? `(tersimpan: ${cloud.token})` : "(belum diisi)"}`}>
          <input className={inputCls} type="password" autoComplete="off" placeholder={cloud.tokenSet ? "Kosongkan kalau tidak diganti" : "pbx_..."} value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} />
        </Field>
        <Field label="Kode studio (bagian dari nomor transaksi)"><input className={inputCls} maxLength={8} placeholder="mis. EMMA" value={f.studioCode} onChange={(e) => setF({ ...f, studioCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} /></Field>
      </div>
      <p className="text-[12px] text-[#6B7684] mt-2">Token dibuat di aplikasi kasir: menu <b>Transaksi Photobox</b> &gt; tambah studio. Kode studio harus unik per studio; sesudah dipakai sebaiknya tidak diganti.</p>
      <div className="mt-3">
        <Toggle checked={f.countVoucherRevenue} onChange={(v) => setF({ ...f, countVoucherRevenue: v })} label="Hitung voucher sebagai pendapatan photobox" hint="Biarkan mati kalau pelanggan membayar voucher di kasir (pendapatannya sudah tercatat di transaksi kasir). Nyalakan hanya jika voucher dibuat tanpa transaksi kasir." />
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <Btn variant="primary" onClick={save} disabled={busy}>Simpan</Btn>
        <Btn onClick={test} disabled={busy}>Tes koneksi</Btn>
        <Btn onClick={syncNow} disabled={busy}>Kirim sekarang</Btn>
        {info && <span className="text-[12px] text-[#55606E]">Belum terkirim: <b>{info.pending}</b>{info.lastOkAt ? ` · terakhir berhasil ${fmtTime(info.lastOkAt)}` : ""}</span>}
      </div>
      {msg && <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {info?.lastError && <div className="mt-3"><Notice tone="warn">Pengiriman terakhir gagal: {info.lastError}. Akan dicoba lagi otomatis.</Notice></div>}
      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead><tr className="text-left text-[#6B7684] border-b border-[#D5DCE4]"><th className="py-1 pr-3">Nomor transaksi</th><th className="pr-3">Waktu</th><th className="pr-3">Produk</th><th className="pr-3">Bayar</th><th className="pr-3 text-right">Nominal</th><th className="pr-3">Status</th><th>Kasir</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.order_no} className="border-b border-[#EEF2F6]">
                  <td className="py-1 pr-3 font-mono">{r.order_no}</td>
                  <td className="pr-3">{fmtTime(r.created_at)}</td>
                  <td className="pr-3">{r.template_name || "-"}</td>
                  <td className="pr-3">{r.method}</td>
                  <td className="pr-3 text-right">{rp(r.amount)}</td>
                  <td className={`pr-3 font-bold ${(STATUS[r.status] || [])[1] || ""}`}>{(STATUS[r.status] || [r.status])[0]}</td>
                  <td>{r.status !== "paid" ? "-" : r.synced ? "✓ terkirim" : r.sync_error ? `⚠ ${r.sync_error}` : "menunggu"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}


/** Galeri cloud: QR membuka halaman web (hasil template di atas, foto mentah di bawah); file disimpan di cloud (R2/S3), bukan di PC booth. */
function GalleryCard({ cloud, onSaved }) {
  const [f, setF] = useState({ galleryEnabled: !!cloud.galleryEnabled, galleryUrl: cloud.galleryUrl || "" });
  const [info, setInfo] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const reload = async () => { const st = await getGalleryStatus().catch(() => null); if (st) setInfo(st); };
  useEffect(() => { reload(); const t = setInterval(reload, 8000); return () => clearInterval(t); }, []); // eslint-disable-line

  async function save() {
    setBusy(true); setMsg(null);
    try { onSaved(await saveAdminSettings({ payment: { cloud: { galleryEnabled: f.galleryEnabled, galleryUrl: f.galleryUrl } } })); setMsg({ tone: "ok", text: "Tersimpan." }); reload(); }
    catch (err) { setMsg({ tone: "error", text: err.message }); }
    setBusy(false);
  }
  async function test() {
    setBusy(true); setMsg(null);
    const r = await testGallery().catch((e) => ({ ok: false, error: e.message }));
    setMsg(r?.ok ? { tone: r.warning ? "warn" : "ok", text: r.warning || `Terhubung ke galeri sebagai studio "${r.studio}". Bucket aktif: ${r.buckets}. File disimpan ${r.retentionDays} hari.` } : { tone: "error", text: r?.error || "Gagal terhubung." });
    setBusy(false);
  }
  async function syncNow() {
    setBusy(true); setMsg(null);
    const r = await syncGalleryNow().catch((e) => ({ ok: false, error: e.message }));
    setMsg(r?.ok ? { tone: "ok", text: r.sent ? `${r.sent} sesi diproses.` : "Tidak ada yang perlu diunggah." } : { tone: "error", text: r?.error || "Belum bisa mengunggah." });
    reload(); setBusy(false);
  }
  return (
    <Card title="GALERI CLOUD (QR KE WEBSITE)" hint="QR di layar hasil membuka halaman web POPSNAP: hasil template di atas, foto mentah & klip di bawah. File disimpan di cloud (bukan di PC booth), dikirim di latar belakang & dilanjutkan otomatis kalau internet putus.">
      <Toggle checked={f.galleryEnabled} onChange={(v) => setF({ ...f, galleryEnabled: v })} label="Pakai galeri cloud untuk QR download" />
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Field label="Alamat galeri"><input className={inputCls} placeholder="https://foto.domainanda.com" value={f.galleryUrl} onChange={(e) => setF({ ...f, galleryUrl: e.target.value })} /></Field>
      </div>
      <p className="text-[12px] text-[#6B7684] mt-2">Memakai <b>token studio</b> yang sama dengan kartu "Kasir Online" di atas (isi dulu token itu). Bucket cloud &amp; masa simpan file diatur di halaman admin galeri (<code>/admin</code>). Kalau dimatikan, QR kembali ke alamat lokal PC booth (hanya terbuka dari WiFi yang sama).</p>
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <Btn variant="primary" onClick={save} disabled={busy}>Simpan</Btn>
        <Btn onClick={test} disabled={busy}>Tes koneksi</Btn>
        <Btn onClick={syncNow} disabled={busy}>Unggah sekarang</Btn>
        {info && <span className="text-[12px] text-[#55606E]">Sesi diproses: <b>{info.activeSessions}</b> · file terunggah: <b>{info.filesUploaded}</b>{info.lastOkAt ? ` · terakhir berhasil ${fmtTime(info.lastOkAt)}` : ""}</span>}
      </div>
      {msg && <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {info?.lastError && <div className="mt-3"><Notice tone="warn">Unggahan terakhir gagal: {info.lastError}. Dicoba lagi otomatis.</Notice></div>}
      <GalleryArchive ready={!!cloud.galleryEnabled && !!cloud.galleryUrl} />
    </Card>
  );
}

const ST = { none: ["Belum diunggah", "text-[#6B7684]"], queued: ["Mengunggah…", "text-amber-700"], partial: ["Sebagian", "text-amber-700"], done: ["✓ Sudah di galeri", "text-emerald-700"] };
/** Unggah manual dari arsip lokal (folder output) ke galeri: cadangan kalau internet booth bermasalah. Pelanggan langsung bisa membuka link-nya. */
function GalleryArchive({ ready }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [days, setDays] = useState(7);
  const [msg, setMsg] = useState(null);
  const [copied, setCopied] = useState(null);
  const load = async () => { const r = await getGalleryArchive(days).catch((e) => { setMsg({ tone: "error", text: e.message }); return null; }); if (r) setRows(r.sessions); };
  useEffect(() => { if (!open) return undefined; load(); const t = setInterval(load, 6000); return () => clearInterval(t); }, [open, days]); // eslint-disable-line
  async function up(r, redo = false) {
    setMsg(null);
    try { await uploadGalleryArchive(r.date, r.id, redo); load(); } catch (e) { setMsg({ tone: "error", text: e.message }); }
  }
  async function upAll() {
    setMsg(null);
    const todo = (rows || []).filter((r) => r.state !== "done" && r.state !== "queued");
    for (const r of todo) { try { await uploadGalleryArchive(r.date, r.id); } catch (e) { setMsg({ tone: "error", text: e.message }); break; } }
    load();
  }
  const pendingCount = (rows || []).filter((r) => r.state !== "done" && r.state !== "queued").length;
  return (
    <div className="mt-5 border-t border-[#D5DCE4] pt-4">
      <div className="flex items-center gap-2 flex-wrap">
        <b className="text-[13px]">Unggah manual dari arsip</b>
        <Btn onClick={() => setOpen((v) => !v)}>{open ? "Tutup daftar" : "Buka daftar sesi"}</Btn>
      </div>
      <p className="text-[12px] text-[#6B7684] mt-1">Arsip permanen di PC booth (folder output) tetap menjadi cadangan utama. Kalau internet booth sempat bermasalah, unggah sesi dari sini; link-nya langsung bisa dibuka pelanggan.{!ready && " (Aktifkan & simpan alamat galeri dulu.)"}</p>
      {open && (
        <div className="mt-3">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <label className="text-[12px] text-[#55606E]">Tampilkan</label>
            <select className={inputCls} style={{ width: 130 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} hari terakhir</option>)}
            </select>
            <Btn variant="primary" onClick={upAll} disabled={!ready || !pendingCount}>Unggah semua yang belum ({pendingCount})</Btn>
          </div>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          {rows && !rows.length && <p className="text-[12px] text-[#6B7684]">Belum ada sesi di arsip pada rentang ini.</p>}
          {rows && rows.length > 0 && (
            <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
              <table className="w-full text-[12px]">
                <thead><tr className="text-left text-[#6B7684] border-b border-[#D5DCE4]"><th className="py-1 pr-3">Tanggal</th><th className="pr-3">Sesi</th><th className="pr-3">File</th><th className="pr-3">Status</th><th></th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.date}/${r.id}`} className="border-b border-[#EEF2F6]">
                      <td className="py-1 pr-3">{r.date}</td>
                      <td className="pr-3 font-mono">{r.id.length > 22 ? `${r.id.slice(0, 22)}…` : r.id}</td>
                      <td className="pr-3">{r.uploaded}/{r.files}</td>
                      <td className={`pr-3 font-bold ${(ST[r.state] || [])[1] || ""}`}>{(ST[r.state] || [r.state])[0]}{r.error ? <span className="font-normal text-red-600"> ⚠ {r.error}</span> : null}</td>
                      <td className="whitespace-nowrap">
                        {r.state !== "done" && r.state !== "queued" && <Btn onClick={() => up(r)} disabled={!ready}>Unggah</Btn>}
                        {r.state === "done" && <Btn onClick={() => up(r, true)} disabled={!ready}>Unggah ulang</Btn>}
                        {r.url && <> <Btn onClick={async () => { const ok = await copyText(r.url); setCopied(ok ? r.id : null); setTimeout(() => setCopied(null), 1500); }}>{copied === r.id ? "Tersalin ✓" : "Salin link"}</Btn> <a className="text-[#2B6CB0] underline ml-1" href={r.url} target="_blank" rel="noreferrer">Buka</a></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
