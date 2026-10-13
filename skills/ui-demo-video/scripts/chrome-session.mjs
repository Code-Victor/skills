#!/usr/bin/env node
// Carries cookies across a Chrome restart (used by chrome.sh).
//
//   chrome-session.mjs save    <port> <file>   all cookies of the default profile
//   chrome-session.mjs restore <port> <file>   put them back, then delete the file
//
// Session cookies have no expiry and die with the browser process, so a login
// that lives in one would be lost when chrome.sh swaps the headed window for
// the headless Chrome. Storage.getCookies on the browser target reads them all.
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const [cmd, port, file] = process.argv.slice(2);
if (!['save', 'restore'].includes(cmd) || !port || !file) {
  console.error('usage: chrome-session.mjs save|restore <port> <file>');
  process.exit(2);
}
const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(info.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('websocket')); });
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const call = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id;
  pending.set(n, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});

if (cmd === 'save') {
  const { cookies } = await call('Storage.getCookies');
  writeFileSync(file, JSON.stringify(cookies), { mode: 0o600 });
  chmodSync(file, 0o600);
  console.log(`saved ${cookies.length} cookies`);
} else {
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  const cookies = saved.map((c) => {
    const p = {
      name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly,
      ...(c.sameSite ? { sameSite: c.sameSite } : {}),
      ...(c.priority ? { priority: c.priority } : {}),
      ...(c.partitionKey ? { partitionKey: c.partitionKey } : {}),
    };
    if (!c.session && c.expires > 0) p.expires = c.expires; // session cookies stay without one
    return p;
  });
  let set = cookies.length;
  try {
    await call('Storage.setCookies', { cookies });
  } catch {
    // One bad cookie fails the whole batch; set them one by one and count.
    set = 0;
    for (const c of cookies) {
      try { await call('Storage.setCookies', { cookies: [c] }); set++; } catch {}
    }
  }
  rmSync(file, { force: true });
  const dropped = cookies.length - set;
  console.log(dropped ? `restored ${set} of ${cookies.length} cookies (${dropped} dropped)` : `restored ${set} cookies`);
}
ws.close();
