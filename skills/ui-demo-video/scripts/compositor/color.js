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
