// Rotasi gambar kamera: pengaturan manual admin (Rotation) + putar 90° otomatis kalau "Orientasi kamera" meminta
// portrait/landscape tetapi gambar yang datang dari kamera berbentuk sebaliknya (mis. webcam dipasang tegak).
export function effectiveRotation(manual = 0, orientation = "auto", vw = 0, vh = 0) {
  if ((orientation !== "portrait" && orientation !== "landscape") || !vw || !vh) return manual;
  const sideways = manual === 90 || manual === 270;
  const portraitNow = sideways ? vw > vh : vh > vw;
  return portraitNow === (orientation === "portrait") ? manual : (manual + 90) % 360;
}
