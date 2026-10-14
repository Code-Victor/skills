// Everything that is real HTML/CSS: backgrounds, window shells, caption pills,
// issue cards, list rows, titles. Node loads each as a page in headless Chrome
// and captures the pieces over the DevTools protocol; the page then animates
// the captured textures on the GPU.
//
// The HTML is built by BUILDERS. This file holds the default builders (they
// read the style's tokens); a style can replace any of them with its own in
// `build: { title, issue, list, caption, calloutChip, calloutMark, window,
// furniture }`. A builder receives a context (see `ctxFor`) and returns
// { html, css?, poses? }. Pieces the animations move are the elements marked
// data-p="name" (optionally data-pad="px" for room around them: blur and
// shadows need it). The default builders are exported as DEFAULT_BUILD so a
// custom one can call `ctx.default()` and wrap or tweak the result.
//
// A builder may also return `pieces: { name: { at, enter, sec, dx, dy, from,
// cps, caret, rate, loop, until, exitSec, opacity } }` for any data-p element
// that is not one of the fixed ones: the scene code draws it with its own start
// time (`at`, seconds after the element's own start) and entrance (fade, blur,
// rise, type, pop), and plays its pose sequence (`poses[name]`) from `at`.
//
// All sizes are px at the video's width. For the default (studio) style the CSS
// is a copy of what the Remotion template puts on screen.
import { esc, has, ID, r2, richHtml, emChars, emWords, parseEmphasis, sceneLayout, splitBoxes, captionPos, accentOf, tagColorOf, radiusOf, sceneLabel, shellTag, markSize, effectOf, chipKey, placeOf, cameraModeOf, captionHasPlate } from './layout.js';
import { withAlpha, contrast } from './color.js';

export { ID, esc, has, accentOf, tagColorOf };

const job = (id, body, shots, css = '') => ({ id, body, css, shots });
const shot = (id, rect, extra = {}) => ({ id, rect, show: [rect], hide: [], pad: 0, ...extra });

/** font-family value for a role (display | text | mono): the family, then the fallback stack. Single quotes only: pasted into style="...". */
export const fontStack = (style, role) => {
  const f = style.fonts[role] ?? style.fonts.text;
  return f.family ? `${/\s/.test(f.family) ? `'${f.family}'` : f.family}, ${f.fallback}` : f.fallback;
};
export const baseCss = (W, H, style) => `
*,::before,::after{box-sizing:border-box;margin:0;padding:0;border:0 solid}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:transparent;line-height:1.5;font-family:${fontStack(style, 'text')};-webkit-font-smoothing:antialiased}
img,svg{display:block;max-width:100%}
.af{position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:100%;display:flex;flex-direction:column}`;

/** What a builder receives. `default()` runs the default builder with the same context. */
const ctxFor = (spec, style, kind, extra = {}) => {
  const W = spec.width, H = spec.height, u = W / 1920;
  const c = {
    spec, style, kind, W, H, u, fg: style.palette.foreground, accent: accentOf(style), tokens: style,
    font: (role) => fontStack(style, role),
    rgba: (css, a) => withAlpha(css, a, style.rgb),
    rich: (text, color) => richHtml(text, color ?? accentOf(style)),
    esc, has, ID,
    sceneType: extra.scene?.type,
    ...extra,
  };
  c.default = () => DEFAULT_BUILD[kind](c);
  return c;
};
const runBuilder = (spec, style, kind, extra) => {
  const c = ctxFor(spec, style, kind, extra);
  const out = (style.build?.[kind] ?? DEFAULT_BUILD[kind])(c);
  if (!out || typeof out.html !== 'string') throw new Error(`style "${style.name}": builder "${kind}" must return { html }`);
  return out;
};

/**
 * Pieces of a builder's HTML: every data-p="name" (+ data-pad), with poses from `out.poses[name]` and
 * entrance settings from `out.pieces[name]`. `idOf(name)` names the captured picture; `owner` says whose
 * extra pieces they are (the scene code draws them by owner).
 */
