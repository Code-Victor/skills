// CDP plumbing for capture.mjs: one browser-level websocket, a target that
// is created in the background, and a guaranteed close.
//
// Everything goes through the browser websocket with a flattened session, so
// nothing here needs /json/new (which opens a tab in front and takes focus)
// and nothing calls Page.bringToFront.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function browserInfo(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) });
  return r.json();
}

// Connect to Chrome on `port` and open one background tab. Resolves to
// { send, on, off, close, headless, info, targetId }.
export async function openTab(port, { width, height } = {}) {
  let info;
  try {
    info = await browserInfo(port);
  } catch {
    const e = new Error(`No Chrome on port ${port}. Start one with scripts/chrome.sh.`);
    e.code = 'NO_CHROME';
    throw e;
  }
  const headless = /Headless/i.test(info.Browser + info['User-Agent']);
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else listeners.forEach((fn) => fn(m));
  };
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error(`Could not open the DevTools websocket on port ${port}`));
  });
  ws.onclose = () => {
    for (const [, fn] of pending) fn({ error: { message: 'websocket closed' } });
    pending.clear();
  };

  // Every call is bounded in wall time: a crashed or hung page must fail the
  // take, not hang it.
  const raw = (method, params = {}, sessionId, limitMs = 60000) =>
    new Promise((res, rej) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        rej(new Error(`${method} did not answer within ${limitMs / 1000} s (page hung or crashed?)`));
      }, limitMs);
      pending.set(id, (m) => {
        clearTimeout(timer);
        m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result);
      });
      try {
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch (e) {
        clearTimeout(timer);
        pending.delete(id);
        rej(e);
      }
    });

  // background: no focus change. A background tab inside an existing window
  // does not paint in a headed browser, so a headed browser gets its own
  // (unfocused) window; headless has no windows to speak of.
  const created = await raw('Target.createTarget', {
    url: 'about:blank',
    background: true,
    ...(headless ? {} : { newWindow: true }),
    ...(width && height ? { width: Math.min(width, 3000), height: Math.min(height, 3000) } : {}),
  });
  const targetId = created.targetId;
  const { sessionId } = await raw('Target.attachToTarget', { targetId, flatten: true });

  const send = (method, params, limitMs) => raw(method, params, sessionId, limitMs);
  const on = (fn) => {
    const h = (m) => {
      if (m.sessionId === sessionId) fn(m);
    };
    fn.__h = h;
    listeners.add(h);
  };
  const off = (fn) => listeners.delete(fn.__h);

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await Promise.race([raw('Target.closeTarget', { targetId }, undefined, 1500), sleep(1500)]);
    } catch {}
    // Belt and braces: the HTTP endpoint also closes a stuck target.
    await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`, { signal: AbortSignal.timeout(1500) }).catch(() => {});
    try { ws.close(); } catch {}
  };
  return { send, browserSend: raw, on, off, close, headless, info, targetId, port };
}

// Other page targets on this Chrome (other takes running at the same time).
export async function otherPages(port, ownId) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })).json();
    return list.filter((t) => t.type === 'page' && t.id !== ownId && t.url !== 'about:blank' && !/^(devtools|chrome|chrome-untrusted):/.test(t.url));
  } catch {
    return [];
  }
}
