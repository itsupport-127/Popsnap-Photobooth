import { useEffect, useState } from "react";

// Bentuk layar: "portrait" (tegak) bila lebar/tinggi < 20/21 (~0,95), "square" (kotak) sampai 23/20 (1,15), selain itu "landscape".
// Batas yang sama dipakai media query (aspect-ratio) di index.css.
export const shapeOf = (w, h) => (w / h < 20 / 21 ? "portrait" : w / h < 23 / 20 ? "square" : "landscape");

export default function useShape() {
  const [shape, setShape] = useState(() => shapeOf(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const on = () => setShape(shapeOf(window.innerWidth, window.innerHeight));
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return shape;
}