const shotsOf = (out, idOf, owner, extra = {}) => {
  const shots = [];
  for (const m of out.html.matchAll(/<[^>]*\bdata-p="([^"]+)"[^>]*>/g)) {
    const name = m[1], pad = /data-pad="(\d+)"/.exec(m[0]);
    const s = shot(idOf(name), `[data-p="${name}"]`, { pad: pad ? +pad[1] : 12, ...(extra[name] ?? {}) });
    if (out.poses && !Array.isArray(out.poses) && out.poses[name]) s.poses = out.poses[name];
    if (out.pieces?.[name]) s.meta = { ...out.pieces[name], owner };
    if (!/^(c\d+|w\d+|furn|mark)$/.test(name)) s.chars = true;   // glyph boxes, for the "type" entrance and the line bands
    shots.push(s);
  }
  return shots;
};

// ------------------------------------------------------------ background / window
const background = (spec, style) => {
  const bg = style.canvas.background;
  const css = bg.kind === 'css' || style.canvas.model === 'scene' ? style.palette.background : style.canvas.matte;
  return job(ID.bg(), `<div class="af" style="background:${css}"></div>`, [{ id: ID.bg(), rect: '.af', show: ['.af'], hide: [], pad: 0, full: true }]);
};

const chromeHtml = (c, ins, w) => {
  const k = w.chrome, u = c.u, h = ins.chrome;
  const lights = (k.lights ?? ['#ff5f57', '#febc2e', '#28c840']).map((col) => `<i style="width:${12 * u}px;height:${12 * u}px;border-radius:50%;background:${col};opacity:${k.lightsOpacity ?? 0.85};display:block"></i>`).join('');
  return `<div style="position:absolute;left:0;top:0;right:0;height:${h}px;background:${k.fill ?? 'rgba(255,255,255,0.04)'};border-bottom:1px solid ${k.rule ?? 'rgba(255,255,255,0.06)'};display:flex;align-items:center;padding:0 ${16 * u}px;gap:${8 * u}px">
    <div style="display:flex;gap:${8 * u}px">${lights}</div>
    <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:${(k.urlWidth ?? 0.4) * 100}%;height:${h * 0.58}px;border-radius:${h}px;background:${k.urlFill ?? 'rgba(255,255,255,0.06)'};display:flex;align-items:center;justify-content:center;font-family:${c.font('mono')};font-size:${12 * u}px;color:${k.color ?? 'rgba(255,255,255,0.5)'};white-space:nowrap">${esc(k.urlText ?? '')}</div></div>`;
};

/** The window's shadow, fill and (optional) chrome bar, captured without the recording: that is drawn over it. */
const windowShell = (spec, style, layout, scene, split) => {
  if (layout.full) return [];
  const W = spec.width, w = style.window, b = layout.outer, radius = radiusOf(style, W);
  const label = scene ? sceneLabel(scene) : '';
  const tag = split ? 'split' : shellTag(style, scene ?? {});
  const id = ID.shell(b, radius, true, tag);
  const glow = w.glow ? `,0 0 ${w.glow.blur ?? 80}px ${w.glow.spread ?? 0}px ${w.glow.color}` : '';
  const ctx = ctxFor(spec, style, 'window', { box: b, view: layout.view, insets: layout.ins, scene, label, radius });
  const inner = style.build?.window ? style.build.window(ctx) : { html: layout.ins.chrome > 0 && !split ? chromeHtml(ctx, layout.ins, w) : '' };
  const jobs = [job(id,
    `<div class="win" style="position:absolute;left:${b.left}px;top:${b.top}px;width:${b.w}px;height:${b.h}px;border-radius:${radius}px;overflow:hidden;box-shadow:${w.shadow}${glow};background:${w.fill}">${inner.html}</div>`,
    [shot(id, '.win', { pad: w.shadowPad })], inner.css ?? '')];
  // the hairline border and inner highlight sit OVER the recording's edge
  if (w.border || w.highlight) {
    const rid = ID.ring(b, radius), box = `position:absolute;left:${b.left}px;top:${b.top}px;width:${b.w}px;height:${b.h}px`;
    if (w.border?.gradient) {
      // a gradient hairline (a top-lit ring): the gradient fills a ring made with a mask that cuts out the middle
      const bw = w.border.width ?? 1, fill = `position:absolute;inset:0;border-radius:${radius}px`;
      jobs.push(job(rid, `<div class="ring" style="${box}"><div style="${fill};padding:${bw}px;background:${w.border.gradient};-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude"></div>${w.highlight ? `<div style="${fill};box-shadow:inset 0 1px 0 ${w.highlight.color}"></div>` : ''}</div>`, [shot(rid, '.ring', { pad: 2 })]));
    } else {
      const sh = [w.border ? `inset 0 0 0 ${(w.border.width ?? 1)}px ${w.border.color}` : '', w.highlight ? `inset 0 1px 0 ${w.highlight.color}` : ''].filter(Boolean).join(',');
      jobs.push(job(rid, `<div class="ring" style="${box};border-radius:${radius}px;box-shadow:${sh}"></div>`, [shot(rid, '.ring', { pad: 2 })]));
    }
  }
  return jobs;
};

