# POPSNAP Cloud Dashboard — Server Pusat

Server terpisah buat kamu (owner/pusat) pantau **semua toko sekaligus** dari 1 tempat.

**BEDA sama `backend/`** (yang jalan lokal di tiap PC toko):
- `backend/` = jalan LOKAL di tiap PC booth, tetap jalan walau offline
- `cloud-dashboard/` = jalan di INTERNET (hosting), nampung laporan dari semua toko

## Cara kerja

1. Tiap toko (lewat `backend/` masing-masing) otomatis kirim ringkasan data
   (jumlah sesi, omzet — BUKAN foto/data pribadi konsumen) ke sini tiap 5 menit,
   KALAU internet lagi nyala.
2. Kamu login ke dashboard ini buat lihat semua toko dalam 1 layar: status
   online/offline, sesi hari ini, omzet hari ini.

## Setup sebelum deploy

### 1. Generate API key rahasia
Ini kunci supaya cuma toko-toko kamu yang bisa lapor kesini (bukan orang random):
```bash
# Di terminal manapun:
openssl rand -hex 32
```
Simpan hasilnya, dipakai di 2 tempat: `.env` dashboard ini (`SYNC_API_KEY`) DAN
`.env` tiap toko (`CLOUD_SYNC_API_KEY`) — **harus sama persis**.

### 2. Generate JWT secret
```bash
openssl rand -hex 48
```
Simpan sebagai `JWT_SECRET` di `.env` dashboard ini.

## Deploy ke Railway (gratis buat mulai)

1. Daftar di [railway.app](https://railway.app)
2. New Project → Deploy from GitHub (push folder `cloud-dashboard` ke repo GitHub dulu,
   atau pakai Railway CLI kalau belum mau pakai GitHub)
3. Di Settings project, tambahkan Environment Variables:
   - `SYNC_API_KEY` = (hasil generate langkah 1)
   - `JWT_SECRET` = (hasil generate langkah 2)
4. Railway otomatis kasih URL publik, misal `https://popsnap-dashboard.up.railway.app`
5. Buka URL itu di browser → akan muncul wizard setup akun owner pertama kali

## Deploy ke Render (alternatif, juga ada free tier)

1. Daftar di [render.com](https://render.com)
2. New → Web Service → connect ke repo GitHub folder `cloud-dashboard`
3. Build command: `npm install` — Start command: `npm start`
4. Tambahkan Environment Variables yang sama seperti di atas
5. Deploy, Render kasih URL publik

## Setelah dashboard live — sambungkan tiap toko

Di **tiap toko**, edit `backend/.env`:
```
CLOUD_SYNC_URL=https://popsnap-dashboard.up.railway.app
CLOUD_SYNC_API_KEY=<API_KEY_yang_sama_seperti_di_atas>
```
Restart backend toko itu. Dalam waktu maksimal 5 menit, toko itu akan muncul
di dashboard pusat kamu.

## Menjalankan lokal (buat testing sebelum deploy)

```bash
cd cloud-dashboard
npm install
cp .env.example .env
# isi SYNC_API_KEY di .env, boleh sembarang string dulu buat testing
npm start
```
Buka `http://localhost:5000` di browser.

## Catatan keamanan

- **WAJIB isi `SYNC_API_KEY`** sebelum deploy ke production — tanpa ini, siapa
  saja yang tahu URL dashboard kamu bisa kirim laporan palsu.
- **WAJIB isi `JWT_SECRET` manual** (jangan biarkan auto-generate) di production
  — kalau tidak, setiap kali server restart (misal Railway redeploy), semua
  orang otomatis ke-logout.
- Data yang dikirim tiap toko cuma ANGKA RINGKASAN (jumlah sesi, omzet) — tidak
  ada foto konsumen atau data pribadi yang keluar dari PC toko ke internet
  lewat mekanisme ini.
