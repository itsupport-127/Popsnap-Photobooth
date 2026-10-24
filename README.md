# POPSNAP — Photobox App

Fondasi aplikasi photobooth sesuai alur 7 tahap: Welcome → Pilih Template →
Pembayaran (QRIS/Voucher) → Sesi Foto (8 shot, retake) → Editor (filter/stiker) →
Hasil + QR Download.

## Perbaikan: tempel (paste) kode voucher di kolom voucher booth

- **Ctrl+V / Shift+Insert / klik kanan > Paste** mengisi kolom voucher dari clipboard TANPA harus mengklik kolom, di semua mode keyboard (termasuk keyboard layar, yang kolomnya read-only).
- Teks tempelan boleh ada noise ("Kode voucher: abcd1234 (berlaku 24 jam)"): kode diambil otomatis (token 8 karakter lebih diutamakan), diubah ke huruf kapital, dibatasi 12 karakter. Tempel mengganti isi kolom, tidak menambahkan.
- Tombol **📋 Tempel** untuk layar sentuh (membaca clipboard); kalau clipboard kosong / ditolak browser, muncul pesan jelas.
- Saat popup PIN terbuka, tempel tidak bocor ke kolom voucher di belakangnya.
- Alur nyata yang dites: klik kode di Admin > Voucher (tersalin) lalu Ctrl+V di layar booth.

## Update: salin kode voucher, input kode dari keyboard, pemilih template ala dslrBooth