// ------------------------------------------------------------ captions
const tagHtml = (c, tag, color) => {
  const t = c.style.caption.tag;
  if (!tag) return '';
  if (t.style === 'chip') return `<span style="padding:0.12em 0.55em;border-radius:999px;background:${c.rgba(color, 0.18)};color:${color};font-weight:${t.weight};font-size:0.8em;letter-spacing:0.01em">${esc(tag)}</span>`;
  if (t.style === 'bracket') return `<span style="color:${color};font-weight:${t.weight};font-family:${c.font('mono')}">[${esc(tag)}]</span>`;
  return `<span style="color:${color};font-weight:${t.weight}">${esc(tag)}</span>`;
};
/** The positioned wrapper every caption sits in; `inner` must contain id="pill". */
const captionFrame = (c, inner) => {
  const p = c.pos;
  return `<div style="position:absolute;${p.css};display:flex;align-items:center;justify-content:${p.align};padding-left:${p.padLeft}px">${inner}</div>`;
};
/** One line (the default) or, with caption.maxWidth (a fraction of W), text that wraps inside that width. */
const ws = (c) => (c.style.caption.maxWidth ? `white-space:normal;max-width:${c.W * c.style.caption.maxWidth}px` : 'white-space:nowrap');
const captionBuilders = {
  pill: (c) => {
    const k = c.style.caption, p = k.pill, size = c.size;
    return captionFrame(c, `<div id="pill" style="display:inline-flex;align-items:center;gap:${size * p.gap}px;padding:${size * p.padY}px ${size * p.padX}px;border-radius:${p.radius}px;background:${p.background};box-shadow:${p.shadow};${p.border ? `border:1px solid ${p.border};` : ''}font-family:${c.font('text')};font-size:${size}px;font-weight:${k.weight};line-height:1.2;color:${k.color};${ws(c)}">
        ${tagHtml(c, c.tag, c.color)}<span data-type>${c.rich(c.text)}</span>
      </div>`);
  },
  glass: (c) => {
    const k = c.style.caption, p = k.glass, size = c.size;
    return captionFrame(c, `<div id="pill" style="display:inline-flex;align-items:center;gap:${size * p.gap}px;padding:${size * p.padY}px ${size * p.padX}px;border-radius:${p.radius}px;box-shadow:inset 0 0 0 1px ${p.border},inset 0 1px 0 rgba(255,255,255,0.08);font-family:${c.font('text')};font-size:${size}px;font-weight:${k.weight};line-height:1.2;color:${k.color};${ws(c)}">
        ${tagHtml(c, c.tag, c.color)}<span data-type>${c.rich(c.text)}</span></div>`);
  },
  plain: (c) => {
    const k = c.style.caption, p = k.plain, size = c.size;
    return captionFrame(c, `<div id="pill" style="display:inline-flex;align-items:center;gap:${size * 0.7}px;font-family:${c.font('text')};font-size:${size}px;font-weight:${k.weight};line-height:1.3;color:${k.color};${ws(c)};${p.shadow ? `text-shadow:${p.shadow};` : ''}${p.rule ? `padding-top:${size * 0.55}px;border-top:${p.rule}px solid ${p.ruleColor ?? c.accent};` : ''}">
        ${tagHtml(c, c.tag, c.color)}<span data-type>${c.rich(c.text)}</span></div>`);
  },
  bar: (c) => {
    const k = c.style.caption, p = k.bar, size = c.size;
    return captionFrame(c, `<div id="pill" style="display:inline-flex;flex-direction:column;gap:${size * 0.15}px;padding:${size * p.padY}px ${size * p.padX}px;border-left:${size * p.barWidth}px solid ${c.color};${p.background ? `background:${p.background};` : ''}font-family:${c.font('text')};font-size:${size}px;font-weight:${k.weight};line-height:1.25;color:${k.color};${ws(c)};${k.textShadow ? `text-shadow:${k.textShadow};` : ''}">
        ${c.tag ? `<span style="font-size:${p.tagSize}em;font-weight:${k.tag.weight};letter-spacing:0.08em;text-transform:none;color:${c.color}">${esc(c.tag)}</span>` : ''}<span data-type>${c.rich(c.text)}</span></div>`);
  },
  mono: (c) => {
    const k = c.style.caption, p = k.mono, size = c.size;
    return captionFrame(c, `<div id="pill" style="display:inline-flex;align-items:baseline;gap:${size * 0.6}px;font-family:${c.font('mono')};font-size:${size}px;font-weight:${k.weight};line-height:1.3;color:${k.color};${ws(c)};${k.textShadow ? `text-shadow:${k.textShadow};` : ''}">
        <span style="color:${p.promptColor ?? c.accent}">${esc(p.prompt)}</span>${tagHtml(c, c.tag, c.color)}<span data-type>${c.rich(c.text)}</span></div>`);
  },
};

