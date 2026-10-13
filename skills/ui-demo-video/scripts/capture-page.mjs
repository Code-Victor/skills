// The scripts capture.mjs injects into the page: overlay hiding, the slowed
// clock, the drawn cursor, and the element queries that steps and scout share.
// Each export returns source text for Page.addScriptToEvaluateOnNewDocument or
// Runtime.evaluate.

// Framework dev overlays that never belong in a demo. Matching is by selector
// and is applied inside shadow roots too (see hideScript).
export const HIDE_SELECTORS = [
  // Next.js dev tools: the "Issues" badge and error overlay live in a shadow
  // root under <nextjs-portal>; hiding the host hides everything inside it.
  'nextjs-portal',
  '[data-nextjs-toast]',
  '[data-nextjs-dev-tools-button]',
  '[data-nextjs-dev-overlay]',
  '[data-nextjs-dialog-overlay]',
  '[data-next-badge-root]',
  '[data-next-mark]',
  '#__next-build-watcher',
  'vite-error-overlay',
  '#webpack-dev-server-client-overlay',
  // Agentation's feedback toolbar (a common dev-only annotation widget).
  '[data-feedback-toolbar]',
  '[data-agentation]',
  '[data-agentation-root]',
  'agentation-root',
  '[id^="agentation" i]',
  '[class*="agentation" i]',
];

// Overlay hiding that survives hydration and reaches into shadow roots:
//  - the rule is an adopted stylesheet (not a node, so a framework that
//    rewrites <head> cannot remove it) on the document and on every shadow
//    root, open or closed, created after this runs;
//  - a <style> tag is kept as a second copy;
//  - a sweep sets display:none inline on whatever still matches, so even a
//    page that replaces adoptedStyleSheets loses the overlay.
export const hideScript = ({ hide, redact, floating, keep }) => `(() => {
  if (window.__cap_hide) return;
  window.__cap_hide = true;
  const sel = ${JSON.stringify(hide)};
  const css = sel + ' { display: none !important; visibility: hidden !important; }' +
    ${JSON.stringify(redact ? `${redact} { filter: blur(7px) !important; }` : '')};
  let sheet = null;
  try { sheet = new CSSStyleSheet(); sheet.replaceSync(css); } catch {}
  const roots = new Set([document]);
  const adopt = (root) => {
    try {
      if (sheet && !root.adoptedStyleSheets.includes(sheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    } catch {}
  };
  // A <style> tag is the fallback for pages without constructable sheets.
  const tag = () => {
    const host = document.head || document.documentElement;
    if (!host || document.getElementById('__cap_hide')) return;
    const s = document.createElement('style');
    s.id = '__cap_hide';
    s.textContent = css;
    try { host.appendChild(s); } catch {}
  };
  const sweep = () => {
    for (const root of roots) {
      // The host was removed (a framework remounted its overlay): forget it.
      if (root.host && !root.host.isConnected) { roots.delete(root); continue; }
      adopt(root);
      if (root === document) tag();
      let found = [];
      try { found = root.querySelectorAll(sel); } catch {}
      for (const el of found) el.style.setProperty('display', 'none', 'important');
    }
  };
  // Shadow roots made after this point (a dev overlay mounts late, and its
  // mode may be closed) get the rule and are watched.
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    const root = attach.call(this, init);
    roots.add(root);
    adopt(root);
    new MutationObserver(sweep).observe(root, { childList: true, subtree: true });
    sweep();
    return root;
  };
  sweep();
  // For capture.mjs to check, at the end of a take, that nothing slipped through.
  Object.defineProperty(window, '__cap_hide_check', {
    value: () => {
      const left = [];
      for (const root of roots) {
        if (root.host && !root.host.isConnected) continue;
        let found = [];
        try { found = root.querySelectorAll(sel); } catch {}
        for (const el of found) if (getComputedStyle(el).display !== 'none') left.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''));
      }
      return left;
    },
  });
  document.addEventListener('DOMContentLoaded', sweep);
  new MutationObserver(sweep).observe(document, { childList: true, subtree: true });
  setInterval(sweep, 250);
  if (${!!floating}) {
    const keep = ${JSON.stringify(keep || '')};
    setInterval(() => {
      for (const root of roots) {
        for (const el of root.querySelectorAll(root === document ? 'body *' : '*')) {
          if (el.id === '__cap_cursor' || getComputedStyle(el).position !== 'fixed') continue;
          if (keep && el.closest(keep)) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 140 && r.height < 140) el.style.visibility = 'hidden';
        }
      }
    }, 150);
  }
})();`;