- **Kode voucher**: klik kode (di tabel "Voucher Terbaru" maupun di kotak hasil buat voucher) = langsung tersalin, ada tanda "Tersalin ✓". Jika Clipboard API tidak ada (admin dibuka lewat http://192.168.x.x), dipakai cara cadangan. Tombol Salin API key kasir memakai mekanisme yang sama.
- **Input kode voucher di booth**: mengetik dari keyboard PC langsung mengisi kolom TANPA mengklik apa pun (huruf/angka otomatis kapital, Backspace, Enter = kirim). Berlaku di semua mode keyboard dan bisa dicampur dengan tombol layar. Pengaturan Umum > Virtual Keyboard kini 3 pilihan: keyboard fisik / bawaan perangkat, keyboard layar POPSNAP, keyboard sentuh Windows (aplikasi desktop membuka TabTip.exe otomatis; perlu dites di PC booth).
- **Template Editor > pemilih template** disamakan dengan dslrBooth: bintang favorit di kepala, panel berisi kolom Nama (ganti nama template), tombol urut A-Z / Z-A, dan daftar bergulir dengan thumbnail + bintang favorit per baris. Urutan dipilih diingat. Klik di luar atau Esc menutup panel.
- **Fungsi favorit**: template berbintang = yang boleh dipilih tamu bila Tampilan > Template diatur "favorit". Template tanpa bintang tetap ada di editor tapi disembunyikan dari tamu.

## Update: Tombol kunci (gembok → PIN) di semua layar + pengaturan posisi & tampilan

- Gembok kini muncul di **semua layar booth** (Start, kategori, template, bayar, pengingat, sesi foto, editor, hasil, dll), bukan hanya layar Start. Dipasang sekali di `KioskApp`.
- **Admin > Pengaturan > Tampilan > Tombol Kunci**: posisi (4 pojok, ada pratinjau), gaya tampilan, opacity, lama tampil, dan luas area pojok.
  - **Selalu terlihat**: gembok tetap di pojok (opacity diatur).
  - **Muncul sebentar lalu menghilang**: tampil beberapa detik tiap pindah layar; ketuk/seret pojok untuk memunculkan lagi.
  - **Tersembunyi**: tak terlihat; ketuk atau seret di pojok untuk memunculkan, lalu ketuk gembok untuk membuka PIN (dua langkah, supaya ketukan tamu tidak langsung membuka PIN).
- Area pojok dideteksi lewat pendengar global, bukan elemen penutup, jadi tombol lain di pojok (Back, Next, Batal) tetap bisa ditekan.
- Kalau ada sesi yang sedang berjalan saat PIN benar, diminta konfirmasi dulu karena membuka menu admin membatalkan sesi itu.
- Pengaturan "Unlock Button Opacity" yang lama dipindah ke sini (nilai lama otomatis dimigrasi).
- Tombol layar penuh di layar Start dipindah ke samping chip "Kamera siap".

## Update: PIN bisa diketik dari keyboard PC

- Popup PIN bisa diisi dari keyboard tanpa mengklik apa pun: angka (baris atas atau numpad), Backspace = hapus satu, Delete = hapus semua, Enter = Buka, Esc = Batal. Tombol angka di layar tetap ada dan bisa dicampur.
- Selama popup terbuka, tombol Spasi / S / PageUp / PageDown / F13 / F11 tidak lagi bocor ke layar di belakangnya (sebelumnya bisa memulai sesi).
- Perbaikan: mengetuk ikon gembok / layar penuh tidak lagi memicu layar penuh otomatis; hanya ketukan biasa di layar Start yang melakukannya.

## Update: Export / Import memilih lokasi (dialog "Simpan sebagai" / "Buka file")

- **Export** (dan **Unduh CSV** di Log Aktivitas) kini membuka dialog "Simpan sebagai": pilih folder dan nama file sendiri. Dialog dibuka LEBIH DULU, baru file disiapkan; kalau dibatalkan tidak ada yang diunduh dan tidak dicatat di log.
- **Import** membuka dialog pilih file (filter ZIP dan JSON). Chrome/Edge mengingat folder terakhir.
- Aplikasi desktop (.exe): dialog Windows lewat Electron. Renderer hanya boleh menulis ke path yang baru dipilih di dialog (sekali pakai).
- Browser tanpa File System Access API (Firefox, Safari, atau halaman http non-localhost): terpaksa mengunduh ke folder Downloads. Aplikasi memberi tahu ini dengan jelas; aktifkan "Tanyakan lokasi penyimpanan setiap kali" di pengaturan unduhan browser untuk mendapat dialog. Buka admin lewat http://localhost supaya dialog bawaan Chrome/Edge tersedia.
- Jika gagal menulis (disk penuh, dll.), pesan error tampil dan file kosong dihapus.

## Update: Export / Import format dslrBooth

- **Export** sekarang menghasilkan ZIP berstruktur sama dengan dslrBooth: `preview.png`, gambar-gambar layer, `template.xml` (UTF-8 + BOM, CRLF, atribut & urutan yang sama), ditambah `popsnap.json` (seluruh layer POPSNAP).
- **Import** menerima: ZIP dslrBooth, ZIP hasil Export POPSNAP, dan file `.popsnap.json` lama. Hasil impor dslrBooth ditampilkan dengan laporan: apa yang diperkirakan / dilewati.
- Diverifikasi dengan file asli dslrBooth (`Untitled-25 Copy - 5.zip`): posisi, ukuran, KeepAspect, favorit, kertas 4x6, dan render identik dengan `preview.png` dslrBooth (selisih rata-rata 0,37/255). Export ulang file itu menghasilkan `template.xml` dengan atribut & nilai yang sama (hanya `LastSavedDate` yang berbeda).
- **Yang sudah terverifikasi** dari contoh file: atribut `<Template>` dan elemen `<Image>`. **Belum ada contoh** untuk Photo / Text / Shape / rotasi / QR Code / Session Data dslrBooth:
  - Impor: Photo, Text, Shape dibaca dengan PERKIRAAN nama atribut (ditandai di laporan impor). Elemen lain dilewati dan dilaporkan.
  - Export: hanya layer gambar yang ditulis ke `template.xml` (supaya dslrBooth tidak salah baca). Slot foto, teks, bentuk, dan rotasi tersimpan lengkap di `popsnap.json` sehingga POPSNAP -> POPSNAP tidak kehilangan apa pun, tetapi TIDAK akan muncul kalau ZIP itu dibuka di dslrBooth.
  - Transparansi warna (alpha) pada bayangan dan latar tidak didukung; hanya warna.
- Tanpa library tambahan (ZIP dibaca/ditulis sendiri), jadi tidak perlu `npm install`. Pengaman: maks. 500 file, 80 MB per file, 250 MB total, CRC diperiksa, ZIP terenkripsi / ZIP64 ditolak, gambar BMP/GIF/WEBP dikonversi ke PNG.

## Perbaikan: layer gambar memenuhi kotaknya (seperti dslrBooth)

- Sebelumnya gambar selalu "dimuat di dalam kotak" (contain): kalau "Keep aspect ratio" dimatikan dan kotak ditarik tidak proporsional, muncul area kosong di atas/bawah gambar dan garis seleksi tidak pas dengan gambar. Kini gambar SELALU memenuhi kotaknya (melar), di editor, layar pelanggan, dan hasil akhir.
- "Keep aspect ratio" menyala (atau tahan Shift) = rasio terkunci saat tarik handle / ketik W-H. Mati = bebas.
- Gambar yang baru ditambahkan tidak lagi otomatis dicentang "Keep aspect ratio" (sama seperti dslrBooth).
- Mengganti gambar lewat tombol "…" menyesuaikan tinggi kotak dengan proporsi gambar baru (lebar & titik tengah tetap), supaya tidak melar tanpa sengaja.
- Template lama yang kotak gambarnya tidak proporsional dengan gambarnya kini terlihat melar sesuai kotak.

## Update: Pengaturan lengkap (Umum / Kamera / Tampilan), Mode Booth, Kunci Layar Penuh + PIN, Layar Pengingat

**Setelah menimpa file, jalankan `npm install` di folder `frontend`** (ada library baru: `gifenc`), lalu restart backend.

- **Admin > Pengaturan** kini bertab, meniru dslrBooth: **Umum**, **Kamera**, **Tampilan**, **GIF & Video**. Tombol Save/Cancel di bawah; ada penanda perubahan belum disimpan.
- **Mode Booth**: Foto, GIF, Boomerang, Video. Tombol-tombolnya tampil di layar Start sesuai yang diaktifkan. Tiap mode non-foto punya harga sendiri (0 = gratis); QRIS mengambil harga dari server. Default hanya Foto aktif.
  - GIF = N foto dengan hitung mundur digabung jadi GIF. Boomerang = rekam beberapa detik, diputar maju-mundur (hasil GIF loop, bukan MP4). Video = satu klip, MP4 bila browser mendukung, kalau tidak WebM.
  - Mode Foto bisa sekaligus membuat GIF dari foto sesi (tab Foto | GIF di layar hasil, QR masing-masing).
- **Layar Pengingat** (setelah bayar, sebelum sesi foto): teks, latar, logo, warna panel, lama tampil (2–60 dtk), dan "ketuk untuk lewati" diatur di Tampilan. `{shots}` dan `{retakes}` otomatis diganti angka asli.
- **Kunci layar penuh**: klik Start atau tombol layar penuh = masuk layar penuh (seperti F11). Keluar / buka menu admin lewat ikon gembok atau F11, minta **PIN** (4–8 angka, disimpan ter-hash). Di aplikasi .exe, F11/Ctrl+W/Ctrl+R/DevTools dikunci dan jendela hanya bisa ditutup lewat Admin > Tools > Keluar dari Aplikasi.
  - KETERBATASAN browser: tombol Esc tidak bisa diblokir penuh (Chrome: tahan ±2 detik). Untuk kunci rapat, pakai aplikasi desktop.
- **Sesi foto otomatis**: hitung mundur → jepret → tampilkan foto → berikutnya. Semua angka (hitung mundur foto 1 / foto lain, durasi tampil foto, warna hitung mundur), crop live view, tombol Batal, thumbnail + lokasinya, dan gambar "say cheese" diatur di Tampilan. Matikan "Automatic Sequence" untuk kembali ke rana manual.
- **Kamera**: auto trigger, resolusi webcam (slider), pilih perangkat video/audio, mirror, rotasi 0/90/180/270, live view di layar Start, dan tombol uji kamera.
- **Tampilan**: warna (background, primary, teks tombol, secondary) berlaku ke seluruh booth, gambar latar Start + mode stretch, pilihan template (semua / favorit / satu template), opacity gembok, pemicu keyboard (Spasi, S, PageUp, PageDown, F13), pengaturan layar hasil (timeout 0 = tidak otomatis, sembunyikan Done, posisi QR, label).
- **Favorit template**: bintang di Template Editor sekarang berfungsi (tersimpan langsung, dipakai filter "favorit" di booth).
- **Umum**: Disclaimer (setelah Start, sebelum bayar), keyboard layar untuk kode voucher, **ekspor real-time** ke folder lain (Prints / Originals / GIFs / Videos) dengan tombol "Tes folder".
- Perbaikan penting yang ditemukan saat pengerjaan:
  - Unggah hasil sesi sebelumnya MENYIMULASIKAN keberhasilan bila `VITE_SIMULATE_PAYMENT` tidak "false" (arsip & QR tidak pernah benar-benar jalan). Simulasi dihapus.
  - `sessionId` dari browser dipakai mentah sebagai nama file (bisa menulis di luar folder). Kini divalidasi, dan nama file download diacak.
  - "Bersihkan File Tidak Terpakai" bisa menghapus gambar yang dipakai pengaturan tampilan; kini dilindungi.
- Belum ada: tab Effects, Virtual Attendant, Survey, Printing, Language; Guest QR Code (kontrol dari HP tamu); Show Original Photos; opsi khusus Canon (auto exposure / delay capture); Hardware Acceleration; video multi-klip.

## Update: Log Aktivitas + penyesuaian Template Editor dengan dslrBooth

- **Log Aktivitas** (`/admin/activity`, hak `activity.view`): login (termasuk gagal), logout, perubahan akun / hak akses / pengaturan / mode pembayaran, template (buat, simpan, hapus, impor, ekspor, cetak tes), voucher (buat, batalkan, dipakai), pembersihan file. Ada filter jenis, pengguna, tanggal, cari teks, dan unduh CSV. Password dan key rahasia TIDAK pernah dicatat. Append-only, otomatis dibersihkan setelah 180 hari.
- **Copy layer = salinan sungguhan**: "Photo 1" disalin menjadi "Photo 1 Copy" yang tetap bernomor Photo 1 (menampilkan foto yang sama). Jumlah foto yang dipilih pelanggan = jumlah NOMOR foto berbeda, bukan jumlah slot.
- **OPTIONS ala dslrBooth**: Image Path (+ tombol ganti gambar), Photo # (dropdown), Stroke Color / Stroke Width, Drop Shadow (Color, Angle, Distance, Spread), Opacity. Dirender sama di preview, layar editor pelanggan, dan hasil akhir.
- **Toolbar**: Import, Export, Print Test Copy (foto contoh, ukuran kertas sesuai template). File ekspor `.popsnap.json` membawa gambar di dalamnya; file impor divalidasi ketat (ukuran, warna, jenis layer, gambar harus PNG/JPEG yang ditanam).
- Belum ada: layer **Session Data** dan **QR Code** di dalam template.

## Update: Pengguna & Hak Akses (Super Admin)

- Tiga peran: **Super Admin** (semua hak, satu-satunya yang mengelola pengguna), **Admin**, **Kasir**.
- Hak akses per fitur: edit template, pengaturan umum, kelola voucher, ganti mode bayar, lihat statistik, payment gateway & integrasi kasir, tools. Super Admin mengatur default tiap peran di **Pengguna > Hak Akses Peran**, dan bisa memberi **hak khusus** ke satu akun.
- Akun dibaca ulang dari database di setiap permintaan: perubahan hak, penonaktifan, atau penghapusan akun langsung berlaku. Mengganti password / menonaktifkan akun mengeluarkan akun itu dari semua perangkat.
- Semua akun bisa ganti username & password sendiri di **Akun Saya** (wajib password saat ini).
- Perlindungan: minimal 1 Super Admin aktif, tidak bisa menonaktifkan/menghapus/menurunkan akun sendiri, batas 8 kegagalan login per 5 menit, username unik tanpa membedakan huruf besar/kecil.
- Instalasi lama: akun admin PERTAMA otomatis dijadikan Super Admin saat backend dijalankan.
- Perbaikan: sebelumnya respons 403 (tidak punya hak) membuat frontend logout paksa. Sekarang hanya 401 (sesi tidak valid) yang logout.

## Update: Menu Admin, status kamera, pembayaran offline/online

- `/admin` sekarang berupa **menu**: Template, Pembayaran, Voucher, Pengaturan, Tools, Bantuan (admin melihat semua, kasir hanya Voucher + Pembayaran).
- Layar Welcome menampilkan **status kamera** (siap / belum siap / izin ditolak). Tombol Start aktif hanya kalau kamera siap. Ikon gembok di pojok kanan atas = masuk ke menu admin.
- **Mode pembayaran** (admin & kasir bisa ganti kapan saja): Voucher saja, Otomatis, Voucher + QRIS, QRIS saja. Kalau QRIS tidak bisa jalan (internet mati / belum dikonfigurasi) booth otomatis memakai voucher, konsumen tidak pernah buntu.
- **Voucher**: kode tanpa karakter membingungkan (0/O/1/I), satu kali pakai (atomik), masa berlaku bisa diatur, bisa dibatalkan, ada catatan/nomor struk, dan dibatasi 10 percobaan salah per menit.
- **Integrasi aplikasi kasir**: `POST /api/integration/vouchers` dengan header `X-API-Key` (key ada di Admin > Pembayaran). Idempoten lewat `reference`.
- Pengaturan umum (nama event, kamera, jumlah foto, retake, timer) kini diatur dari `/admin/settings`, bukan edit kode.
- **Keamanan**: mode simulasi pembayaran di frontend DIHAPUS (sebelumnya voucher apa pun >= 4 karakter dianggap valid). Simulasi QRIS kini hanya bisa dinyalakan sengaja dari Admin > Pembayaran.
- QRIS asli: status pembayaran dicek backend langsung ke Midtrans (tidak bergantung webhook, yang tidak bisa masuk ke PC di balik router).
- Di aplikasi .exe (file://) router memakai HashRouter, jadi menu `#/admin` bisa dibuka.

## Update: Template Editor ala dslrBooth

Editor di `/admin` dirombak mengikuti dslrBooth:

- **Ukuran kertas dipilih DULU** saat New Template (2x6, 4x6, 5x7, 6x8, 8x10, A4, Custom) + resolusi (dpi) + orientasi.
  Ukuran kanvas tidak lagi ditebak dari file gambar, jadi bug posisi layer yang meleset hilang.
  Gambar latar sekarang opsional; bisa juga pakai warna latar saja.
- Panel kiri: **ADD** (Image, Photo From Booth, Text, Shape, Background Color) dan **LAYOUT** (satuan Pixels/Inches/cm, kertas, dpi, orientasi, lebar/tinggi).
- Panel kanan: **INFO** (X/Y/W/H/Rotate, Keep aspect ratio), **ALIGN & DISTRIBUTE**, **LAYERS** (mata, kunci, ganti nama dengan klik dua kali, drag untuk urutan, duplikat, hapus), **OPTIONS** (opsi per layer; kalau tidak ada layer terpilih, isinya nama/kategori/harga template).
- Toolbar: New Template, Save as New, Save, Delete Template, Undo/Redo, Open Photo Booth.
- Shortcut: Ctrl+S simpan, Ctrl+Z/Y undo-redo, Ctrl+D duplikat, Delete hapus, panah geser 1px (Shift = 10px), Shift+klik multi-select, Shift saat putar = per 15 derajat.
- Hasil akhir (`composeImage.js`) sekarang ikut membaca warna latar, layer tersembunyi, opacity, dan italic.

Belum ada: layer **Session Data** dan **QR Code** di dalam template, serta zoom kanvas.

## Status TERBARU: Multi-Store + Login + Template Editor N-Layer

Ini update paling baru, letaknya di atas supaya gampang ditemukan:

- **Login lokal** (`/admin`) — role Admin (akses penuh) & Kasir (cuma generate
  voucher). Setup wizard otomatis muncul di pemakaian pertama kali.
- **Template Editor jadi sistem N-layer** kayak Photoshop/dslrBooth — 4 tipe
  layer (gambar, slot foto, teks, shape), bisa diatur depan-belakang bebas
  (Bring to Front/Send to Back/dst).
- **Arsip foto permanen ke folder lokal PC** — bukan cuma lewat QR yang sementara.
- **Cloud Dashboard** (folder terpisah `cloud-dashboard/`) — buat kamu (owner/pusat)
  pantau SEMUA toko dari 1 tempat. **Perlu di-deploy ke hosting** (Railway/Render)
  supaya bisa diakses dari internet — panduan lengkap ada di
  `cloud-dashboard/README.md`.

Detail lengkap tiap fitur ada di bagian "Update: Sistem Login & Multi-Toko" dan
"Update: Template Editor N-Layer" di bawah.

## Status saat ini: Fase 4 — Desktop App (Electron) + Jembatan Kamera DSLR

Yang baru ditambahkan:
- **Electron wrapper** (`electron/`) — bungkus web app jadi aplikasi desktop asli
  (`.exe` untuk Windows), bisa jalan fullscreen kiosk mode
- **Jembatan DSLR** (`electron/dslrBridge.js`) — kontrol kamera DSLR lewat
  digiCamControl (Windows) atau gPhoto2 (Mac/Linux)
- `useCamera.js` di frontend otomatis pilih mode: **webcam** (browser biasa)
  atau **DSLR** (kalau jalan di dalam Electron DAN `cameraMode: "dslr"` di config)
- Icon aplikasi & tab browser bisa diganti pakai logo sendiri

> **PENTING**: Kode jembatan DSLR ini disusun sesuai dokumentasi resmi
> digiCamControl & gPhoto2, tapi **WAJIB dites ulang dengan kamera fisik**
> di lokasi kamu sebelum dipakai produksi — saya tidak punya akses ke
> hardware kamera untuk tes langsung dari sini.

## Cara menjalankan sebagai Desktop App

> **Update**: sejak sekarang, versi `.exe` hasil build (`npm run build:win`)
> **otomatis nyalain backend sendiri** pas dibuka — beneran sekali klik, gak
> perlu buka terminal apa pun lagi. Ini beda sama mode development (`npm start
> electron .`), yang backend-nya tetap harus dijalanin manual biar gampang
> lihat log-nya pas develop. ⚠️ **Belum sempat dites di build `.exe` beneran**
> (saya gak punya akses mesin Windows buat build & tes langsung dari sini) —
> kalau nanti kamu build dan ternyata backend-nya gak ke-start otomatis, kasih
> tau saya pesan errornya, biasanya soal path folder resource yang meleset.

### 1. Setup kamera DSLR (kalau dipakai)

**Windows** — install [digiCamControl](https://digicamcontrol.com) (gratis).
Setelah install, **wajib aktifkan webserver bawaannya**:
1. Buka digiCamControl, masuk ke **Tools/File > Settings > Webserver**
2. Centang **"Use web server"** dan **"Allow interaction via webserver"**
3. Pastikan port `5513` (default)
4. **Restart aplikasi digiCamControl**
5. **Biarkan digiCamControl tetap jalan di background** selama app POPSNAP dipakai
   (jembatan kita bicara ke digiCamControl lewat `http://localhost:5513`, bukan
   lewat command-line, karena command-line digiCamControl tidak bisa dipakai
   bersamaan dengan aplikasinya yang sedang jalan)

Kalau digiCamControl kamu jalan di PC lain / port beda, set environment variable
`DIGICAM_HOST` (misal `DIGICAM_HOST=http://192.168.1.5:5513`).

**Mac/Linux** — install gPhoto2:
```bash
# Mac
brew install gphoto2
# Linux (Debian/Ubuntu)
sudo apt install gphoto2
```

Colok kamera lewat USB, nyalakan, set mode ke PC/Remote Control di body kamera.

### 2. Aktifkan mode DSLR di config

Edit `frontend/src/config/appConfig.js`:
```js
cameraMode: "dslr",  // ganti dari "webcam"
```

### 3. Build frontend, lalu jalankan Electron

```bash
# Build frontend dulu (Electron production load dari hasil build, bukan dev server)
cd frontend
npm install
npm run build

# Lalu jalankan Electron
cd ../electron
npm install
npm start
```

### 4. Bikin installer `.exe` (buat didistribusikan ke PC booth lain)

```bash
cd electron
npm run build:win
```
Hasil installer ada di `electron/dist/`. Untuk Mac (`build:mac`) atau Linux (`build:linux`).

### Mengganti icon aplikasi & tab browser

- **Icon tab browser**: taruh file `.ico` kamu di `frontend/src/assets/logo.ico`
  (sudah otomatis dipakai lewat `main.jsx`)
- **Icon aplikasi desktop** (yang muncul di taskbar/installer): sama, taruh di
  `frontend/src/assets/logo.ico` — sudah dirujuk di `electron/package.json`
  bagian `build.win.icon`

Yang sudah jalan sekarang:
- Semua 7 layar bisa dites end-to-end di browser
- State machine yang mengatur alur, timer, dan aturan (retake, back/next, dsb)
- Backend lokal (Express + SQLite) untuk simpan template, slot, voucher, sesi
- Template Slot Editor (`/admin`) — upload PNG, atur posisi slot, **dan harga per template**
- Compositing asli — hasil akhir menempel foto beneran di posisi slot
- **Pembayaran QRIS via Midtrans asli** (Core API) — otomatis fallback ke mode
  simulasi kalau server key belum diisi, jadi tetap bisa jalan tanpa akun Midtrans dulu
- Harga transaksi diambil dari database server (bukan dari input browser), jadi
  aman dari manipulasi harga oleh konsumen
- Auto-cleanup file sesuai `fileRetentionDays`

## Update: Sistem Login & Multi-Toko

Sejak update ini, `/admin` **dilindungi login** — gak bisa langsung diakses siapa saja.

### Role
- **Admin**: akses penuh — edit template, atur harga, kelola akun kasir
- **Kasir**: cuma bisa generate kode voucher buat konsumen yang bayar cash/EDC

### Pertama kali pakai
1. Buka `/admin` — karena belum ada akun sama sekali, otomatis muncul **wizard
   setup**: isi nama toko + bikin username/password admin pertama
2. Setelah itu, admin bisa bikin akun kasir tambahan lewat tombol **"Kelola Akun"**
   di sidebar

### Kalau lupa password
**Cara aman (data template TETAP ADA, gak kehapus)** — di folder `backend`:
```bash
node reset-password.js <username> <password_baru>
# contoh:
node reset-password.js admin passwordbaru123
```
Kalau lupa juga username-nya, jalankan tanpa argumen yang benar (`node reset-password.js x y`)
— nanti muncul daftar semua username yang ada.

**Cara nuklir (kalau di atas gak bisa dipakai)**: hapus file `backend/db/popsnap.db`,
restart backend, akan diminta setup ulang dari awal (**PERHATIAN**: ini juga
menghapus semua data template & histori yang tersimpan).

### Sinkron ke server pusat (opsional)
Backend tiap toko otomatis kirim ringkasan data (jumlah sesi, omzet — BUKAN
foto konsumen) ke server pusat tiap 5 menit, KALAU `CLOUD_SYNC_URL` diisi di
`.env`. Lihat folder `cloud-dashboard/` buat server pusatnya (perlu di-deploy
ke hosting seperti Railway/Render — panduan lengkap di `cloud-dashboard/README.md`).

## Update: Template Editor jadi Sistem N-Layer (kayak Photoshop/dslrBooth)

Sebelumnya cuma ada 2 layer tetap (background/foreground). Sekarang **bebas
berapa pun layer**, masing-masing bisa diatur urutan depan-belakangnya sendiri.

### 4 tipe layer
- **Gambar** — background, bingkai, dekorasi, sticker (upload PNG/JPG)
- **Slot Foto** — tempat foto hasil sesi ditempel (bentuk: Kotak/Rounded/Lingkaran)
- **Teks** — nama event, tanggal, dll (atur font, ukuran, warna, perataan)
- **Shape** — bentuk solid buat dekorasi (warna isi & garis tepi sendiri)

### Atur depan-belakang
Di panel kanan (daftar Layers), tiap layer punya 4 tombol:
- **⤒ Paling Depan** — pindah ke paling atas/depan
- **⬆ Maju** — naik 1 tingkat
- **⬇ Mundur** — turun 1 tingkat
- **⤓ Paling Belakang** — pindah ke paling bawah/belakang

Layer paling ATAS di daftar = paling DEPAN di kanvas (ketutup di atas layer lain).

### Migrasi otomatis
Template lama (yang masih pakai format background/foreground/slots) otomatis
"dirakit ulang" jadi format layer baru pas backend pertama kali jalan setelah
update ini — gak perlu upload ulang manual.

### Cara pakai
1. Buka `/admin`, login
2. Klik **"+ Template Baru"** — upload 1 gambar buat kanvas dasar
3. Tambah layer lain lewat tombol di bawah kanvas: **+ Foto Slot** / **+ Teks** /
   **+ Shape** / **+ Gambar**
4. Klik layer di kanvas buat pilih, geser/resize langsung, atur propertinya di
   panel kanan
5. Atur urutan depan-belakang sesuai kebutuhan
6. Simpan

## Update: Arsip Foto Permanen ke PC

Selain link download QR (yang otomatis kehapus sesuai `fileRetentionDays`),
sekarang SEMUA hasil foto juga tersimpan **permanen** di folder lokal:

```
backend/output/2026-09-10/POPSNAP-ab12cd/final.png       <- hasil jadi (dengan template)
backend/output/2026-09-10/POPSNAP-ab12cd/raw/shot-1.jpg  <- SEMUA foto mentah (8x jepretan)
backend/output/2026-09-10/POPSNAP-ab12cd/raw/shot-2.jpg
...dst
```

Folder ini **TIDAK PERNAH auto-dihapus**. Ganti lokasinya lewat `OUTPUT_DIR` di
`.env` (misal diarahkan ke folder Desktop biar gampang diakses).

> **Catatan**: fitur ini cuma jalan kalau `VITE_SIMULATE_PAYMENT=false` di
> `frontend/.env` — karena di mode simulasi, frontend gak pernah beneran
> manggil backend buat proses finalisasi sesi.

## Update: Template 2-Layer (VERSI LAMA — sudah digantikan sistem N-Layer di atas)

> Bagian ini historis, dibiarkan buat referensi. Kalau kamu upload template
> baru sekarang, pakai sistem N-Layer yang dijelaskan di atas, bukan ini.

- Semua 7 layar konsumen sudah **responsive** — dites dari lebar HP (~360px)
  sampai desktop lebar, pakai breakpoint Tailwind (`sm:`, `md:`).

1. Daftar akun sandbox (gratis) di https://dashboard.sandbox.midtrans.com
2. Masuk ke **Settings > Access Keys**, salin **Server Key** dan **Client Key**
3. Di folder `backend`, copy `.env.example` jadi `.env`:
   ```bash
   cd backend
   cp .env.example .env
   ```
4. Isi `MIDTRANS_SERVER_KEY` dan `MIDTRANS_CLIENT_KEY` di file `.env` tadi
5. Restart backend (`npm start`) — akan muncul log `[midtrans] Mode AKTIF - SANDBOX`
6. **Penting**: daftarkan webhook notifikasi di dashboard Midtrans
   (Settings > Configuration > Payment Notification URL) mengarah ke:
   `http://<alamat-publik-PC-booth>/api/payment/notification`
   — ini yang bikin status "sudah bayar" ke-update otomatis begitu QRIS discan & dibayar.
   Untuk testing di localhost, pakai tool seperti [ngrok](https://ngrok.com) supaya
   Midtrans (di internet) bisa reach backend kamu.
7. Kalau semua siap, ganti `MIDTRANS_IS_PRODUCTION=true` dan pakai Server Key dari
   akun production (bukan sandbox) saat sudah live beneran.

Tanpa langkah di atas, backend otomatis jalan di **mode simulasi** (auto-lunas 6 detik
setelah generate QR) — supaya development tetap jalan tanpa akun Midtrans.

## Cara benar-benar test pembayaran QRIS Sandbox (bukan simulasi)

Ada **2 saklar simulasi terpisah** yang harus SAMA-SAMA dimatikan:

| Saklar | Lokasi | Default | Ubah jadi |
|---|---|---|---|
| Backend | `backend/.env` → `MIDTRANS_SERVER_KEY` | kosong | isi Server Key sandbox |
| Frontend | `frontend/.env` → `VITE_SIMULATE_PAYMENT` | `true` | `false` |

Kalau cuma backend yang diisi tapi `VITE_SIMULATE_PAYMENT` masih `true`, frontend
gak akan pernah manggil backend sama sekali — tetap simulasi 6 detik dari sisi
frontend doang.

### Setup tunnel (ngrok) — supaya Midtrans bisa kirim notifikasi ke PC kamu

Backend kamu jalan di `localhost`, sedangkan server Midtrans ada di internet —
dia gak bisa langsung akses `localhost` kamu untuk kirim notifikasi "sudah dibayar".
Solusinya pakai [ngrok](https://ngrok.com/download) untuk bikin alamat publik
sementara yang diarahkan ke `localhost:4000`:

```bash
ngrok config add-authtoken <TOKEN_DARI_DASHBOARD_NGROK>
ngrok http 4000
```

Salin URL yang muncul (misal `https://abcd1234.ngrok-free.app`), lalu daftarkan
di dashboard sandbox Midtrans: **Settings → Configuration → Payment Notification URL**:
```
https://abcd1234.ngrok-free.app/api/payment/notification
```

### Cara simulasikan pembayaran berhasil

QR di sandbox **tidak bisa discan pakai aplikasi e-wallet asli** (bukan transaksi
uang beneran). Midtrans sediakan simulator khusus:

1. Jalankan alur app sampai QR muncul di layar Payment
2. Salin URL gambar QR tersebut (klik kanan → copy image address, atau ambil dari
   response `qrImageUrl` di tab Network browser)
3. Buka **https://simulator.sandbox.midtrans.com**, pilih metode **QRIS**
4. Paste URL gambar QR tadi, klik simulasikan pembayaran berhasil
5. Midtrans kirim webhook ke ngrok kamu → backend update status di tabel `payments`
   → frontend (yang lagi polling tiap 2 detik) mendeteksi status `paid` → **otomatis
   lanjut ke sesi foto**, persis seperti pembayaran asli

### Urutan menjalankan semuanya

```bash
# Terminal 1 — backend
cd backend && npm start
# pastikan muncul log: [midtrans] Mode AKTIF - SANDBOX

# Terminal 2 — tunnel
ngrok http 4000

# Terminal 3 — frontend
cd frontend && npm run dev
```

## Cara paling gampang — Launcher Sekali Klik (Windows)

Gak perlu buka terminal manual tiap mau testing. Tinggal:

1. **Double-klik `start-popsnap.bat`** (ada di folder paling luar project)
2. Tunggu — pertama kali dijalankan bakal install dependencies dulu (agak lama,
   cuma sekali), setelah itu langsung cepat tiap dibuka lagi
3. Backend & frontend otomatis nyala di 2 jendela terpisah, browser otomatis kebuka
4. **Buat matiin semuanya**: double-klik `stop-popsnap.bat`

> Jendela hitam (terminal) yang kebuka pas `start-popsnap.bat` dijalankan itu
> JANGAN ditutup manual selama masih dipakai — itu proses backend & frontend-nya
> beneran jalan di situ. Tutup lewat `stop-popsnap.bat` aja biar bersih.

## Cara menjalankan (development, manual)

Jalankan backend dan frontend di 2 terminal terpisah.

**Backend:**
```bash
cd backend
npm install
npm start
```
Backend jalan di `http://localhost:4000`, database SQLite otomatis dibuat di `backend/db/popsnap.db`.

> **Syarat versi Node.js: 22.5 ke atas.** Backend pakai `node:sqlite` (modul SQLite
> bawaan Node sendiri), sengaja dipilih supaya **tidak perlu compiler/Visual Studio**
> seperti kalau pakai `better-sqlite3` — install jadi jauh lebih ringan di PC mana pun,
> termasuk PC booth yang belum tentu ada dev tools-nya. Cek versi Node kamu dengan
> `node -v`; kalau di bawah 22.5, update dulu dari nodejs.org.

**Frontend:**
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

- Alur konsumen: buka `http://localhost:5173`
- Admin — upload template & atur slot: buka `http://localhost:5173/admin`

Browser akan minta izin akses kamera — izinkan untuk melihat live preview di sesi foto.

### Alur kerja yang disarankan
1. Buka halaman `/admin`, upload PNG template kamu, kelompokkan sesuai kategori
   (`strip2` / `print4r` / `custom` / `personalize`), lalu atur posisi tiap slot foto.
2. Klik "Simpan".
3. Buka halaman utama (`/`) — template yang baru diupload otomatis muncul di
   kategori terkait dan siap dites dari sisi konsumen.

## Struktur project

```
popsnap-app/
├── frontend/                  # Web app (React + Vite + Tailwind)
│   ├── src/
│   │   ├── config/appConfig.js       # SEMUA angka yang bisa diubah (timer, retake, retensi)
│   │   ├── state/sessionMachine.js   # Otak alur aplikasi (state + reducer)
│   │   ├── hooks/
│   │   │   ├── useCountdown.js       # Timer reusable
│   │   │   └── useCamera.js          # Abstraksi kamera (webcam / DSLR via Electron)
│   │   ├── utils/composeImage.js     # Render SEMUA layer (gambar/slot foto/teks/shape) jadi 1 gambar akhir
│   │   ├── services/
│   │   │   ├── authService.js        # Login, token, role
│   │   │   ├── paymentService.js     # QRIS & voucher (simulasi -> Midtrans)
│   │   │   ├── sessionService.js     # Upload/finalize sesi ke backend
│   │   │   └── templateService.js    # CRUD template & layer ke backend
│   │   ├── admin/
│   │   │   ├── LoginScreen.jsx        # Login + wizard setup pertama kali
│   │   │   ├── CashierScreen.jsx      # Halaman kasir (generate voucher doang)
│   │   │   └── TemplateSlotEditor.jsx # Template Editor N-Layer (khusus admin)
│   │   └── screens/
│   │       ├── WelcomeScreen.jsx
│   │       ├── TemplateScreen.jsx     # gabung tahap 2 & 3 (kategori + pilih template)
│   │       ├── PaymentScreen.jsx
│   │       ├── PhotoSessionScreen.jsx
│   │       ├── EditorScreen.jsx
│   │       └── ResultScreen.jsx
├── backend/                   # Node.js + Express + SQLite, jalan LOKAL di tiap PC toko
│   ├── server.js               # Semua endpoint API
│   ├── auth.js                  # Hash password, JWT, middleware requireAuth
│   ├── db.js                    # Setup SQLite + migrasi otomatis
│   ├── config.js                 # Semua env var (port, retensi, Midtrans, cloud sync, dll)
│   ├── uploads/                   # File sementara (dilayani lewat QR, auto-hapus sesuai retensi)
│   └── output/                    # Arsip PERMANEN (final + foto mentah), TIDAK auto-hapus
├── electron/                   # Wrapper desktop app (.exe) + jembatan kamera DSLR
└── cloud-dashboard/             # Server PUSAT (folder terpisah, PERLU DI-DEPLOY ke hosting)
    ├── server.js                  # Terima laporan toko, login owner
    └── public/index.html           # Dashboard sederhana (vanilla JS)
```

## Hal yang gampang kamu ubah sendiri

Frontend — `frontend/src/config/appConfig.js`:
- Durasi tiap timer (payment 45s, sesi foto 4 menit, editor 3 menit, download 2 menit)
- Jumlah total shot (default 8) dan batas retake (default 5)
- Daftar 4 kategori template
- Grafis welcome page — lewat prop `branding` di `WelcomeScreen`

Backend — `backend/config.js`:
- `fileRetentionDays` — berapa lama file foto disimpan sebelum auto-dihapus (default 7 hari)

## Roadmap

| Fase | Target |
|---|---|
| **1 (selesai)** | Scaffold, semua screen, state machine, simulasi payment/upload |
| **2 (selesai)** | Backend (Express+SQLite), Template Slot Editor (`/admin`), compositing foto asli ke posisi slot, auto-cleanup retensi file |
| **3 (selesai)** | Integrasi Midtrans QRIS asli + harga per template + webhook notifikasi |
| **4 (selesai)** | Kamera DSLR lewat jembatan Electron, bungkus jadi desktop app (`.exe`) |
| **5 (selesai)** | Login multi-role (admin/kasir), Template Editor jadi sistem N-layer, arsip foto lokal permanen, Cloud Dashboard multi-toko |
| **6** | Fitur lanjutan: reset password lewat UI, laporan/analytics per toko di Cloud Dashboard, print langsung dari kiosk |
| **7 (direncanakan)** | Adopsi fitur dari Jepreto (jepreto.com) — lihat detail di bawah |

### Rencana Fase 7: Fitur terinspirasi dari Jepreto

Dibahas 2026-10-10. User mau fitur-fitur ini DIGABUNG ke POPSNAP biar makin
lengkap/maksimal, dikerjakan belakangan (belum sekarang):

- **Antrian digital** — tamu ambil nomor antrian, ada layar tampilan nomor
  yang lagi dipanggil (buat event rame: wedding/kantor/kampus).
- **Galeri Event** — semua foto dari 1 event (bukan cuma 1 sesi) digabung
  jadi 1 galeri yang bisa diakses tamu lewat link/QR bersama.
- **Cetak ulang (reprint) langsung dari kiosk** — tombol print tambahan di
  layar hasil tanpa harus mengulang sesi; perlu disambung ke printer fisik
  (belum ada sama sekali sekarang, composeImage.js baru menghasilkan file,
  belum ada jalur print).
- **Laporan & analitik transaksi lebih lengkap** di Cloud Dashboard — omzet,
  tren per toko, dsb (sekarang baru ringkasan dasar: jumlah sesi & omzet).
- **Template Marketplace + Creator Program** (ala Jepreto) — **versi FULL**
  sesuai keputusan user, bukan versi sederhana: akun creator, upload
  template publik, approval, kuota premium per bulan, dan monetisasi/
  royalti. Ini scope-nya besar & beda model bisnis dari sisa app (POPSNAP
  selama ini software internal per-toko, bukan platform publik) — perlu
  desain sistem akun creator terpisah, alur approval, dan skema pembayaran
  ke creator sebelum mulai coding.

Referensi fitur Jepreto (dibaca 2026-10-10, lihat jepreto.com/pricing):
paket software mereka Rp600rb/bulan per PC, isinya termasuk monitoring
real-time, laporan/analitik transaksi, multi-device, manajemen template,
QRIS+offline, antrian digital, galeri event, cetak tambahan — sebagian
besar sudah ada di POPSNAP, 4 item di atas yang masih kurang.

### Rencana Fase 7 (lanjutan): Fitur terinspirasi dari Photobooth.plus

Dibahas 2026-10-10 (sumber: photobooth.plus/id — web photobooth gratis
untuk konsumen, beda model bisnis dari POPSNAP/Jepreto yang B2B kiosk
berbayar). Fitur yang MAU digabung ke POPSNAP:

- **Filter jauh lebih banyak & dikelompokkan** — sekarang Editor cuma punya
  5 filter dasar (none/bw/sepia/vivid/soft) di `EditorScreen.jsx`. Target:
  puluhan filter, dikelompokkan ala kategori Film/Studio/Cinematic/Cute/
  B&W/Korean-style.
- **Preview filter LIVE di wajah sebelum jepret** — terapkan filter CSS ke
  `LiveView` saat masih di `PhotoSessionScreen.jsx` (sebelum capture), bukan
  cuma diterapkan belakangan di layar Editor seperti sekarang.
- **Sistem stiker beneran** — sekarang cuma 6 emoji yang numpuk asal di
  `EditorScreen.jsx` (`STICKERS` array + posisi hardcoded). Target: library
  220+ stiker (kategori/pack), bisa diseret/diposisikan/diresize per stiker,
  bukan cuma emoji nempel di posisi tetap.
- **Library background siap pakai** — 39+ background buat dipasang ke
  template lewat Template Editor, bukan cuma upload PNG sendiri.
- **One-click share lewat email** — tambahan di `ResultScreen.jsx`, kirim
  hasil foto/link download langsung ke email tamu, selain QR yang sudah ada.

**Diputuskan SKIP (gak relevan dengan model bisnis POPSNAP), kecuali user
berubah pikiran:**
- Akun cloud gratis utk guest nyimpen histori lintas device — cocoknya buat
  produk B2C gratisan, POPSNAP kiosk bayar-per-sesi gak butuh ini.
- Rental marketplace (platform penyewaan photobooth antar event organizer)
  — bisnis yang sama sekali berbeda dari software kiosk per-toko.

### Rencana Fase 7 (lanjutan): Fitur terinspirasi dari YMT.IDN (ymtbooth.net)

Dibahas 2026-10-10. Software lokal Indonesia juga (mirip Jepreto), fokus ke
integrasi hardware PC + versi Android terpisah.

- **Print 4R/A4 langsung dari printer** — menguatkan item reprint yang
  sudah dicatat di rencana Jepreto di atas (digabung jadi satu item, bukan
  dobel): YMT buktiin ini feasible lewat driver printer biasa (bukan cloud
  print service).
- **Rekap pemasukan** — sama dengan item "laporan & analitik transaksi"
  yang sudah dicatat di rencana Jepreto (digabung, bukan dobel).
- **Integrasi SDK native kamera** (Canon EDSDK 13.20.21, Nikon SDK + Remote
  SDK 2.0, Sony Camera Remote SDK 2.02) — alternatif/pelengkap untuk
  `electron/dslrBridge.js` yang sekarang masih pakai digiCamControl
  (Windows, lewat webserver HTTP) & gPhoto2 (Mac/Linux). SDK resmi per
  merek biasanya lebih stabil & lebih cepat capture-nya, TAPI jauh lebih
  berat dikerjakan: perlu native binding C++/Electron per merek kamera,
  dan masing-masing py lisensi developer sendiri (Canon EDSDK perlu
  approval dari Canon). **Opsi lanjutan, bukan prioritas** — baru worth
  dikerjakan kalau bridge yang sekarang kebukti bermasalah di lapangan.
- **Versi Android/tablet native** — YMT punya app Android terpisah (bukan
  cuma buka browser di tablet), dengan harga lisensi sendiri. Ini BUKAN
  sekadar fitur tambahan, ini platform baru (app Android native beda dari
  web app POPSNAP yang sekarang). **Perlu didiskusikan terpisah** sebagai
  keputusan produk, bukan langsung masuk antrian fitur — baru dicatat di
  sini sebagai ide, belum ada keputusan mau dikerjakan atau tidak.

## Catatan Fase 4

- Mode kamera diatur lewat 1 baris config (`cameraMode` di `appConfig.js`) —
  gampang pindah webcam ↔ DSLR tanpa ubah kode lain.
- Live preview DSLR bekerja dengan cara "polling" — ambil frame preview
  berulang tiap 200ms dan kirim sebagai gambar, BUKAN video stream asli
  seperti webcam. Ini karena baik digiCamControl maupun gPhoto2 tidak
  menyediakan live video stream langsung ke web content. Kalau preview
  terasa kurang mulus, coba turunkan `intervalMs` di `dslrBridge.js`
  (`startPreviewLoop`) — tapi makin kecil, makin berat buban kamera.
- Kalau kamera DSLR tidak terdeteksi, cek: (1) mode kamera di badan kamera
  sudah "PC Remote"/"Tethering", (2) driver USB sudah terinstall,
  (3) tidak ada software lain (misal aplikasi resmi merek kamera) yang
  lagi pegang koneksi kamera secara bersamaan.

## Catatan Fase 3

- **PENTING soal jaringan**: link download QR & gambar template sekarang pakai
  IP LAN PC booth (auto-terdeteksi), BUKAN `localhost`. Ini wajib supaya HP
  konsumen yang scan QR (nyambung ke WiFi booth yang sama) beneran bisa buka
  link-nya. Kalau backend startup dan log-nya nunjukin
  `[peringatan] Gagal deteksi IP LAN otomatis`, set `PUBLIC_HOST` manual di
  `.env` sesuai IP WiFi PC kamu (cek lewat `ipconfig` di Windows).

- Voucher sudah fungsional beneran: `/api/voucher/generate` untuk kasir bikin kode
  baru, `/api/voucher/validate` dipanggil otomatis dari layar Payment.
- Status pembayaran QRIS dibaca dari tabel `payments` di database lokal, yang
  di-update lewat **webhook** (`/api/payment/notification`) saat Midtrans kirim
  notifikasi — bukan polling live ke Midtrans tiap detik. Ini pola yang direkomendasikan
  Midtrans sendiri (lebih cepat & tidak kena rate limit).
- Kalau backend belum dijalankan, `templateService.js` otomatis fallback ke
  `localStorage` supaya Template Slot Editor tetap bisa dicoba-coba tanpa backend
  (data akan hilang saat refresh — cuma buat eksplorasi UI).

## Catatan penting

- **Kamera**: sekarang pakai webcam browser (`getUserMedia`), jalan di device apa saja.
  Untuk DSLR, `useCamera.js` sudah disiapkan slot-nya (`cameraMode: "dslr"` di config) —
  tinggal disambung ke jembatan Electron+gPhoto2/digiCamControl di Fase 4.
- **Template PNG**: struktur data yang dipakai `{ id, name, thumbnailUrl, slots }`.
  Nanti tinggal ganti `templatesByCategory` di `App.jsx` dengan hasil fetch dari backend
  (folder template PNG yang kamu upload lewat admin panel).
- **Orientasi kamera** (portrait/landscape) sudah didukung di state (`session.orientation`),
  tinggal disambung ke UI pemilihan orientasi (misal otomatis dari ukuran template yang dipilih).


---

## Membuat aplikasi .exe (installer Windows)

1. Di PC yang punya Node.js 22+ dan internet, klik dua kali **`build-exe.bat`** (folder utama).
2. Tunggu beberapa menit. Installer jadi di `electron\dist\POPSNAP Setup x.x.x.exe` — salin ke PC booth lalu install.
3. PC booth TIDAK perlu Node.js (backend memakai Node bawaan aplikasi).
4. Data (database, upload, kunci login) disimpan di `%AppData%\POPSNAP\`, arsip foto di `Dokumen\POPSNAP-Photos` (bisa diubah di Admin > Pengaturan > Umum).
5. Kalau pakai Midtrans, taruh file `.env` (MIDTRANS_SERVER_KEY dll.) di `%AppData%\POPSNAP\.env`.
6. Kamera DSLR tetap lewat digiCamControl (lihat bagian kamera) — jalan juga di .exe.
7. Pakai kamera webcam: izin kamera diminta saat pertama kali.

**Keluar dari aplikasi .exe (mirip dslrBooth):** tombol close / Alt+F4 meminta PIN, lalu jendela disembunyikan ke ikon POPSNAP di dekat jam (system tray). Dari tray: klik = buka lagi; klik kanan > "Keluar (PIN)" = minta PIN lalu aplikasi benar-benar ditutup. Ikon gembok di layar booth: PIN -> Menu petugas (buka dashboard admin / tutup aplikasi). Tamu tidak bisa menyembunyikan atau menutup aplikasi tanpa PIN. BUAT PIN dulu di Admin > Umum > Security Pin (tanpa PIN, semua aksi di atas terbuka untuk siapa saja). Saat layar penuh, jendela selalu di paling atas. Catatan: Windows tidak mengizinkan aplikasi memblokir Ctrl+Alt+Del / tombol Windows; untuk kunci total gunakan "Assigned Access" (kiosk mode) atau akun pengguna terbatas. Log backend: `%AppData%\POPSNAP\backend.log`. Dashboard admin di aplikasi .exe otomatis logout dan kembali ke layar booth bila tidak disentuh 10 menit.

## Kamera lewat SDK pabrikan (Canon / Nikon) — alternatif digiCamControl
Pengaturan › Kamera › sumber DSLR › **Penghubung kamera**: digiCamControl (bawaan), **Canon SDK**, **Nikon SDK** (pilih modelnya), atau **Sony SDK**.
File SDK ikut terpasang di installer, jadi tidak perlu menyalin apa pun ke PC booth. SEBELUM `build-exe.bat`, taruh file SDK di folder proyek:
- `backend\sdk\canon\` : `canon_sdk_bridge.exe`, `EDSDK.dll`, `EdsImage.dll`
- `backend\sdk\sony\` : seluruh isi folder `sony` dari zip (termasuk subfolder `CrAdapter`)
- `backend\sdk\nikon\<MODEL>\` : isi folder model dari zip Nikon (mis. `backend\sdk\nikon\D850\nikon_sdk_bridge.exe`, dst.; `Z_SERIES` untuk seri Z)
(Cukup salin folder `canon`, `nikon`, dan `sony` dari `camera_sdks` ke `backend\sdk`. Folder `driver_assistant` tidak dipakai.)
Pemakaian pertama: file SDK otomatis disalin ke `%AppData%\POPSNAP\sdk` (folder instalasi tidak bisa ditulisi).
Tutup aplikasi kamera lain (digiCamControl, EOS Utility, NX Tether) — satu kamera hanya bisa dipakai satu aplikasi. Atur kualitas foto kamera ke JPEG.
Catatan: program perantara SDK belum teruji dengan kamera asli; kalau gagal, pesan error + log tampil di Pengaturan › Kamera.

Live view DSLR dikirim sebagai aliran video MJPEG dari backend (`/api/camera/dslr/stream`), jauh lebih mulus daripada mengambil gambar satu per satu.

## Canon live view lancar (program perantara buatan sendiri)

`native/canon/` berisi kode `popsnap_canon_bridge.cpp` — pengganti `canon_sdk_bridge.exe` yang mengirim frame live view & foto
langsung lewat pipa (tanpa file di disk, tanpa polling). Cara pakai:

1. Pasang Visual Studio Build Tools (komponen "Desktop development with C++").
2. Start › cari **x86 Native Tools Command Prompt for VS 2022** (harus x86, bukan x64).
3. `cd` ke folder `native\canon`, jalankan `build.bat` → muncul `popsnap_canon_bridge.exe`.
4. Salin ke `backend\sdk\canon\` (satu folder dengan `EDSDK.dll` & `EdsImage.dll`). Hapus `electron\dist`, jalankan `build-exe.bat`.
5. Pengaturan › Kamera: driver **Canon SDK**. Jika file ini ada, otomatis dipakai; jika tidak, dipakai program lama.