const captionPill = (spec, style, scene, tag, text, place) => {
  const size = spec.width * style.caption.size, color = tagColorOf(spec, style, tag), pos = captionPos(spec, style, scene, place);
  const id = ID.pill(pos.key, tag, color, text, `${style.caption.variant}|${scene.type}`);
  const accent = style.captionTags?.accent;   // an *emphasised* word on the plate, lifted like the tags (caption.tagContrast)
  const out = runBuilder(spec, style, 'caption', { scene, tag, text, color, size, pos, ...(accent ? { rich: (t, c) => richHtml(t, c ?? accent) } : {}) });
  const hasExtras = /\bdata-p="/.test(out.html);
  const pillPoses = Array.isArray(out.poses) ? out.poses : out.poses?.pill;
  const shots = [shot(id, '#pill', { pad: 44, chars: true, poses: pillPoses, ...(hasExtras ? { hide: ['[data-p]'] } : {}) }), ...shotsOf(out, (n) => `${id}|${n}`, id)];
  return job(id, out.html, shots, out.css);
};

const calloutChip = (spec, style, label, c, scene, index, ci) => {
  const s = spec.width / 1920, accent = accentOf(style), side = c.box[1] < 0.18 ? 'below' : 'above';
  const id = ID.chip(label, accent, chipKey(style, index, ci, side));
  const out = runBuilder(spec, style, 'calloutChip', { label, s, id, callout: c, scene, index, calloutIndex: ci, side });
  return job(id, out.html, [shot(id, '#chip', { pad: 2 })], out.css);
};

/** The callout mark builder (e.g. a hand-drawn circle) captured at 2x for the callout's box. */
const calloutMark = (spec, style, scene, c) => {
  const lay = sceneLayout(spec, style, scene);
  if (!lay || !style.build?.calloutMark) return null;
  const u = spec.width / 1920, m = markSize(lay.view, c, u, style.callout.pad);
  const w = Math.round(m.w * 2), h = Math.round(m.h * 2), id = ID.mark(w, h, c.style ?? 'ring');
  const out = style.build.calloutMark(ctxFor(spec, style, 'calloutMark', { callout: c, w, h, box: { w, h }, scale: 2, id }));
  return job(id, `<div id="mark" data-p="mark" style="position:absolute;left:20px;top:20px;width:${w}px;height:${h}px">${out.html}</div>`, [{ ...shot(id, '#mark', { pad: 4 }), poses: out.poses?.mark ?? out.poses }], out.css);
};

/** The captions (one, or several in turn) and callout labels a clip or image scene needs. */
const captionJobs = (spec, style, scene, index) => {
  const jobs = [];
  if (scene.type === 'clip' && scene.captions?.length) {
    for (const c of scene.captions) jobs.push(captionPill(spec, style, scene, c.tag ?? scene.tag, c.text, placeOf(scene, c)));
  } else if (scene.caption) jobs.push(captionPill(spec, style, scene, scene.tag, scene.caption, placeOf(scene, null)));
  (scene.callouts ?? []).forEach((c, ci) => {
    if (c.label && c.box && c.atSec !== undefined) jobs.push(calloutChip(spec, style, c.label, c, scene, index, ci));
    if (c.box && c.atSec !== undefined) { const m = calloutMark(spec, style, scene, c); if (m) jobs.push(m); }
  });
  return jobs;
};

