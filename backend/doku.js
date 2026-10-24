// ==========================================================
// DOKU QRIS (SNAP Direct API, QRIS MPM dinamis) — dibuat dari dokumentasi developers.doku.com (integration-guide/qris & get-token b2b).
//
// Alur: 1) B2B access token (tanda tangan RSA: SHA256withRSA atas "<ClientID>|<timestamp>") — di-cache sampai hampir habis.
//       2) POST /snap-adapter/b2b/v1.0/qr/qr-mpm-generate  -> qrContent (teks QRIS, digambar jadi QR di layar booth)
//       3) POST /snap-adapter/b2b/v1.0/qr/qr-mpm-query     -> latestTransactionStatus (dicek berkala oleh backend, sama seperti Midtrans;
//          PC booth di balik router sehingga webhook tidak dipakai).
// Tanda tangan transaksi: HMAC-SHA512(clientSecret, "METHOD:path:accessToken:sha256hex(body):timestamp") -> base64.
// ==========================================================
const crypto = require("crypto");
const settingsStore = require("./settings");

const HOSTS = { sandbox: "https://api-sandbox.doku.com", production: "https://api.doku.com" };
const PATH = { token: "/authorization/v1/access-token/b2b", generate: "/snap-adapter/b2b/v1.0/qr/qr-mpm-generate", query: "/snap-adapter/b2b/v1.0/qr/qr-mpm-query" };

function cfg() { return settingsStore.load().payment.qris.doku; }
function configured() {
  const d = cfg();
  return !!(d.clientId && d.secretKey && d.privateKey && d.merchantId && d.terminalId);
}
const host = () => process.env.DOKU_BASE_URL || (cfg().isProduction ? HOSTS.production : HOSTS.sandbox); // DOKU_BASE_URL: hanya untuk uji

const isoZ = (d = new Date()) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
/** ISO 8601 dengan zona waktu PC booth, mis. 2026-10-23T15:00:00+07:00 (untuk validityPeriod). */
function isoLocal(d) {
  const p = (n) => String(n).padStart(2, "0"), off = -d.getTimezoneOffset(), a = Math.abs(off);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${off >= 0 ? "+" : "-"}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}
const sha256hex = (s) => crypto.createHash("sha256").update(s).digest("hex");
const normKey = (k) => String(k || "").replace(/\\n/g, "\n").trim();

function rsaSign(text) {
  const d = cfg();
  const key = crypto.createPrivateKey({ key: normKey(d.privateKey), format: "pem", ...(d.keyPassphrase ? { passphrase: d.keyPassphrase } : {}) });
  return crypto.createSign("RSA-SHA256").update(text).sign(key, "base64");
}

async function http(path, { method = "POST", headers = {}, body } = {}) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(host() + path, { method, headers, body, signal: ctrl.signal });
    const text = await res.text();
    let json = {}; try { json = JSON.parse(text); } catch { /* bukan JSON */ }
    return { status: res.status, json, text };
  } finally { clearTimeout(t); }
}

let tokenCache = { key: null, token: null, exp: 0 };
async function accessToken() {
  const d = cfg(), cacheKey = `${d.clientId}|${d.isProduction}`;
  if (tokenCache.key === cacheKey && tokenCache.exp > Date.now() + 60000) return tokenCache.token;
  const ts = isoZ();
  const r = await http(PATH.token, { headers: { "Content-Type": "application/json", "X-CLIENT-KEY": d.clientId, "X-TIMESTAMP": ts, "X-SIGNATURE": rsaSign(`${d.clientId}|${ts}`) }, body: JSON.stringify({ grantType: "client_credentials" }) });
  if (!r.json.accessToken) throw new Error(`DOKU menolak token: ${r.json.responseMessage || r.text.slice(0, 120) || "HTTP " + r.status}${/signature/i.test(r.json.responseMessage || "") ? " (cek Private key & public key di DOKU Back Office)" : ""}`);
  tokenCache = { key: cacheKey, token: r.json.accessToken, exp: Date.now() + (Number(r.json.expiresIn) || 900) * 1000 };
  return tokenCache.token;
}

let extSeq = 0;
async function call(path, payload) {
  const d = cfg(), token = await accessToken();
  const body = JSON.stringify(payload); // string yang SAMA dipakai untuk hash & dikirim (minified)
  const ts = isoZ();
  const sig = crypto.createHmac("sha512", d.secretKey).update(`POST:${path}:${token}:${sha256hex(body)}:${ts}`).digest("base64");
  const ext = `${Date.now()}${String(++extSeq % 1000).padStart(3, "0")}`; // numerik & unik
  const r = await http(path, { headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-PARTNER-ID": d.clientId, "X-EXTERNAL-ID": ext, "CHANNEL-ID": "H2H", "X-TIMESTAMP": ts, "X-SIGNATURE": sig }, body });
  if (r.status === 401) tokenCache.exp = 0; // token kedaluwarsa: ambil baru pada panggilan berikutnya
  return r;
}

/** Buat QRIS dinamis. Mengembalikan { qrContent, referenceNo }. Melempar Error bila ditolak. */
async function generate({ orderNo, amount, minutes = 15 }) {
  const d = cfg();
  const r = await call(PATH.generate, {
    partnerReferenceNo: orderNo,
    amount: { value: `${Math.round(amount)}.00`, currency: "IDR" },
    merchantId: d.merchantId,
    terminalId: d.terminalId,
    validityPeriod: isoLocal(new Date(Date.now() + minutes * 60000)),
    additionalInfo: { postalCode: d.postalCode || "12345", feeType: "1" },
  });
  const j = r.json;
  if (!j.qrContent) throw new Error(`DOKU gagal membuat QRIS: ${j.responseMessage || r.text.slice(0, 160) || "HTTP " + r.status} (${j.responseCode || r.status})`);
  return { qrContent: j.qrContent, referenceNo: j.referenceNo || null };
}

/** Status transaksi: "paid" | "expired" (gagal/dibatalkan) | "pending". */
async function queryStatus({ orderNo, referenceNo }) {
  const d = cfg();
  const r = await call(PATH.query, { originalReferenceNo: referenceNo || "", originalPartnerReferenceNo: orderNo, serviceCode: "47", merchantId: d.merchantId });
  const s = String(r.json.latestTransactionStatus ?? "");
  if (s === "00") return "paid";               // sukses
  if (s === "05" || s === "06") return "expired"; // dibatalkan / gagal
  return "pending";                             // 01 initiated, 02 paying, 03 pending, 07 belum ada, dll
}

async function testConnection() {
  if (!configured()) return { ok: false, error: "Client ID, Secret key, Private key, Merchant ID, dan Terminal ID wajib diisi." };
  try { await accessToken(); return { ok: true, env: cfg().isProduction ? "production" : "sandbox" }; }
  catch (e) { return { ok: false, error: e.name === "AbortError" ? "DOKU tidak menjawab (timeout)" : e.message }; }
}

module.exports = { configured, generate, queryStatus, testConnection, _internal: { rsaSign, isoLocal, sha256hex } };
