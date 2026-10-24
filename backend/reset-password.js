// ==========================================================
// Reset Password — CLI tool
//
// Buat kalau lupa password tapi GAK MAU kehilangan data template
// yang udah dibikin (beda sama hapus folder db yang ngilangin semuanya).
//
// Cara pakai (di folder backend):
//   node reset-password.js <username> <password_baru>
//
// Contoh:
//   node reset-password.js admin passwordbaru123
// ==========================================================

const { hashPassword } = require("./auth");
const db = require("./db");

const [, , username, newPassword] = process.argv;

if (!username || !newPassword) {
  console.log("Cara pakai: node reset-password.js <username> <password_baru>");
  console.log("Contoh:     node reset-password.js admin passwordbaru123");
  process.exit(1);
}

if (newPassword.length < 6) {
  console.log("Password baru minimal 6 karakter.");
  process.exit(1);
}

const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);

if (!user) {
  console.log(`Username "${username}" gak ketemu. Daftar username yang ada:`);
  const all = db.prepare("SELECT username, role FROM users").all();
  if (all.length === 0) {
    console.log("(belum ada akun sama sekali — jalankan backend & buka /admin buat setup pertama kali)");
  } else {
    all.forEach((u) => console.log(`  - ${u.username} (${u.role})`));
  }
  process.exit(1);
}

const { hash, salt } = hashPassword(newPassword);
db.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE username = ?").run(hash, salt, username);

console.log(`Password buat "${username}" berhasil diganti. Semua data template & histori TETAP AMAN, gak kehapus.`);
console.log("Login pakai password baru itu sekarang.");