/** The scrim under overlay captions: a soft gradient up from the bottom of the recording (clip and image scenes that have a caption). */
const scrimJob = (spec, style, scene) => {
  const K = style.caption.scrim, lay = sceneLayout(spec, style, scene);
  if (!K || !lay || !(scene.caption || scene.captions?.length)) return null;
  if (!(style.caption.placement === 'overlay' || lay.full)) return null;
  const v = lay.view, hh = Math.round(v.h * (K.height ?? 0.3)), radius = lay.full || lay.ins.b > 0 ? 0 : radiusOf(style, spec.width);
  const color = K.color ?? '#000', op = K.opacity ?? 0.6, id = ID.scrim(v, hh, radius, `${color}|${op}`);
  const stops = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1].map((t) => `${withAlpha(color, op * (1 - t * t * (3 - 2 * t)), style.rgb)} ${Math.round(t * 100)}%`).join(',');
  return job(id, `<div id="scrim" style="position:absolute;left:${v.left}px;top:${v.top + v.h - hh}px;width:${v.w}px;height:${hh}px;background:linear-gradient(to top,${stops});border-radius:0 0 ${radius}px ${radius}px"></div>`, [shot(id, '#scrim', { pad: 0 })]);
};

/**
 * Fill mode, a caption with no plate (plain, mono, a bar with no background): one canvas-wide gradient,
 * drawn behind the caption from the nearer edge once the recording covers its spot. caption.scrim's colour
 * and opacity when the style has one; else black or white, whichever the caption's text stands out on.
 */
const fillScrimJob = (spec, style) => {
  const needs = spec.scenes.some((sc) => (sc.type === 'clip' || sc.type === 'image') && cameraModeOf(spec, style, sc) === 'fill' && (sc.caption || sc.captions?.length));
  if (!needs || captionHasPlate(style)) return null;
  const K = style.caption.scrim ?? {}, W = spec.width, H = spec.height, hh = Math.round(H * (K.height ?? 0.3));
  const text = style.caption.color ?? style.palette.foreground;
  const color = K.color ?? ((contrast(text, '#000000', style.rgb) ?? 21) >= (contrast(text, '#ffffff', style.rgb) ?? 1) ? '#000000' : '#ffffff');
  const op = K.opacity ?? 0.6, id = ID.fillScrim();
  const stops = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1].map((t) => `${withAlpha(color, op * (1 - t * t * (3 - 2 * t)), style.rgb)} ${Math.round(t * 100)}%`).join(',');
  return job(id, `<div id="fscrim" style="position:absolute;left:0;top:${H - hh}px;width:${W}px;height:${hh}px;background:linear-gradient(to top,${stops})"></div>`, [shot(id, '#fscrim', { pad: 0 })]);
};

