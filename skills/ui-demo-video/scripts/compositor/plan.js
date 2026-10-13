// Everything that is real HTML/CSS: backgrounds, window shadows, caption
// pills, issue cards, list rows, titles. Node loads each as a page in headless
// Chrome and captures the pieces over the DevTools protocol; the page then
// animates the captured textures on the GPU.
//
// This file has two halves. `ID` builds the name a captured piece is stored
// under (the page asks for pieces by name). `jobsFor` builds the HTML for
// every piece a video needs (Node only). The CSS is a copy of what the
// Remotion template's scenes, Caption.tsx and Callouts.tsx put on screen, so
// the text lays out the same way. All sizes are px at the video's width.

export const ACCENT = '#3b6bff';
// Single quotes only: this string is pasted into style="..." attributes.
export const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
// remocn's title components read their font from this variable, then fall back.
const REMOCN_FONT = 'var(--font-geist-sans), -apple-system, BlinkMacSystemFont, sans-serif';
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const r2 = (v) => Math.round(v * 100) / 100;

// ------------------------------------------------------------ layout
// The frame box from scenes.tsx: as large as fits in the top ~80% at the
// recording's aspect, leaving a band underneath for the caption.
export const frameBox = (width, height, aspect) => {
  const h = Math.min(height * 0.8, (width * 0.9) / aspect);
  const w = h * aspect;
  return { w, h, left: (width - w) / 2, top: height * 0.055 };
};
export const splitBoxes = (width, height, aspect) => {
  const gap = width * 0.025;
  const w = Math.min((width * 0.92 - gap) / 2, height * 0.7 * aspect);
  const h = w / aspect;
  const top = height * 0.12;
  const left0 = (width - (w * 2 + gap)) / 2;
  return [0, 1].map((i) => ({ w, h, top, left: left0 + i * (w + gap) }));
};
export const sceneBox = (spec, scene) => {
  const { width, height } = spec;
  if (scene.type === 'clip' && (scene.frame ?? 'flat') === 'full') return { w: width, h: height, left: 0, top: 0 };
  return frameBox(width, height, scene.aspect);
};
/** Where the caption band starts: under the frame in flat scenes, else null (bottom aligned). */
export const bandTop = (spec, scene) => {
  if (scene.type === 'clip') return (scene.frame ?? 'flat') === 'flat' ? sceneBox(spec, scene).top + sceneBox(spec, scene).h : null;
  if (scene.type === 'image') return sceneBox(spec, scene).top + sceneBox(spec, scene).h;
  if (scene.type === 'split') { const b = splitBoxes(spec.width, spec.height, scene.aspect)[0]; return b.top + b.h; }
  return null;
};
export const tagColorOf = (spec, tag) => (tag ? spec.theme.tagColors?.[tag] : undefined) ?? '#6ebeff';
export const accentOf = (spec) => spec.theme.accent ?? ACCENT;

// ------------------------------------------------------------ ids
const j = (v) => JSON.stringify(v);
export const ID = {
  bg: () => 'bg',
  shell: (b, radius, shadow = true) => `shell|${j([b.w, b.h, b.left, b.top].map(r2))}|${r2(radius)}|${shadow ? 1 : 0}`,
  pill: (top, tag, color, text) => `pill|${top}|${tag ?? ''}|${color}|${text}`,
  chip: (label, accent) => `chip|${accent}|${label}`,
  logo: (src, h) => `logo|${src}|${r2(h)}`,
  card: (i) => `scene${i}|card`,
  piece: (i, name) => `scene${i}|${name}`,
};

// ------------------------------------------------------------ html
const BASE_CSS = (W, H) => `
*,::before,::after{box-sizing:border-box;margin:0;padding:0;border:0 solid}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:transparent;line-height:1.5;font-family:${FONT};-webkit-font-smoothing:antialiased}
img,svg{display:block;max-width:100%}
.af{position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:100%;display:flex;flex-direction:column}`;

const job = (id, body, shots, css = '') => ({ id, body, css, shots });
const shot = (id, rect, extra = {}) => ({ id, rect, show: [rect], hide: [], pad: 0, ...extra });

