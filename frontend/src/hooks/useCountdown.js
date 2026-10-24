import { useEffect, useRef, useState } from "react";

/**
 * useCountdown — hitung mundur dalam detik.
 * @param {number} seconds - durasi awal
 * @param {() => void} onExpire - dipanggil sekali saat mencapai 0
 * @param {boolean} active - kalau false, timer pause
 */
export default function useCountdown(seconds, onExpire, active = true) {
  const [remaining, setRemaining] = useState(seconds);
  const expiredRef = useRef(false);

  // reset kalau durasi awal berubah (misal habis extend waktu)
  useEffect(() => {
    setRemaining(seconds);
    expiredRef.current = false;
  }, [seconds]);

  useEffect(() => {
    if (!active) return;
    if (remaining <= 0) {
      if (!expiredRef.current) {
        expiredRef.current = true;
        onExpire?.();
      }
      return;
    }
    const id = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(id);
  }, [remaining, active, onExpire]);

  const addSeconds = (extra) => setRemaining((r) => r + extra);

  return { remaining, addSeconds };
}