// ------------------------------------------------------------ title
const titleDefault = (c) => {
  const { W, style, scene, fg, accent } = c, t = style.title;
  const size = W * t.size, effect = c.effect ?? effectOf(style, scene), font = c.font('display');
  const track = t.tracking[effect] ?? -0.03, left = t.align === 'left';
  const col = (em) => (em ? `color:${accent};` : '');
  const measure = `max-width:${W * (t.maxWidth ?? 0.8)}px;text-align:${left ? 'left' : 'center'};line-height:${t.lineHeight ?? 1.12};text-wrap:balance`;
  let inner;
  const multi = effect === 'type' || effect === 'lines';
  if (multi) {
    inner = `<span data-p="all" data-pad="12" data-type style="display:block;max-width:${W * (t.maxWidth ?? 0.8)}px;white-space:normal;text-align:${left ? 'left' : 'center'};font-size:${size}px;font-weight:${t.weight};color:${fg};letter-spacing:${t.tracking[effect] ?? t.tracking['soft-blur-in'] ?? -0.03}em;line-height:${t.lineHeight ?? 1.12};font-family:${font}">${c.rich(scene.text)}</span>`;
  } else if (effect === 'word-push') {
    const words = emWords(scene.text);
    inner = `<span style="font-size:${size}px;font-weight:${t.weight};color:${fg};letter-spacing:${track}em;font-family:${font}">${
      words.map((w, k) => `<span data-p="w${k}" data-pad="12" style="${col(w.em)}display:inline-block;white-space:pre;${k < words.length - 1 ? 'margin-right:0.22em' : ''}">${esc(w.w)}</span>`).join('')}</span>`;
  } else if (effect === 'micro-scale-fade') {
    inner = `<span ${has(scene.text) ? 'data-p="all" data-pad="12" ' : ''}style="font-size:${size}px;font-weight:${t.weight};color:${fg};letter-spacing:${track}em;font-family:${font};display:inline-block;${measure}">${c.rich(scene.text)}</span>`;
  } else {
    // Each word is kept whole (a line may only break at a space) and the spaces are plain text, so a
    // long title wraps inside the measure instead of running edge to edge or splitting a word.
    const chars = emChars(scene.text), words = [];
    chars.forEach((ch, k) => {
      if (!ch.c.trim()) return words.push(esc(ch.c));
      const g = `<span data-p="c${k}" data-pad="44" style="${col(ch.em)}display:inline-block;white-space:pre">${esc(ch.c)}</span>`;
      if (typeof words.at(-1) === 'object') words.at(-1).push(g); else words.push([g]);
    });
    inner = `<span style="font-size:${size}px;font-weight:${t.weight};color:${fg};letter-spacing:${track}em;font-family:${font};${measure}">${
      words.map((w) => (typeof w === 'object' ? `<span style="white-space:nowrap">${w.join('')}</span>` : w)).join('')}</span>`;
  }
  // One line sits centred in a box one line tall, as it always has; a longer title grows the box downwards and pushes the subtitle with it.
  const wrap = multi ? `<div style="display:flex;justify-content:${left ? 'flex-start' : 'center'}">${inner}</div>` : effect === 'word-push' ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:${left ? 'flex-start' : 'center'};white-space:nowrap">${inner}</div>` : inner;
  const box = multi ? '' : effect === 'word-push' ? `height:${size * 1.3}px` : `display:grid;align-items:center;justify-items:${left ? 'start' : 'center'};min-height:${size * 1.3}px`;
  const sub = has(scene.subtitle) ? `<div data-p="sub" data-pad="8" style="font-size:${W * t.subtitleSize}px;font-weight:${t.subtitleWeight};color:${fg}">${c.rich(scene.subtitle)}</div>` : '';
  const html = `<div class="af" style="align-items:${left ? 'flex-start' : 'center'};justify-content:center;gap:${W * t.gap}px;font-family:${c.font('text')};${left ? `padding-left:${W * t.padLeft}px` : ''}">
    <div style="position:relative;${left ? '' : 'width:100%;'}${box}">${wrap}</div>${sub}</div>`;
  return { html };
};
/** Helpers for custom title builders: the per-glyph / per-word / whole spans the reveals move. */
export const titleSpans = (c, effect = c.effect ?? effectOf(c.style, c.scene)) => {
  const accent = c.accent, col = (em) => (em ? `color:${accent};` : '');
  if (effect === 'type' || effect === 'lines') return `<span data-p="all" data-pad="12" data-type style="display:block;max-width:${c.W * (c.style.title.maxWidth ?? 0.8)}px;white-space:normal">${c.rich(c.scene.text)}</span>`;   // one piece: the scene types it, or reveals it line by line (wrap and align it in your own layout)
  if (effect === 'word-push') return emWords(c.scene.text).map((w, k, a) => `<span data-p="w${k}" data-pad="12" style="${col(w.em)}display:inline-block;white-space:pre;${k < a.length - 1 ? 'margin-right:0.22em' : ''}">${esc(w.w)}</span>`).join('');
  if (effect === 'micro-scale-fade') return `<span data-p="all" data-pad="12" style="display:inline-block">${c.rich(c.scene.text)}</span>`;
  return emChars(c.scene.text).map((ch, k) => `<span ${ch.c.trim() ? `data-p="c${k}" data-pad="44" ` : ''}style="${col(ch.em)}display:inline-block;white-space:pre">${esc(ch.c)}</span>`).join('');
};

