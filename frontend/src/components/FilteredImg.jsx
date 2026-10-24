import React from "react";
import { filterCss, getLutFilter, paramsToCss } from "../utils/filters";
import { useLutSrc } from "../utils/lut";

/** <img> dengan filter admin: filter biasa lewat CSS, filter LUT (.cube) lewat pemrosesan WebGL. `lut`/`params` menimpa pencarian lewat id (dipakai pratinjau admin). */
export default function FilteredImg({ src, filterId, lut, params, maxSide = 900, mirror, style, ...rest }) {
  const l = lut !== undefined ? lut : filterId ? getLutFilter(filterId) : null;
  const shown = useLutSrc(src, l, maxSide);
  if (!shown) return null; // LUT sedang diproses
  const css = l ? "none" : params ? paramsToCss(params) : filterCss(filterId);
  return <img src={shown} alt="" draggable={false} style={{ ...style, filter: css, transform: mirror ? "scaleX(-1)" : style?.transform }} {...rest} />;
}
