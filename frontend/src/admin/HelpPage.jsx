import React from "react";
import { Card, Page } from "./ui";

export default function HelpPage() {
  return (
    <Page title="Bantuan" subtitle="Panduan singkat pemakaian booth.">
      <Card title="ALUR BAYAR DI KASIR (VOUCHER) — BISA OFFLINE">
        <ol className="list-decimal pl-5 text-[13px] text-[#262A38] flex flex-col gap-1.5">
          <li>Pelanggan membayar di kasir (tunai / transfer / aplikasi kasir).</li>
          <li>Kasir membuka menu <b>Voucher</b>, klik <b>Buat Voucher</b>, lalu memberikan kode 8 huruf ke pelanggan.</li>
          <li>Di booth, pelanggan memilih template, lalu memasukkan kode voucher.</li>
          <li>Satu kode hanya bisa dipakai satu kali. Salah buat? Klik <b>Batalkan</b> di daftar voucher.</li>
        </ol>
      </Card>
      <Card title="KALAU INTERNET MATI">
        <p className="text-[13px] text-[#262A38]">Seluruh alur foto, editor, dan voucher tetap jalan. Hanya QRIS yang butuh internet. Pada mode <b>Otomatis</b> atau <b>Voucher + QRIS</b>, QRIS hilang sendiri saat internet mati dan pelanggan diarahkan memakai voucher. Kasir juga bisa memaksa <b>Voucher saja</b> kapan pun dari menu Pembayaran.</p>
        <p className="text-[13px] text-[#262A38] mt-2">QR download foto hanya bisa dibuka HP yang tersambung ke WiFi booth selama upload ke cloud belum dipasang.</p>
      </Card>
      <Card title="PERAN & HAK AKSES">
        <p className="text-[13px] text-[#262A38]">Ada tiga peran: <b>Super Admin</b> (semua hak, satu-satunya yang bisa mengelola pengguna), <b>Admin</b>, dan <b>Kasir</b>. Super Admin mengatur apa yang boleh dilakukan Admin dan Kasir di menu <b>Pengguna → Hak Akses Peran</b>, dan bisa memberi hak khusus ke satu akun saja. Tiap orang bisa mengganti username dan password-nya sendiri di <b>Akun Saya</b>.</p>
      </Card>
      <Card title="LOG AKTIVITAS">
        <p className="text-[13px] text-[#262A38]">Menu <b>Log</b> mencatat login (termasuk yang gagal), perubahan akun dan hak akses, pengaturan, template, voucher, dan mode pembayaran, lengkap dengan siapa, kapan, dan dari alamat IP mana. Password dan key rahasia tidak pernah dicatat. Log hanya bisa dibaca (tidak bisa diedit atau dihapus) dan otomatis dibersihkan setelah 180 hari.</p>
      </Card>
      <Card title="STATUS KAMERA DI LAYAR DEPAN">
        <p className="text-[13px] text-[#262A38]">Titik hijau = kamera siap dan tombol Start aktif. Merah = kamera tidak terdeteksi, izin ditolak, atau sedang dipakai aplikasi lain. Cek kabel USB lalu tekan <b>Coba lagi</b>.</p>
      </Card>
      <Card title="INTEGRASI APLIKASI KASIR">
        <p className="text-[13px] text-[#262A38]">Ambil API key dan contoh perintah di menu <b>Pembayaran → Integrasi Aplikasi Kasir</b>. Aplikasi kasir memanggil endpoint tersebut untuk membuat voucher otomatis begitu transaksi dibayar.</p>
      </Card>
    </Page>
  );
}