const background = (spec) =>
  job('bg', `<div class="af" style="background:${spec.theme.background}"></div>`, [{ id: ID.bg(), rect: '.af', show: ['.af'], hide: [], pad: 0, full: true }]);

/** The window's shadow and white box, captured empty: the recording is drawn over it. */
const windowShell = (spec, b, full) => {
  if (full) return null;
  const radius = spec.width * 0.008;
  const id = ID.shell(b, radius);
  return job(id,
    `<div class="win" style="position:absolute;left:${b.left}px;top:${b.top}px;width:${b.w}px;height:${b.h}px;border-radius:${radius}px;overflow:hidden;box-shadow:0 0 0 1px rgba(0,0,0,0.06),0 24px 70px rgba(0,0,0,0.22);background:#fff"></div>`,
    [shot(id, '.win', { pad: 130 })]);
};

const captionPill = (spec, top, tag, text) => {
  const size = spec.width * 0.0135;
  const color = tagColorOf(spec, tag);
  const id = ID.pill(top, tag, color, text);
  const bottom = top === null ? spec.height * 0.05 : 0;
  return job(id,
    `<div style="position:absolute;left:0;right:0;${top === null ? '' : `top:${top}px;`}bottom:${bottom}px;display:flex;align-items:center;justify-content:center">
      <div id="pill" style="display:inline-flex;align-items:center;gap:${size * 0.7}px;padding:${size * 0.55}px ${size * 1.05}px;border-radius:999px;background:rgba(17,17,20,0.92);box-shadow:0 1px 0 rgba(255,255,255,0.06) inset,0 8px 24px rgba(0,0,0,0.18);font-family:${FONT};font-size:${size}px;font-weight:500;line-height:1.2;color:#fff;white-space:nowrap">
        ${tag ? `<span style="color:${color};font-weight:600">${esc(tag)}</span>` : ''}<span>${esc(text)}</span>
      </div></div>`,
    [shot(id, '#pill', { pad: 44 })]);
};

const calloutChip = (spec, label) => {
  const s = spec.width / 1920, accent = accentOf(spec);
  const id = ID.chip(label, accent);
  return job(id,
    `<div id="chip" style="position:absolute;left:20px;top:20px;padding:${6 * s}px ${12 * s}px;border-radius:999px;background:${accent};color:#fff;font-family:${FONT};font-size:${22 * s}px;font-weight:600;white-space:nowrap">${esc(label)}</div>`,
    [shot(id, '#chip', { pad: 2 })]);
};

/** The captions (one, or several in turn) and callout labels a clip or image scene needs. */
const captionJobs = (spec, scene) => {
  const top = bandTop(spec, scene);
  const jobs = [];
  if (scene.type === 'clip' && scene.captions?.length) {
    for (const c of scene.captions) jobs.push(captionPill(spec, top, c.tag ?? scene.tag, c.text));
  } else if (scene.caption) jobs.push(captionPill(spec, top, scene.tag, scene.caption));
  for (const c of scene.callouts ?? []) if (c.label && c.box && c.atSec !== undefined) jobs.push(calloutChip(spec, c.label));
  return jobs;
};