// ------------------------------------------------------------ issue card
const issueDefault = (c) => {
  const { W, style, scene, fg, accent } = c, u = c.u, k = style.card;
  const quoteColor = style.palette.tagColors?.Before ?? style.palette.danger;
  const html = `<div class="af" style="align-items:center;justify-content:center;font-family:${c.font('text')}">
    <div id="card" style="position:relative;width:${k.width * u}px;padding:${k.padY * u}px ${k.padX * u}px;border-radius:${k.radius * u}px;background:${k.fill};box-shadow:${k.shadow};${k.border ? `border:1px solid ${k.border};` : ''}display:flex;flex-direction:column;gap:${k.gap * u}px">
      ${has(scene.source) || has(scene.id) || has(scene.status) ? `<div style="display:flex;align-items:center;gap:${14 * u}px;font-size:${k.metaSize * u}px;font-weight:600">` : '<div>'}
        ${scene.source ? `<span style="color:${fg};opacity:${k.metaOpacity}">${esc(scene.source)}</span>` : ''}
        ${scene.id ? `<span style="color:${fg}">${esc(scene.id)}</span>` : ''}
        ${scene.status ? `<span style="margin-left:auto;padding:${6 * u}px ${14 * u}px;border-radius:999px;background:${c.rgba(accent, k.statusAlpha)};color:${accent};font-size:${k.statusSize * u}px">${esc(scene.status)}</span>` : ''}
      </div>
      ${has(scene.title) ? `<div class="piece" data-p="title" data-pad="6" style="font-size:${k.titleSize * u}px;font-weight:600;line-height:1.18;color:${fg};text-wrap:balance">${c.rich(scene.title)}</div>` : ''}
      ${scene.quote ? `<div class="piece" data-p="quote" data-pad="6" style="border-left:${k.quoteBar * u}px solid ${quoteColor};padding-left:${26 * u}px;font-size:${k.quoteSize * u}px;line-height:1.45;color:${fg}">“${c.rich(scene.quote)}”</div>` : ''}
      ${scene.reporter ? `<div class="piece" data-p="reporter" data-pad="6" style="font-size:${k.reporterSize * u}px;color:${fg}">${c.rich(scene.reporter)}</div>` : ''}
    </div></div>`;
  return { html };
};

