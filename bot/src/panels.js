'use strict';
// База бота (data/db.json): список панелей и настройки бота + клиент API экстракторов.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');
const OLD_FILE = path.join(DATA_DIR, 'panels.json');

const DEFAULT_SETTINGS = { backupHours: 24, lastBackupAt: null };
let state = { panels: [], settings: { ...DEFAULT_SETTINGS } };
function load() {
  try {
    const f = fs.existsSync(FILE) ? FILE : fs.existsSync(OLD_FILE) ? OLD_FILE : null;
    if (f) state = { panels: [], ...JSON.parse(fs.readFileSync(f, 'utf8')) };
    state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
    if (f === OLD_FILE) { save(); fs.renameSync(OLD_FILE, `${OLD_FILE}.migrated`); }
  } catch (e) { console.error('[db]', e.message); }
}
const settings = () => state.settings;
function setSetting(k, v) { state.settings[k] = v; save(); }
const exportDb = () => JSON.parse(JSON.stringify(state));
function importDb(db) {
  if (!db || !Array.isArray(db.panels)) throw new Error('В файле нет списка панелей');
  state = { panels: db.panels, settings: { ...DEFAULT_SETTINGS, ...(db.settings || {}) } };
  save();
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

module.exports = { load, save, list, get, add, remove, rename, api, normUrl, settings, setSetting, exportDb, importDb };
