'use strict';
// Бэкапы данных экстрактора (data/store.json).
const fs = require('fs');
const path = require('path');
const notify = require('./notify');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DIR = path.join(DATA_DIR, 'backups');
// настройки берутся из базы (store.cfg), см. schedule()
let cfg = (k) => ({ backupKeep: 14, backupHours: 24, backupToTelegram: true, panelName: '' }[k]);
const KEEP = () => Math.max(1, Number(cfg('backupKeep')) || 14);
const EVERY_H = () => Math.max(1, Number(cfg('backupHours')) || 24);

const NAME_RE = /^store-\d{8}-\d{6}(-[a-z-]+)?\.json$/;
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

function list() {
  try {
    return fs.readdirSync(DIR).filter((n) => NAME_RE.test(n)).map((n) => {
      const st = fs.statSync(path.join(DIR, n));
      return { name: n, size: st.size, time: st.mtime.toISOString(), kind: 'store' };
    }).sort((a, b) => b.time.localeCompare(a.time));
  } catch { return []; }
}

function prune(kind) {
  const old = list().filter((b) => b.kind === kind).slice(KEEP());
  for (const b of old) { try { fs.unlinkSync(path.join(DIR, b.name)); } catch { /* ignore */ } }
}

/** @param {object} data состояние store @param {string} reason auto|manual|restore */
async function create(data, reason = 'manual', { send = cfg('backupToTelegram') !== false } = {}) {
  fs.mkdirSync(DIR, { recursive: true });
  const name = `store-${stamp()}${reason === 'manual' ? '' : `-${reason}`}.json`;
  const body = JSON.stringify({ app: 'link-extractor', version: 1, createdAt: new Date().toISOString(), panel: cfg('panelName') || '', data }, null, 2);
  fs.writeFileSync(path.join(DIR, name), body);
  prune('store');
  if (send && notify.enabled()) {
    const n = (data.sources || []).length;
    await notify.sendDocument(name, Buffer.from(body), `💾 Бэкап экстрактора: ${n} источников`);
  }
  return { name, size: body.length };
}

function read(name) {
  if (!NAME_RE.test(name)) throw new Error('Неверное имя бэкапа');
  return fs.readFileSync(path.join(DIR, name));
}

// Принимает файл бэкапа или голый store.json
function parseRestore(input) {
  const j = typeof input === 'string' ? JSON.parse(input) : input;
  const data = j && j.app === 'link-extractor' ? j.data : j;
  if (!data || !Array.isArray(data.sources)) throw new Error('Это не бэкап Link Extractor: нет списка sources');
  return data;
}


let timer = null;
function schedule(getState, getCfg) {
  if (getCfg) cfg = getCfg;
  if (timer) clearInterval(timer);
  const tick = async () => {
    const last = list().find((b) => b.kind === 'store' && /-auto\.json$/.test(b.name));
    if (last && Date.now() - new Date(last.time).getTime() < EVERY_H() * 3600 * 1000 - 60000) return;
    try { await create(getState(), 'auto'); } catch (e) { console.warn('[backup]', e.message); }
  };
  timer = setInterval(tick, 15 * 60 * 1000);
  timer.unref();
  setTimeout(tick, 30000).unref();
}

module.exports = { list, create, read, parseRestore, schedule, DIR };