// ------------------------------------------------------------ list
const listDefault = (c) => {
  const { style, scene, fg, accent } = c, u = c.u, k = style.list;
  const icon = (n) => k.numbered
    ? `<span style="font-family:${c.font('mono')};font-size:${k.itemSize * 0.7 * u}px;color:${accent};min-width:${k.iconSize * 1.2 * u}px">${String(n + 1).padStart(2, '0')}</span>`
    : `<svg width="${k.iconSize * u}" height="${k.iconSize * u}" viewBox="0 0 24 24" style="flex-shrink:0"><circle cx="12" cy="12" r="11" fill="${c.rgba(accent, k.iconAlpha)}"/><path d="M7 12.4l3.2 3.1L17 8.8" fill="none" stroke="${accent}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const html = `<div class="af" style="align-items:center;justify-content:center;font-family:${c.font('text')}">
    <div style="display:flex;flex-direction:column;gap:${k.gap * u}px;width:${k.width * u}px">
      ${has(scene.title) || has(scene.subtitle) ? '<div data-p="head" data-pad="6">' : '<div>'}
        ${has(scene.title) ? `<div style="font-size:${k.titleSize * u}px;font-weight:600;color:${fg};line-height:1.12">${c.rich(scene.title)}</div>` : ''}
        ${has(scene.subtitle) ? `<div style="${has(scene.title) ? `margin-top:${12 * u}px;` : ''}font-size:${k.subtitleSize * u}px;font-weight:500;color:${fg};opacity:${k.subtitleOpacity}">${c.rich(scene.subtitle)}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:${k.itemGap * u}px">
        ${(scene.items ?? []).map((it, n) => `<div data-p="i${n}" data-pad="6" style="display:flex;align-items:center;gap:${k.itemGap * u}px;font-size:${k.itemSize * u}px;font-weight:500;color:${fg}">
          ${icon(n)}${c.rich(it)}</div>`).join('')}
      </div></div></div>`;
  return { html };
};

export const DEFAULT_BUILD = {
  title: titleDefault, issue: issueDefault, list: listDefault,
  caption: (c) => ({ html: captionBuilders[c.style.caption.variant]?.(c) ?? captionBuilders.pill(c) }),
  calloutChip: (c) => {
    const { style, s, label } = c, k = style.callout.chip, accent = c.accent;
    return { html: `<div id="chip" style="position:absolute;left:20px;top:20px;padding:${k.padY * s}px ${k.padX * s}px;border-radius:${k.radius}px;background:${k.background ?? accent};color:${k.color ?? style.palette.onAccent};font-family:${c.font('text')};font-size:${k.size * s}px;font-weight:${k.weight};white-space:nowrap">${c.rich(label, 'inherit')}</div>` };
  },
};

// ------------------------------------------------------------ split
const splitJobs = (spec, style, scene, i) => {
  const boxes = splitBoxes(style, spec.width, spec.height, scene.aspect), s = style.split;
  const labels = [scene.before.label ?? 'Before', scene.after.label ?? 'After'];
  const jobs = [...windowShell(spec, style, boxes[0], null, true), ...windowShell(spec, style, boxes[1], null, true)];
  const body = labels.map((l, k) => !has(l) ? '' :
    `<div data-p="l${k}" data-pad="6" style="position:absolute;left:${boxes[k].outer.left}px;top:${boxes[k].outer.top - spec.height * s.labelRise}px;font-family:${fontStack(style, 'text')};font-size:${spec.width * s.labelSize}px;font-weight:600;color:${style.palette.tagColors?.[l] ?? style.palette.foreground}">${esc(l)}</div>`).join('');
  jobs.push(job(`split${i}`, body, labels.flatMap((l, k) => (has(l) ? [shot(ID.piece(i, `l${k}`), `[data-p="l${k}"]`, { pad: 6 })] : []))));
  return jobs;
};

/** The capture jobs for the whole video (Node only). `media(src)` gives the logo's URL. */
export const jobsFor = (spec, style, media) => {
  const W = spec.width;
  const jobs = [background(spec, style)];
  const fromBuilder = (kind, i, scene, name) => {
    const out = runBuilder(spec, style, kind, { scene, index: i, effect: effectOf(style, scene) });
    const shots = shotsOf(out, (n) => ID.piece(i, n), `s${i}`);
    if (kind === 'issue') shots.unshift({ id: ID.card(i), rect: '#card', show: ['#card'], hide: ['.piece', '[data-p]'], pad: style.card.shadowPad ?? 130 });
    return job(`${name}${i}`, out.html, shots, out.css);
  };
  spec.scenes.forEach((scene, i) => {
    if (style.build?.furniture) {   // the per-scene layer outside the window, on every scene type (the builder gets ctx.sceneType and may return null)
      const out = style.build.furniture(ctxFor(spec, style, 'furniture', { scene, index: i }));
      if (out) jobs.push(job(`furn${i}`, `<div data-p="furn" class="af">${out.html}</div>`, [{ id: ID.piece(i, 'furn'), rect: '[data-p="furn"]', show: ['[data-p="furn"]'], hide: [], pad: 0, full: true }], out.css));
    }
    if (scene.type === 'title') jobs.push(fromBuilder('title', i, scene, 'title'));
    else if (scene.type === 'issue') jobs.push(fromBuilder('issue', i, scene, 'issue'));
    else if (scene.type === 'list') jobs.push(fromBuilder('list', i, scene, 'list'));
    else if (scene.type === 'split') jobs.push(...splitJobs(spec, style, scene, i), ...captionJobs(spec, style, scene, i));
    else if (scene.type === 'clip' || scene.type === 'image') {
      jobs.push(...windowShell(spec, style, sceneLayout(spec, style, scene), scene, false), ...captionJobs(spec, style, scene, i), scrimJob(spec, style, scene));
    }
  });
  jobs.push(fillScrimJob(spec, style));
  const logo = spec.theme.logo;
  if (logo) {
    const h = (logo.height ?? 34) * (W / 1920), k = style.logo ?? {}, u = W / 1920;
    const id = ID.logo(logo.src, h, style);
    const img = `<img ${k.plate ? '' : 'id="logo" '}src="${media(logo.src)}" style="${k.plate ? '' : 'position:absolute;left:40px;top:40px;'}height:${h}px;width:auto;${k.filter ? `filter:${k.filter};` : ''}">`;
    const p = k.plate;
    const body = p ? `<div id="logo" style="position:absolute;left:40px;top:40px;display:flex;align-items:center;padding:${(p.padY ?? 8) * u}px ${(p.padX ?? 12) * u}px;border-radius:${(p.radius ?? 10) * u}px;background:${p.background};${p.border ? `box-shadow:inset 0 0 0 1px ${p.border};` : ''}">${img}</div>` : img;
    jobs.push(job(id, body, [shot(id, '#logo')], ''));
  }
  const seen = new Set();
  return jobs.filter((x) => x && !seen.has(x.id) && seen.add(x.id));
};
