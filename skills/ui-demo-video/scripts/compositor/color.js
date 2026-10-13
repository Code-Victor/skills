// CSS colours as numbers. Node and the page both import this. It reads hex,
// rgb()/rgba() and a few names locally; anything else (oklch, hsl, color-mix)
// is resolved once by Chrome in compose.mjs (`resolveColors`) and shipped to the
// page in `style.rgb`, so any CSS colour works as an accent.

const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0] };
/** "#rgb", "#rrggbb", "#rrggbbaa", "rgb(...)", "rgba(...)" -> [r, g, b, a] (0..255, alpha 0..1), or null. */
export const parseColor = (css) => {
  const s = String(css ?? '').trim().toLowerCase();
  if (NAMED[s]) return [...NAMED[s]];
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const v = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return [...v, h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (p.length >= 3 && p.every(Number.isFinite)) return [p[0], p[1], p[2], p[3] ?? 1];
  }
  return null;
};

/** The colour as the CSS "rgba(r,g,b,a)" with a different alpha. `resolved` is style.rgb (for colours the local parser cannot read). */
export const withAlpha = (css, a, resolved = {}) => {
  const c = parseColor(css) ?? resolved[css];
  if (!c) return `color-mix(in srgb, ${css} ${Math.round(a * 1000) / 10}%, transparent)`;
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.round(a * 1e4) / 1e4})`;
};
/** [r, g, b] in 0..1 for the GPU. */
export const rgb01 = (css, resolved = {}) => {
  const c = parseColor(css) ?? resolved[css] ?? [59, 107, 255, 1];
  return [c[0] / 255, c[1] / 255, c[2] / 255];
};
/** Relative luma 0..1 (for choosing text on a fill). */
export const luma = (css, resolved = {}) => { const [r, g, b] = rgb01(css, resolved); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

// ---- helpers for a style's palette.mapTag / palette.mapAccent (they receive these as `tools`) ----
const toLinear = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
/** WCAG relative luminance 0..1, or null for a colour this parser cannot read (oklch, hsl, names: map those untouched). */
export const luminance = (css, resolved = {}) => {
  const c = parseColor(css) ?? resolved[css];
  return c ? 0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2]) : null;
};
/** WCAG contrast ratio of two colours, or null when either is unreadable. */
export const contrast = (a, b, resolved = {}) => {
  const x = luminance(a, resolved), y = luminance(b, resolved);
  return x === null || y === null ? null : (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const hex2 = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
/** `a` moved `t` (0..1) toward `b`, as #rrggbb; `a` unchanged when either is unreadable. */
export const mix = (a, b, t, resolved = {}) => {
  const x = parseColor(a) ?? resolved[a], y = parseColor(b) ?? resolved[b];
  return x && y ? `#${[0, 1, 2].map((i) => hex2(x[i] + (y[i] - x[i]) * t)).join('')}` : a;
};
/** `fg` nudged toward white (on a dark `bg`) or black (on a light one) until it reaches `min`:1 against `bg`. */
export const ensureContrast = (fg, bg, min = 4.5, resolved = {}) => {
  const L = luminance(bg, resolved);
  if (L === null || luminance(fg, resolved) === null) return fg;
  const target = L < 0.4 ? '#ffffff' : '#000000';
  for (let t = 0; t <= 1.0001; t += 0.05) { const c = mix(fg, target, t, resolved); if (contrast(c, bg, resolved) >= min) return t === 0 ? fg : c; }
  return target;
};