// ---- title: remocn's three text effects, laid out in their final state ----
const titleJobs = (spec, scene, i) => {
  const W = spec.width, size = W * 0.042, fg = spec.theme.foreground;
  const effect = scene.effect ?? 'soft-blur-in';
  const shots = [];
  let inner;
  if (effect === 'word-push') {
    const words = scene.text.trim().split(/\s+/).filter(Boolean);
    inner = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;white-space:nowrap"><span style="font-size:${size}px;font-weight:600;color:${fg};letter-spacing:-0.02em;font-family:${REMOCN_FONT}">${
      words.map((w, k) => `<span data-p="w${k}" style="display:inline-block;white-space:pre;${k < words.length - 1 ? 'margin-right:0.22em' : ''}">${esc(w)}</span>`).join('')
    }</span></div>`;
    words.forEach((_, k) => shots.push(shot(ID.piece(i, `w${k}`), `[data-p="w${k}"]`, { pad: 12 })));
  } else if (effect === 'micro-scale-fade') {
    inner = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><span data-p="all" style="font-size:${size}px;font-weight:600;color:${fg};letter-spacing:-0.03em;font-family:${REMOCN_FONT};display:inline-block">${esc(scene.text)}</span></div>`;
    shots.push(shot(ID.piece(i, 'all'), '[data-p="all"]', { pad: 12 }));
  } else {
    const chars = Array.from(scene.text);
    inner = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><span style="font-size:${size}px;font-weight:600;color:${fg};letter-spacing:-0.05em;font-family:${REMOCN_FONT}">${
      chars.map((c, k) => `<span data-p="c${k}" style="display:inline-block;white-space:pre">${esc(c)}</span>`).join('')
    }</span></div>`;
    // Blur is applied on the GPU per frame, so each glyph needs room around it for its halo.
    chars.forEach((c, k) => { if (c.trim()) shots.push(shot(ID.piece(i, `c${k}`), `[data-p="c${k}"]`, { pad: 44 })); });
  }
  const sub = scene.subtitle
    ? (shots.push(shot(ID.piece(i, 'sub'), '[data-p="sub"]', { pad: 8 })),
      `<div data-p="sub" style="font-size:${W * 0.0155}px;font-weight:500;color:${fg}">${esc(scene.subtitle)}</div>`)
    : '';
  const body = `<div class="af" style="align-items:center;justify-content:center;gap:${W * 0.008}px;font-family:${FONT};--font-geist-sans:Inter">
    <div style="position:relative;width:100%;height:${size * 1.3}px">${inner}</div>${sub}</div>`;
  return [job(`title${i}`, body, shots)];
};

// ---- issue: a ticket card whose rows rise in turn ----
const issueJobs = (spec, scene, i) => {
  const u = spec.width / 1920, fg = spec.theme.foreground, accent = accentOf(spec);
  const rowId = (n) => ID.piece(i, n);
  const body = `<div class="af" style="align-items:center;justify-content:center;font-family:${FONT}">
    <div id="card" style="position:relative;width:${1040 * u}px;padding:${52 * u}px ${60 * u}px;border-radius:${28 * u}px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,0.06),0 24px 70px rgba(0,0,0,0.16);display:flex;flex-direction:column;gap:${22 * u}px">
      <div style="display:flex;align-items:center;gap:${14 * u}px;font-size:${24 * u}px;font-weight:600">
        ${scene.source ? `<span style="color:${fg};opacity:0.55">${esc(scene.source)}</span>` : ''}
        ${scene.id ? `<span style="color:${fg}">${esc(scene.id)}</span>` : ''}
        ${scene.status ? `<span style="margin-left:auto;padding:${6 * u}px ${14 * u}px;border-radius:999px;background:${accent}18;color:${accent};font-size:${21 * u}px">${esc(scene.status)}</span>` : ''}
      </div>
      <div class="piece" data-p="title" style="font-size:${48 * u}px;font-weight:600;line-height:1.18;color:${fg};text-wrap:balance">${esc(scene.title)}</div>
      ${scene.quote ? `<div class="piece" data-p="quote" style="border-left:${4 * u}px solid ${spec.theme.tagColors?.Before ?? '#e5484d'};padding-left:${26 * u}px;font-size:${30 * u}px;line-height:1.45;color:${fg}">“${esc(scene.quote)}”</div>` : ''}
      ${scene.reporter ? `<div class="piece" data-p="reporter" style="font-size:${22 * u}px;color:${fg}">${esc(scene.reporter)}</div>` : ''}
    </div></div>`;
  const shots = [{ id: ID.card(i), rect: '#card', show: ['#card'], hide: ['.piece'], pad: 130 }];
  for (const n of ['title', 'quote', 'reporter'])
    if (n === 'title' || scene[n]) shots.push({ id: rowId(n), rect: `[data-p="${n}"]`, show: [`[data-p="${n}"]`], hide: [], pad: 6 });
  return [job(`issue${i}`, body, shots)];
};

// ---- list: a heading, then rows that build one by one ----
const listJobs = (spec, scene, i) => {
  const u = spec.width / 1920, fg = spec.theme.foreground, accent = accentOf(spec);
  const body = `<div class="af" style="align-items:center;justify-content:center;font-family:${FONT}">
    <div style="display:flex;flex-direction:column;gap:${30 * u}px;width:${1100 * u}px">
      <div data-p="head">
        <div style="font-size:${60 * u}px;font-weight:600;color:${fg};line-height:1.12">${esc(scene.title)}</div>
        ${scene.subtitle ? `<div style="margin-top:${12 * u}px;font-size:${26 * u}px;font-weight:500;color:${fg};opacity:0.55">${esc(scene.subtitle)}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:${18 * u}px">
        ${scene.items.map((it, k) => `<div data-p="i${k}" style="display:flex;align-items:center;gap:${18 * u}px;font-size:${32 * u}px;font-weight:500;color:${fg}">
          <svg width="${30 * u}" height="${30 * u}" viewBox="0 0 24 24" style="flex-shrink:0"><circle cx="12" cy="12" r="11" fill="${accent}1f"/><path d="M7 12.4l3.2 3.1L17 8.8" fill="none" stroke="${accent}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>${esc(it)}</div>`).join('')}
      </div></div></div>`;
  const shots = [shot(ID.piece(i, 'head'), '[data-p="head"]', { pad: 6 }), ...scene.items.map((_, k) => shot(ID.piece(i, `i${k}`), `[data-p="i${k}"]`, { pad: 6 }))];
  return [job(`list${i}`, body, shots)];
};

// ---- split: two labelled windows ----
const splitJobs = (spec, scene, i) => {
  const boxes = splitBoxes(spec.width, spec.height, scene.aspect);
  const labels = [scene.before.label ?? 'Before', scene.after.label ?? 'After'];
  const jobs = [windowShell(spec, boxes[0], false), windowShell(spec, boxes[1], false)];
  const body = labels.map((l, k) =>
    `<div data-p="l${k}" style="position:absolute;left:${boxes[k].left}px;top:${boxes[k].top - spec.height * 0.055}px;font-family:${FONT};font-size:${spec.width * 0.0135}px;font-weight:600;color:${spec.theme.tagColors?.[l] ?? spec.theme.foreground}">${esc(l)}</div>`).join('');
  jobs.push(job(`split${i}`, body, labels.map((_, k) => shot(ID.piece(i, `l${k}`), `[data-p="l${k}"]`, { pad: 6 }))));
  return jobs;
};

/** The capture jobs for the whole video (Node only). `media(src)` gives the logo's URL. */
export const jobsFor = (spec, media) => {
  const W = spec.width, H = spec.height;
  const jobs = [background(spec)];
  spec.scenes.forEach((scene, i) => {
    if (scene.type === 'title') jobs.push(...titleJobs(spec, scene, i));
    else if (scene.type === 'issue') jobs.push(...issueJobs(spec, scene, i));
    else if (scene.type === 'list') jobs.push(...listJobs(spec, scene, i));
    else if (scene.type === 'split') jobs.push(...splitJobs(spec, scene, i), ...captionJobs(spec, scene));
    else if (scene.type === 'clip' || scene.type === 'image') {
      jobs.push(windowShell(spec, sceneBox(spec, scene), scene.type === 'clip' && scene.frame === 'full'), ...captionJobs(spec, scene));
    }
  });
  const logo = spec.theme.logo;
  if (logo) {
    const h = (logo.height ?? 34) * (W / 1920);
    const id = ID.logo(logo.src, h);
    jobs.push(job(id, `<img id="logo" src="${media(logo.src)}" style="position:absolute;left:40px;top:40px;height:${h}px;width:auto">`, [shot(id, '#logo')], ''));
  }
  const seen = new Set();
  return jobs.filter((x) => x && !seen.has(x.id) && seen.add(x.id));
};
export const baseCss = BASE_CSS;
