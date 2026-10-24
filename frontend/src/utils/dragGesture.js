// Gestur sentuh/mouse lewat pointer events (sama untuk mouse, jari, pena).
//
// trackPointerDrag(e, opts) dipanggil saat jari/mouse menekan sebuah item. Ada 3 hasil:
//  - Ketukan (bergeser < threshold px): tidak ada callback, `click` biasa jalan.
//  - "drag"  : item diseret (onMove tiap gerakan, onEnd saat dilepas).
//  - "scroll": hanya kalau `scrollEl` diberikan. Geseran yang condong ATAS-BAWAH menggulung daftar (scrollEl) sambil
//              mengikuti jari, lalu meluncur pelan (inertia) saat dilepas. Dikerjakan manual karena sebagian layar
//              sentuh Windows dilaporkan sebagai "mouse", sehingga scroll bawaan browser tidak bisa diandalkan.
// Aturan memilih: seret hanya kalau geseran jelas ke SAMPING (|dx| > |dy| * horizontalRatio); selain itu = scroll.
// Dengan begitu geseran atas-bawah yang sedikit miring tidak salah dianggap menyeret foto.
export function trackPointerDrag(e, { onMove, onEnd, threshold = 10, scrollEl = null, horizontalRatio = 1.4 }) {
  const sx = e.clientX, sy = e.clientY;
  const top0 = scrollEl ? scrollEl.scrollTop : 0;
  let mode = null; // null | "drag" | "scroll"
  let lastY = sy, lastT = performance.now(), vel = 0; // px per ms
  const lockScroll = (ev) => { if (ev.cancelable) ev.preventDefault(); };

  const cleanup = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    window.removeEventListener("touchmove", lockScroll);
  };
  function move(ev) {
    if (!mode) {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (Math.hypot(dx, dy) < threshold) return;
      mode = scrollEl && !(Math.abs(dx) > Math.abs(dy) * horizontalRatio) ? "scroll" : "drag";
      if (mode === "drag") window.addEventListener("touchmove", lockScroll, { passive: false });
    }
    if (mode === "scroll") {
      scrollEl.scrollTop = top0 - (ev.clientY - sy);
      const now = performance.now(), dt = Math.max(1, now - lastT);
      vel = 0.8 * vel + 0.2 * ((lastY - ev.clientY) / dt);
      lastY = ev.clientY; lastT = now;
    } else {
      onMove?.(ev);
    }
  }
  function end(ev) {
    cleanup();
    if (mode === "scroll") {
      if (performance.now() - lastT < 80) glide(scrollEl, vel);
      onEnd?.(ev, true, "scroll");
    } else if (mode === "drag") {
      onEnd?.(ev, ev.type === "pointerup", "drag");
    }
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

/** Meluncur pelan setelah jari dilepas (kecepatan awal px/ms, melambat sendiri). */
function glide(el, v) {
  let vel = v * 16; // px per frame
  const step = () => {
    if (Math.abs(vel) < 0.4) return;
    const before = el.scrollTop;
    el.scrollTop = before + vel;
    if (el.scrollTop === before) return; // sudah di ujung
    vel *= 0.94;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