// Everything that tells time, slowed by N. rAF callbacks get the slowed
// timestamp so animation libraries see a consistent clock.
export const clockScript = (n) => `(() => {
  const N = ${n};
  const pn = performance.now.bind(performance), p0 = pn();
  performance.now = () => p0 + (pn() - p0) / N;
  const dn = Date.now, d0 = dn();
  Date.now = () => d0 + (dn() - d0) / N;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf(() => cb(performance.now()));
  const st = window.setTimeout.bind(window), si = window.setInterval.bind(window);
  window.setTimeout = (fn, ms = 0, ...a) => st(fn, ms * N, ...a);
  window.setInterval = (fn, ms = 0, ...a) => si(fn, ms * N, ...a);
})();`;

// The drawn cursor. It never listens to the page's mouse events: the capture
// script calls __cap_cursor.move/down/up with its own coordinates, so a real
// mouse over a visible window cannot drag it. The same API tells the page
// which pointer events are the script's, and the guard drops the rest.
// Top frame only: a cursor inside every iframe would draw twice.
export const cursorScript = ({ scale, ripple, guard }) => `(() => {
  if (window !== window.top) return;
  const S = ${scale};
  // Arrow, hand and I-beam, picked from the CSS cursor under the pointer,
  // the way the real pointer would change.
  const shapes = {
    arrow: [22, 28, 2, 2, '<path d="M2 2 L2 22 L7.5 17 L11 25.5 L14.5 24 L11 15.8 L18.5 15.8 Z" fill="black" stroke="white" stroke-width="1.6" stroke-linejoin="round"/>'],
    hand: [24, 28, 9, 2, '<path d="M9.5 2.6c1.2 0 2 .9 2 2v7.1l.9-.1c1 0 1.7.6 1.9 1.4l.6-.1c1 0 1.7.6 1.9 1.5h.4c1.1 0 2 .9 2 2v4.2c0 3.6-2.7 6.4-6.2 6.4h-2.6c-2 0-3.6-1-4.7-2.6l-3.4-5.1c-.6-.9-.4-2 .4-2.6.8-.6 1.9-.5 2.6.2l2.2 2.2V4.6c0-1.1.9-2 2-2z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/>'],
    text: [12, 24, 6, 12, '<path d="M2.5 2.5c1.8 0 2.9.6 3.5 1.6.6-1 1.7-1.6 3.5-1.6M6 4.1v15.8M2.5 21.5c1.8 0 2.9-.6 3.5-1.6.6 1 1.7 1.6 3.5 1.6M4 12h4" fill="none" stroke="white" stroke-width="3.4" stroke-linecap="round"/><path d="M2.5 2.5c1.8 0 2.9.6 3.5 1.6.6-1 1.7-1.6 3.5-1.6M6 4.1v15.8M2.5 21.5c1.8 0 2.9-.6 3.5-1.6.6 1 1.7 1.6 3.5 1.6M4 12h4" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round"/>'],
  };
  let c, shape = '', last = null;
  const allowed = [];
  // The cursor re-attaches itself on every call: frameworks that hydrate the
  // whole document (React on <html>) remove nodes they didn't render.
  const ensure = () => {
    if (!c) {
      c = document.createElement('div');
      c.id = '__cap_cursor';
      c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;display:none;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35));transition:scale 90ms ease-out;transform-origin:0 0';
    }
    if (!c.isConnected) (document.body || document.documentElement).appendChild(c);
    return c;
  };
  const setShape = (name) => {
    if (name === shape) return;
    shape = name;
    const [w, h, hx, hy] = shapes[name];
    const el = ensure();
    el.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w * S + '" height="' + h * S + '" viewBox="0 0 ' + w + ' ' + h + '">' + shapes[name][4] + '</svg>';
    // Keep the hotspot where it was when the shape changes in place.
    if (last) el.style.translate = (last[0] - hx * S) + 'px ' + (last[1] - hy * S) + 'px';
  };
  const kind = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const cur = el ? getComputedStyle(el).cursor : 'auto';
    if (cur === 'pointer') return 'hand';
    if (cur === 'text' || (el && el.matches('input:not([type=checkbox]):not([type=radio]), textarea, [contenteditable=""], [contenteditable=true]'))) return 'text';
    return 'arrow';
  };
  // Working out the shape means a hit test and a style read, which flushes
  // layout; doing it on every 8 ms step costs the page main thread more than
  // the step is worth, so it is redone every 50 ms (and always on a click).
  let shapeAt = -1e9;
  const place = (x, y, force, announce = true) => {
    last = [x, y];
    if (announce) {
      allowed.push(last);
      if (allowed.length > 6) allowed.shift();
    }
    const now = performance.now();
    if (force || shape === '' || now - shapeAt > 50) {
      shapeAt = now;
      setShape(kind(x, y));
    }
    const el = ensure();
    const [, , hx, hy] = shapes[shape];
    el.style.display = 'block';
    el.style.translate = (x - hx * S) + 'px ' + (y - hy * S) + 'px';
    return shape;
  };
  // A glide is animated here, one position per rendered frame on the (slowed)
  // page clock, not by one CDP round trip per step: a late step from the
  // script can no longer leave a frame showing the cursor where it was.
  let glideId = 0;
  const glide = (x0, y0, x1, y1, sec) => {
    const id = ++glideId;
    const t0 = performance.now();
    const tick = () => {
      if (id !== glideId) return;
      const e = Math.min(1, (performance.now() - t0) / (sec * 1000));
      const k = e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2;
      place(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, false, false);
      if (e < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  // The page can change under a still pointer (a button that disappears
  // after its click); re-check the shape the way the OS pointer would.
  setInterval(() => {
    if (last && c && c.style.display === 'block') setShape(kind(last[0], last[1]));
  }, 120);
  const ring = (x, y) => {
    // A soft ring where the click landed: reads on video, gone in 450 ms.
    const r = document.createElement('div');
    r.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;left:' + x + 'px;top:' + y + 'px;width:' + 34 * S + 'px;height:' + 34 * S + 'px;margin:' + -17 * S + 'px 0 0 ' + -17 * S + 'px;border-radius:50%;background:rgba(59,107,255,.16);box-shadow:0 0 0 2px rgba(59,107,255,.55)';
    (document.body || document.documentElement).appendChild(r);
    // Driven by rAF on performance.now(), which the slowed clock patches:
    // element.animate() isn't slowed and would be gone in one frame.
    const born = performance.now();
    const tick = () => {
      const k = Math.min(1, (performance.now() - born) / 480);
      const e = 1 - Math.pow(1 - k, 3);
      r.style.scale = String(0.35 + 0.65 * e);
      r.style.opacity = String(1 - k * k);
      if (k < 1) requestAnimationFrame(tick); else r.remove();
    };
    requestAnimationFrame(tick);
  };
  Object.defineProperty(window, '__cap_cursor_api', {
    value: {
      move: (x, y) => { glideId++; return place(x, y); },
      // The script says where its synthetic event is about to land (so the
      // guard lets it through); the drawing is the glide's business.
      allow: (x, y) => { allowed.push([x, y]); if (allowed.length > 6) allowed.shift(); return shape; },
      glide,
      down: (x, y) => {
        glideId++;
        const s = place(x, y, true);
        ensure().style.scale = '0.86';
        if (${!!ripple}) ring(x, y);
        return s;
      },
      up: () => { glideId++; ensure().style.scale = '1'; },
    },
  });
  // The person's own mouse: a real pointer over a visible window sends events
  // the script did not dispatch. Drop any trusted pointer event that is not
  // where the script just put the pointer (keyboard-made clicks have detail 0).
  if (${!!guard}) {
    const types = ['mousemove', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu',
      'pointermove', 'pointerdown', 'pointerup', 'mouseover', 'mouseout', 'pointerover', 'pointerout'];
    const near = (e) => allowed.some((p) => Math.abs(p[0] - e.clientX) < 2 && Math.abs(p[1] - e.clientY) < 2);
    for (const t of types) {
      addEventListener(t, (e) => {
        if (!e.isTrusted || (e.pointerType && e.pointerType !== 'mouse')) return;
        if (e.type === 'click' && e.detail === 0) return;
        if (!near(e)) e.stopImmediatePropagation();
      }, true);
    }
  }
})();`;

