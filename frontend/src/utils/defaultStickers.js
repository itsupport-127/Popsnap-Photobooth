// Stiker bawaan (vektor sederhana) — dipakai kalau admin belum mengunggah stiker apa pun.
// Berupa data URL SVG, jadi tidak butuh file dan tetap bisa digambar ke canvas hasil akhir.
const svg = (inner) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`)}`;
const S = 'stroke="#181B23" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"';

const shapes = {
  heart: `<path d="M50 88C20 64 10 46 10 32a20 20 0 0 1 40-6 20 20 0 0 1 40 6c0 14-10 32-40 56z" fill="#E02843" ${S}/>`,
  star: `<path d="M50 8l12.5 27 29.5 3.5-22 20 6 29L50 73 24 87.500l6-29-22-20 29.500-3.500z" fill="#FDB533" ${S}/>`,
  sparkle: `<path d="M50 6c4 24 12 32 44 44-32 12-40 20-44 44-4-24-12-32-44-44 32-12 40-20 44-44z" fill="#FFE066" ${S}/>`,
  sun: `<g ${S}><circle cx="50" cy="50" r="20" fill="#FDB533"/>${[0,45,90,135,180,225,270,315].map((a) => `<line x1="50" y1="16" x2="50" y2="6" transform="rotate(${a} 50 50)"/>`).join("")}</g>`,
  cloud: `<path d="M26 74a16 16 0 0 1-2-32 22 22 0 0 1 42-6 18 18 0 0 1 8 38z" fill="#BEE8FF" ${S}/>`,
  flower: `<g ${S}>${[0,72,144,216,288].map((a) => `<ellipse cx="50" cy="26" rx="13" ry="18" fill="#FF8FB1" transform="rotate(${a} 50 50)"/>`).join("")}<circle cx="50" cy="50" r="11" fill="#FDB533"/></g>`,
  rainbow: `<g fill="none" stroke-width="9" stroke-linecap="round"><path d="M12 76a38 38 0 0 1 76 0" stroke="#E02843"/><path d="M24 76a26 26 0 0 1 52 0" stroke="#FDB533"/><path d="M36 76a14 14 0 0 1 28 0" stroke="#4082AE"/></g>`,
  smile: `<g ${S}><circle cx="50" cy="50" r="40" fill="#FFE066"/><circle cx="37" cy="42" r="4" fill="#181B23"/><circle cx="63" cy="42" r="4" fill="#181B23"/><path d="M30 60c10 14 30 14 40 0" fill="none"/></g>`,
  note: `<g ${S}><path d="M38 72V22l38-8v50" fill="none"/><ellipse cx="29" cy="74" rx="11" ry="9" fill="#FF8FB1"/><ellipse cx="67" cy="66" rx="11" ry="9" fill="#FF8FB1"/></g>`,
  bolt: `<path d="M56 6L22 56h24l-6 38 38-54H54z" fill="#FFE066" ${S}/>`,
  crown: `<path d="M10 76V30l22 22 18-30 18 30 22-22v46z" fill="#FDB533" ${S}/>`,
  bubble: `<g ${S}><path d="M14 18h72a6 6 0 0 1 6 6v38a6 6 0 0 1-6 6H48L28 86V68H14a6 6 0 0 1-6-6V24a6 6 0 0 1 6-6z" fill="#fff"/><path d="M50 55C34 44 32 36 38 31s11-1 12 4c1-5 7-9 12-4s2 13-12 24z" fill="#E02843" stroke-width="3"/></g>`,
  camera: `<g ${S}><rect x="8" y="26" width="84" height="56" rx="10" fill="#fff"/><path d="M32 26l6-10h24l6 10" fill="#fff"/><circle cx="50" cy="54" r="16" fill="#BEE8FF"/></g>`,
};

export const DEFAULT_STICKERS = Object.entries(shapes).map(([id, inner]) => ({
  id: `builtin-${id}`, categoryId: null, name: id, url: svg(inner), width: 100, height: 100,
}));
