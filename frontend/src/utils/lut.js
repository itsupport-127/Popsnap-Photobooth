// LUT warna 3D (format .cube, dipakai DaVinci Resolve, Lightroom, Photoshop, dll).
//  - Admin mengimpor .cube -> diubah jadi gambar PNG "strip" (N*N x N piksel) -> diunggah sebagai aset biasa.
//  - Layar booth memuat PNG itu dan menerapkannya lewat WebGL (CPU sebagai cadangan), baik untuk pratinjau maupun hasil akhir.
// Susunan strip: slice biru ke-b berada di x = b*N .. b*N+N-1; di dalam slice, x = merah, y = hijau.
import { useEffect, useState } from "react";

export const MAX_LUT_SIZE = 65;

/** Baca teks .cube -> { size, title, data: Float32Array(size^3*3) } dengan merah paling cepat berganti (urutan standar .cube). */
export function parseCube(text) {
  let size3 = 0, size1 = 0, title = "";
  let dmin = [0, 0, 0], dmax = [1, 1, 1];
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === "#") continue;
    const t = line.split(/\s+/);
    const key = t[0].toUpperCase();
    if (key === "TITLE") { title = line.replace(/^TITLE\s*/i, "").replace(/^"|"$/g, ""); continue; }
    if (key === "LUT_3D_SIZE") { size3 = parseInt(t[1], 10); continue; }
    if (key === "LUT_1D_SIZE") { size1 = parseInt(t[1], 10); continue; }
    if (key === "DOMAIN_MIN") { dmin = t.slice(1, 4).map(Number); continue; }
    if (key === "DOMAIN_MAX") { dmax = t.slice(1, 4).map(Number); continue; }
    if (/^[A-Z_]+$/.test(key)) continue; // kata kunci lain (mis. LUT_3D_INPUT_RANGE) diabaikan
    if (t.length >= 3) {
      const r = Number(t[0]), g = Number(t[1]), b = Number(t[2]);
      if (![r, g, b].every(Number.isFinite)) throw new Error("Baris data LUT tidak valid.");
      rows.push(r, g, b);
    }
  }
  const norm = (v, c) => { const span = dmax[c] - dmin[c] || 1; return Math.min(1, Math.max(0, (v - dmin[c]) / span)); };
  if (size3) {
    if (size3 < 2 || size3 > MAX_LUT_SIZE) throw new Error(`Ukuran LUT 3D ${size3} tidak didukung (2–${MAX_LUT_SIZE}).`);
    if (rows.length !== size3 ** 3 * 3) throw new Error(`Jumlah data LUT tidak sesuai (butuh ${size3 ** 3} baris, ada ${rows.length / 3}).`);
    const data = new Float32Array(rows.length);
    for (let i = 0; i < rows.length; i++) data[i] = Math.min(1, Math.max(0, rows[i]));
    return { size: size3, title, data };
  }
  if (size1) {
    if (size1 < 2 || rows.length !== size1 * 3) throw new Error("Data LUT 1D tidak sesuai.");
    const N = 33, data = new Float32Array(N ** 3 * 3);
    const curve = (v, c) => {
      const p = norm(v, c) * (size1 - 1), i = Math.min(size1 - 2, Math.floor(p)), f = p - i;
      return rows[i * 3 + c] * (1 - f) + rows[(i + 1) * 3 + c] * f;
    };
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
      const o = (r + g * N + b * N * N) * 3;
      data[o] = Math.min(1, Math.max(0, curve(r / (N - 1), 0)));
      data[o + 1] = Math.min(1, Math.max(0, curve(g / (N - 1), 1)));
      data[o + 2] = Math.min(1, Math.max(0, curve(b / (N - 1), 2)));
    }
    return { size: N, title, data };
  }
  throw new Error("File .cube tidak dikenali (tidak ada LUT_3D_SIZE / LUT_1D_SIZE).");
}

/** LUT hasil parse -> kanvas strip (N*N x N). */
export function cubeToStrip({ size: N, data }) {
  const c = document.createElement("canvas");
  c.width = N * N; c.height = N;
  const ctx = c.getContext("2d");
  const im = ctx.createImageData(N * N, N);
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
    const s = (r + g * N + b * N * N) * 3, d = (g * N * N + b * N + r) * 4;
    im.data[d] = Math.round(data[s] * 255); im.data[d + 1] = Math.round(data[s + 1] * 255); im.data[d + 2] = Math.round(data[s + 2] * 255); im.data[d + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  return c;
}

export const canvasToPngBlob = (canvas) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Gagal membuat PNG"))), "image/png"));

// ---------- Muat LUT dari alamat PNG ----------
const lutCache = new Map();
export function loadLut(url, size) {
  const key = `${url}|${size}`;
  if (!lutCache.has(key)) {
    lutCache.set(key, new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve({ size, img, url });
      img.onerror = () => { lutCache.delete(key); reject(new Error("LUT gagal dimuat")); };
      img.src = url;
    }));
  }
  return lutCache.get(key);
}

// ---------- WebGL ----------
const VS = "attribute vec2 p; varying vec2 v; void main(){ v = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }";
const FS = `precision highp float; varying vec2 v; uniform sampler2D uImg; uniform sampler2D uLut; uniform float uSize; uniform float uMix;
vec3 look(vec3 c){ float n=uSize; float b=c.b*(n-1.0); float b0=floor(b); float b1=min(b0+1.0,n-1.0); float f=b-b0;
  float x=c.r*(n-1.0)+0.5; float y=(c.g*(n-1.0)+0.5)/n;
  return mix(texture2D(uLut,vec2((b0*n+x)/(n*n),y)).rgb, texture2D(uLut,vec2((b1*n+x)/(n*n),y)).rgb, f); }
void main(){ vec4 c=texture2D(uImg,v); gl_FragColor=vec4(mix(c.rgb, look(c.rgb), uMix), 1.0); }`;

