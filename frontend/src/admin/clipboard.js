/**
 * Salin teks ke clipboard. Memakai Clipboard API (butuh HTTPS atau localhost); kalau tidak tersedia
 * (mis. admin dibuka lewat http://192.168.x.x), jatuh ke cara lama lewat textarea tersembunyi.
 * @returns {Promise<boolean>} berhasil atau tidak
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* lanjut ke cara lama */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:-1000px;left:0;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  return ok;
}
