// ==========================================================
// Pilih lokasi simpan (Save As) & pilih file (Open) — jendela bawaan sistem operasi.
//
//  - Aplikasi desktop (.exe): dialog Windows lewat Electron (IPC).
//  - Chrome / Edge (browser): File System Access API (showSaveFilePicker / showOpenFilePicker); folder terakhir diingat.
//  - Browser lain (Firefox / Safari): tidak ada API-nya -> terpaksa unduh biasa ke folder Downloads
//    (aktifkan "Tanyakan lokasi simpan setiap kali" di pengaturan unduhan browser untuk mendapat dialog).
//
// PENTING: showSaveFilePicker hanya boleh dipanggil TEPAT saat pengguna mengklik (masih dalam "user activation").
// Karena itu pemanggil WAJIB memanggil chooseSaveTarget() lebih dulu, SEBELUM pekerjaan lama (fetch gambar, render, dll).
// ==========================================================

const isAbort = (err) => err && (err.name === "AbortError" || err.code === 20);

function downloadFallback(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/**
 * Tampilkan dialog "Simpan sebagai".
 * @returns {Promise<null | { write(blob): Promise<{ where: string, askedLocation: boolean }>, discard(): Promise<void> }>}
 *          null = pengguna membatalkan dialog.
 */
export async function chooseSaveTarget(filename, { description = "File", mime = "application/octet-stream", ext = ".zip", idKey = "popsnap-files" } = {}) {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined;

  if (api?.chooseSavePath) {
    const path = await api.chooseSavePath({ defaultName: filename, description, ext, idKey });
    if (!path) return null;
    return {
      async write(blob) {
        await api.writeChosenFile(path, new Uint8Array(await blob.arrayBuffer()));
        return { where: path, askedLocation: true };
      },
      async discard() {},
    };
  }

  if (typeof window !== "undefined" && typeof window.showSaveFilePicker === "function") {
    let handle;
    try {
      handle = await window.showSaveFilePicker({ suggestedName: filename, id: idKey, types: [{ description, accept: { [mime]: [ext] } }] });
    } catch (err) {
      if (isAbort(err)) return null;
      throw err;
    }
    return {
      async write(blob) {
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        return { where: handle.name, askedLocation: true };
      },
      async discard() { try { await handle.remove?.(); } catch { /* abaikan */ } }, // bersihkan berkas kosong kalau pembuatan gagal
    };
  }

  return {
    async write(blob) {
      downloadFallback(blob, filename);
      return { where: filename, askedLocation: false };
    },
    async discard() {},
  };
}

/**
 * Tampilkan dialog "Buka file". Mengembalikan File, null (dibatalkan), atau undefined bila browser tidak mendukung
 * (pemanggil lalu memakai <input type="file"> biasa — yang juga membuka dialog pilih file).
 */
export async function chooseOpenFile({ description = "File", accept = {}, idKey = "popsnap-files" } = {}) {
  if (typeof window === "undefined" || typeof window.showOpenFilePicker !== "function" || window.electronAPI?.isElectron) return undefined;
  try {
    const [handle] = await window.showOpenFilePicker({ id: idKey, multiple: false, types: [{ description, accept }] });
    return await handle.getFile();
  } catch (err) {
    if (isAbort(err)) return null;
    return undefined;
  }
}