let GL = null; // { canvas, gl, prog, texLut: WeakMap }
function glSetup() {
  if (GL !== null) return GL || null;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error("no webgl");
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    GL = { canvas, gl, prog, texLut: new WeakMap() };
  } catch { GL = false; }
  return GL || null;
}

function makeTex(gl, unit, source, flipY) {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

const srcSize = (s) => [s.naturalWidth || s.videoWidth || s.width, s.naturalHeight || s.videoHeight || s.height];

/** Terapkan LUT ke gambar. Mengembalikan kanvas baru. intensity 0-100, maxSide = batas sisi terpanjang (hemat memori untuk pratinjau). */
export function applyLut(source, lut, intensity = 100, maxSide = Infinity) {
  const [sw, sh] = srcSize(source);
  const g = glSetup();
  const limit = Math.min(maxSide, g ? g.gl.getParameter(g.gl.MAX_TEXTURE_SIZE) : 8192);
  const sc = Math.min(1, limit / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * sc)), h = Math.max(1, Math.round(sh * sc));
  const base = document.createElement("canvas");
  base.width = w; base.height = h;
  base.getContext("2d").drawImage(source, 0, 0, w, h);
  const mix = Math.min(1, Math.max(0, intensity / 100));
  const out = document.createElement("canvas");
  out.width = w; out.height = h;

  if (g) {
    const { gl, canvas, prog } = g;
    canvas.width = w; canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog);
    const imgTex = makeTex(gl, 0, base, 1);
    let lutTex = g.texLut.get(lut.img);
    if (!lutTex) { lutTex = makeTex(gl, 1, lut.img, 0); g.texLut.set(lut.img, lutTex); }
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lutTex);
    gl.uniform1i(gl.getUniformLocation(prog, "uImg"), 0);
    gl.uniform1i(gl.getUniformLocation(prog, "uLut"), 1);
    gl.uniform1f(gl.getUniformLocation(prog, "uSize"), lut.size);
    gl.uniform1f(gl.getUniformLocation(prog, "uMix"), mix);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    out.getContext("2d").drawImage(canvas, 0, 0);
    gl.deleteTexture(imgTex);
    return out;
  }

  // Cadangan CPU (tanpa WebGL): interpolasi trilinear
  const N = lut.size;
  const lc = document.createElement("canvas");
  lc.width = lut.img.width; lc.height = lut.img.height;
  const lctx = lc.getContext("2d");
  lctx.drawImage(lut.img, 0, 0);
  const L = lctx.getImageData(0, 0, N * N, N).data;
  const at = (r, gg, b, c) => L[(gg * N * N + b * N + r) * 4 + c];
  const ctx = out.getContext("2d");
  const im = base.getContext("2d").getImageData(0, 0, w, h);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const px = [d[i], d[i + 1], d[i + 2]].map((v) => (v / 255) * (N - 1));
    const [r0, g0, b0] = px.map(Math.floor);
    const [r1, g1, b1] = [Math.min(N - 1, r0 + 1), Math.min(N - 1, g0 + 1), Math.min(N - 1, b0 + 1)];
    const [fr, fg, fb] = [px[0] - r0, px[1] - g0, px[2] - b0];
    for (let c = 0; c < 3; c++) {
      const c00 = at(r0, g0, b0, c) * (1 - fr) + at(r1, g0, b0, c) * fr, c10 = at(r0, g1, b0, c) * (1 - fr) + at(r1, g1, b0, c) * fr;
      const c01 = at(r0, g0, b1, c) * (1 - fr) + at(r1, g0, b1, c) * fr, c11 = at(r0, g1, b1, c) * (1 - fr) + at(r1, g1, b1, c) * fr;
      const v = (c00 * (1 - fg) + c10 * fg) * (1 - fb) + (c01 * (1 - fg) + c11 * fg) * fb;
      d[i + c] = d[i + c] * (1 - mix) + v * mix;
    }
  }
  ctx.putImageData(im, 0, 0);
  return out;
}

// ---------- Pratinjau di layar (React) ----------
const outCache = new Map(); // kunci -> dataURL (dibatasi supaya memori tidak membengkak)
function remember(key, val) { outCache.set(key, val); if (outCache.size > 80) outCache.delete(outCache.keys().next().value); }

const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = src; });

/** Alamat gambar yang SUDAH diberi LUT (dataURL ukuran pratinjau). Tanpa LUT -> alamat aslinya. LUT belum siap -> null. */
export function useLutSrc(src, lut, maxSide = 900) {
  const key = src && lut ? `${src.length > 200 ? src.slice(0, 80) + src.length + src.slice(-40) : src}|${lut.url}|${lut.size}|${lut.intensity}|${maxSide}` : null;
  const [done, setDone] = useState({ key: null, out: null });
  useEffect(() => {
    if (!key || outCache.has(key)) return undefined;
    let dead = false;
    (async () => {
      try {
        const [img, l] = await Promise.all([loadImg(src), loadLut(lut.url, lut.size)]);
        const out = applyLut(img, l, lut.intensity ?? 100, maxSide).toDataURL("image/jpeg", 0.9);
        remember(key, out);
        if (!dead) setDone({ key, out });
      } catch { if (!dead) setDone({ key, out: src }); } // gagal -> tampilkan foto asli daripada kosong
    })();
    return () => { dead = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!key) return src;
  return outCache.get(key) ?? (done.key === key ? done.out : null);
}