// Element queries shared by steps, dry runs and scout. Runs in the page; takes
// a target ({selector}, {text}) and answers about it. Kept as one function so
// the "on screen" and "smallest match" rules exist in exactly one place.
const QUERY = `async (op, arg) => {
  const shown = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const visible = (e) => shown(e) && getComputedStyle(e).visibility !== 'hidden';
  // Something a person could click: laid out, not hidden, not fully
  // transparent (the element or anything above it).
  const actionable = (e) => {
    if (!visible(e)) return false;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) if (getComputedStyle(n).opacity === '0') return false;
    return true;
  };
  const TEXTY = 'button, a, [role], label, span, div, p, h1, h2, h3, h4, h5, h6, li, td, th, strong, em, code';
  const find = (p) => {
    if (!p) return null;
    if (p.text) {
      return [...document.querySelectorAll(TEXTY)]
        .filter((e) => e.textContent.trim() === p.text && actionable(e))
        .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0] || null;
    }
    if (p.selector) {
      let all = [];
      try { all = [...document.querySelectorAll(p.selector)]; } catch (e) { return { error: String(e.message || e) }; }
      return all.find(actionable) || null;
    }
    return null;
  };
  const box = (e) => {
    const r = e.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height];
  };
  const name = (e) => {
    const t = (s) => (s || '').replace(/\\s+/g, ' ').trim();
    return t(e.getAttribute('aria-label')) || t(e.innerText) || t(e.getAttribute('placeholder')) ||
      t(e.getAttribute('title')) || t(e.value) || t(e.getAttribute('alt')) || t(e.getAttribute('name')) || '';
  };
  const role = (e) => e.getAttribute('role') || ({ a: 'link', button: 'button', select: 'select', textarea: 'textarea',
    input: 'input:' + (e.type || 'text'), summary: 'summary' }[e.tagName.toLowerCase()]) || e.tagName.toLowerCase();
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\\w-]/g, '\\\\$&'));
  const q = (s) => s.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");
  // A target that resolves back to this very element, preferring what the
  // steps reference documents: text, then a stable attribute.
  const target = (e) => {
    const same = (p) => { const f = find(p); return f && !f.error && f === e; };
    const txt = (e.innerText || '').replace(/\\s+/g, ' ').trim();
    if (txt && txt.length <= 60 && e.textContent.trim() === txt && same({ text: txt })) return { text: txt };
    const tag = e.tagName.toLowerCase();
    const tries = [];
    for (const a of ['data-testid', 'data-test', 'data-cy', 'aria-label', 'name', 'placeholder', 'title']) {
      const v = e.getAttribute(a);
      if (v) tries.push(tag + '[' + a + "='" + q(v) + "']");
    }
    if (e.id && !/\\d{4,}|^[:r]\\w*:$/.test(e.id)) tries.unshift('#' + esc(e.id));
    if (e.getAttribute('href')) tries.push(tag + "[href='" + q(e.getAttribute('href')) + "']");
    const cls = [...e.classList].filter((c) => !/\\d{3,}|__|--|^css-|^_/.test(c)).slice(0, 2);
    if (cls.length) tries.push(tag + '.' + cls.map(esc).join('.'));
    for (const s of tries) if (same({ selector: s })) return { selector: s };
    // Last resort: a path through nth-of-type.
    const path = [];
    for (let n = e; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      const sibs = [...n.parentElement.children].filter((c) => c.tagName === n.tagName);
      path.unshift(n.tagName.toLowerCase() + (sibs.length > 1 ? ':nth-of-type(' + (sibs.indexOf(n) + 1) + ')' : ''));
      if (n.id) { path[0] = '#' + esc(n.id); break; }
    }
    return { selector: path.join(' > ') };
  };

  if (op === 'settle') {
    // Playwright-style actionability: the target exists, is visible, and keeps
    // the same box across two consecutive animation frames. Answers with where
    // it stands: notfound, invisible (matches exist but none could be clicked),
    // moving, or ok with the box. Nothing waits when the target is already still.
    let all = [];
    if (arg.text) all = [...document.querySelectorAll(TEXTY)].filter((e) => e.textContent.trim() === arg.text);
    else {
      try { all = [...document.querySelectorAll(arg.selector)]; } catch (e) { return { state: 'bad', error: String(e.message || e) }; }
    }
    if (!all.length) return { state: 'notfound' };
    let el = all.filter(actionable);
    if (arg.text) el.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
    el = el[0];
    if (!el) return { state: 'invisible' };
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const b0 = box(el);
    await frame();
    const b1 = box(el);
    await frame();
    const b2 = box(el);
    const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.05);
    if (!el.isConnected || !actionable(el)) return { state: 'moving' };
    return same(b0, b1) && same(b1, b2) ? { state: 'ok', box: b2 } : { state: 'moving' };
  }
  if (op === 'box') {
    const e = find(arg);
    return e && !e.error ? box(e) : null;
  }
  if (op === 'point') {
    // The target's box, after scrolling it into view ("nearest" leaves
    // anything already in view alone, so an option further down a list is
    // reached before it is clicked).
    const e = find(arg);
    if (!e) return { miss: true };
    if (e.error) return { bad: e.error };
    e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return { box: box(e) };
  }
  if (op === 'seen') {
    const want = arg.text || null;
    const el = want
      ? [...document.querySelectorAll('body *')].find((e) => e.childElementCount === 0 && e.textContent.trim() === want && visible(e))
      : (() => { try { return [...document.querySelectorAll(arg.selector || '')].find(visible); } catch { return null; } })();
    return Boolean(el);
  }
  if (op === 'focused') {
    const el = document.activeElement;
    return !el || el === document.body ? null : box(el);
  }
  if (op === 'candidates') {
    // Visible things that look like what a missed target was after.
    const words = (s) => (s || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
    const want = arg.text ? words(arg.text) : words((arg.selector || '').replace(/\\[[^\\]]*\\]/g, (m) => m.replace(/[\\[\\]'"=~^$*|]/g, ' ')));
    const wantText = (arg.text || '').toLowerCase();
    const sel = arg.selector || '';
    const tagWant = (sel.match(/^[a-z][a-z0-9-]*/i) || [''])[0].toLowerCase();
    const roleWant = (sel.match(/role=['"]?([\\w-]+)/) || [])[1];
    const out = [];
    for (const e of document.querySelectorAll('body *')) {
      if (!visible(e) || e.closest('#__cap_cursor')) continue;
      const hay = (name(e) + ' ' + (e.id || '') + ' ' + (typeof e.className === 'string' ? e.className : '') + ' ' + [...e.attributes].map((a) => a.value).join(' ')).toLowerCase();
      let score = 0;
      if (wantText && name(e).toLowerCase().includes(wantText)) score += 6;
      for (const w of want) if (hay.includes(w)) score += 2;
      if (tagWant && e.tagName.toLowerCase() === tagWant) score += 1;
      if (roleWant && e.getAttribute('role') === roleWant) score += 3;
      if (!score) continue;
      // Controls over containers: a button beats the row that holds it.
      const control = /^(a|button|input|select|textarea|summary|label)$/i.test(e.tagName) || e.hasAttribute('role');
      if (control) score += 3;
      else score -= Math.min(4, e.childElementCount);
      const r = e.getBoundingClientRect();
      if (r.width * r.height > innerWidth * innerHeight * 0.2) score -= 4;
      out.push({ score, e });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 8).map(({ e }) => ({ role: role(e), name: name(e).slice(0, 50), target: target(e), box: box(e).map(Math.round) }));
  }
  if (op === 'scout') {
    const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [contenteditable=""], [contenteditable=true], ' +
      '[role=button], [role=link], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=checkbox], [role=radio], ' +
      '[role=switch], [role=option], [role=combobox], [role=textbox], [role=searchbox], [role=slider], [onclick], [tabindex]:not([tabindex="-1"])';
    const vw = innerWidth, vh = innerHeight;
    // Really on screen: nothing faded out above it, and the topmost thing at
    // its centre is it (or part of it). Drops closed drawers and modals that
    // are laid out but invisible.
    const onscreen = (e) => {
      for (let n = e; n && n.nodeType === 1; n = n.parentElement) if (getComputedStyle(n).opacity === '0') return false;
      const r = e.getBoundingClientRect();
      const top = document.elementFromPoint(Math.min(vw - 1, Math.max(0, r.x + r.width / 2)), Math.min(vh - 1, Math.max(0, r.y + r.height / 2)));
      return Boolean(top) && (e.contains(top) || top.contains(e));
    };
    const picked = [];
    for (const e of document.querySelectorAll(SEL)) {
      if (!visible(e) || e.closest('#__cap_cursor')) continue;
      const r = e.getBoundingClientRect();
      if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) continue;
      if (!onscreen(e)) continue;
      picked.push(e);
    }
    // Pointer-cursor elements the selectors above missed (div "buttons").
    for (const e of document.querySelectorAll('body *')) {
      if (picked.includes(e) || !visible(e) || e.closest('#__cap_cursor')) continue;
      if (getComputedStyle(e).cursor !== 'pointer') continue;
      const r = e.getBoundingClientRect();
      if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh || r.width > vw * 0.9) continue;
      if (picked.some((p) => p.contains(e)) || !onscreen(e)) continue;
      picked.push(e);
    }
    const keep = picked.filter((e) => !picked.some((p) => p !== e && p.contains(e) && p.tagName !== 'LABEL'));
    keep.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return Math.round(ra.top / 12) - Math.round(rb.top / 12) || ra.left - rb.left;
    });
    return {
      title: document.title,
      url: location.href,
      view: [vw, vh],
      items: keep.slice(0, arg.max || 80).map((e) => ({
        role: role(e) + (e.disabled ? ' (disabled)' : ''),
        name: name(e).slice(0, 60),
        target: target(e),
        box: box(e).map(Math.round),
      })),
      more: Math.max(0, keep.length - (arg.max || 80)),
    };
  }
  if (op === 'signin') {
    // An obvious sign-in page: a visible password field, or a path that says so.
    const pw = [...document.querySelectorAll('input[type=password]')].some(visible);
    const path = location.pathname + ' ' + location.hostname;
    const named = /(^|[\\/.-])(sign-?in|log-?in|login|signin|sso|auth|authorize|oauth2?|accounts)([\\/.?-]|$)/i.test(path);
    return { pw, named, url: location.href };
  }
  return null;
}`;

export const query = (op, arg = null) => `(${QUERY})(${JSON.stringify(op)}, ${JSON.stringify(arg)})`;
