'use strict';
// Список панелей (экстракторов) и клиент их API.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'panels.json');

let state = { panels: [] };
function load() {
  try { if (fs.existsSync(FILE)) state = { panels: [], ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch (e) { console.error('[panels]', e.message); }
}
function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(`${FILE}.tmp`, FILE);
}

const list = () => state.panels;
const get = (id) => state.panels.find((p) => p.id === id);

function normUrl(u) {
  let s = String(u || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  if (!/\/link-extractor$/.test(s)) s += '/link-extractor';
  return s;
}

function add({ name, url, token, local = false }) {
  const p = { id: crypto.randomBytes(3).toString('hex'), name: String(name || 'Панель').slice(0, 40), url: normUrl(url), token, local, addedAt: new Date().toISOString() };
  const same = state.panels.find((x) => x.url === p.url);
  if (same) { Object.assign(same, { name: p.name, token }); save(); return same; }
  state.panels.push(p); save(); return p;
}
function remove(id) { state.panels = state.panels.filter((p) => p.id !== id); save(); }
function rename(id, name) { const p = get(id); if (p) { p.name = String(name).slice(0, 40); save(); } return p; }

async function api(panel, method, apiPath, body, { raw = false, timeout = 60000 } = {}) {
  let r;
  try {
    r = await fetch(`${panel.url}/api${apiPath}`, {
      method,
      headers: { Authorization: `Bearer ${panel.token}`, 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw new Error(`Панель «${panel.name}» недоступна: ${e.name === 'TimeoutError' ? 'таймаут' : e.message}`);
  }
  if (raw) {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') };
  }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error(`Панель «${panel.name}»: неверный API-токен`);
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

module.exports = { load, save, list, get, add, remove, rename, api, normUrl };
