'use strict';
// Хранилище источников (ключи и ссылки на подписки) в JSON-файле + автообновление.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseLink, extractLinksFromText, summarize, isStub } = require('./parse');
const rw = require('./remnawave');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'store.json');

// Пресеты User-Agent (формат как в инспекторе HWID: клиент/версия/платформа/билд)
const UA_PRESETS = [
  { id: 'happ-android', label: 'Happ · Android', ua: 'Happ/4.11.2/Android/17948118661831751611', os: 'Android', ver: '15', model: 'SM-S918B' },
  { id: 'happ-ios', label: 'Happ · iOS', ua: 'Happ/4.13.0/ios/2606221801679', os: 'iOS', ver: '27.2.1', model: 'iPhone 14' },
  { id: 'happ-windows', label: 'Happ · Windows', ua: 'Happ/4.6.1/Windows/2610271012508', os: 'Windows', ver: '11_10.0.26200', model: 'PC_x86_64' },
  { id: 'happ-macos', label: 'Happ · macOS', ua: 'Happ/6.4.0/macos catalyst/2611051059600', os: 'macOS', ver: '27.0', model: 'MacBook' },
  { id: 'incy-android', label: 'INCY · Android', ua: 'INCY/3.9.9/android Dalvik/2.1.0', os: 'Android', ver: '15', model: 'SM-S918B' },
  { id: 'incy-ios', label: 'INCY · iOS', ua: 'INCY/2.7.3/ios CFNetwork/3896.100.1.2.1 Darwin/27.0.0', os: 'iOS', ver: '27.0.1', model: 'iPhone 15 Plus' },
  { id: 'v2rayng', label: 'v2rayNG', ua: 'v2rayNG/1.10.16' },
  { id: 'v2rayn', label: 'v2rayN', ua: 'v2rayN/7.10.0' },
];
// Порядок перебора в режиме «Авто»
const AUTO_ORDER = ['happ-android', 'happ-ios', 'incy-android', 'v2rayng', 'happ-windows'];

let state = { sources: [], settings: { refreshMinutes: parseInt(process.env.REFRESH_MINUTES || '10', 10) } };

function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(FILE)) state = { ...state, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
    // старые источники до появления сквадов — оставляем «всем»
    for (const s of state.sources) if (!s.scope) s.scope = 'all';
  } catch (e) { console.error('[store] не удалось прочитать', e.message); }
}

function save() {
  version++;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

function decodeLinks(links) {
  const ok = []; const errors = [];
  for (const raw of links) {
    try {
      const node = parseLink(raw);
      if (isStub(node)) errors.push({ raw, error: `Заглушка (${node.server}) — пропущен` }); else ok.push({ raw, node });
    } catch (e) { errors.push({ raw, error: e.message }); }
  }
  return { ok, errors };
}

// Стабильный HWID для каждой ссылки, чтобы не съедать лимит устройств при каждом обновлении
function hwidFor(url) { return crypto.createHash('sha256').update(`le-hwid:${url}`).digest('hex').slice(0, 16); }

function headersFor(url, uaSetting) {
  const preset = UA_PRESETS.find((p) => p.id === uaSetting);
  const ua = preset ? preset.ua : uaSetting;
  const h = { 'User-Agent': ua, Accept: '*/*', 'X-Link-Extractor-Fetch': '1' };
  if (/^(happ|incy)\//i.test(ua)) {
    h['X-HWID'] = hwidFor(url);
    const p = preset || UA_PRESETS.find((x) => x.ua.split('/')[0].toLowerCase() === ua.split('/')[0].toLowerCase() && ua.toLowerCase().includes((x.os || '').toLowerCase()));
    if (p?.os) { h['X-Device-OS'] = p.os; h['X-Ver-OS'] = p.ver; h['X-Device-Model'] = p.model; }
    h['X-Device-Locale'] = 'ru';
  }
  return h;
}

async function fetchOnce(url, uaSetting) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: headersFor(url, uaSetting), signal: ctrl.signal, redirect: 'follow' });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const all = extractLinksFromText(text);
    if (!all.length) throw new Error('В ответе нет ключей');
    const links = all.filter((l) => { try { return !isStub(parseLink(l)); } catch { return true; } });
    if (!links.length) throw new Error('Провайдер отдал только заглушку (127.0.0.1) — этот User-Agent не принят');
    return { links, userinfo: res.headers.get('subscription-userinfo') || undefined };
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Таймаут запроса' : e.message);
  } finally { clearTimeout(timer); }
}

// uaSetting: 'auto' | id пресета | произвольная строка
async function fetchSubscription(url, uaSetting = 'auto') {
  if (uaSetting && uaSetting !== 'auto') {
    const r = await fetchOnce(url, uaSetting);
    return { ...r, usedUa: uaSetting };
  }
  const errors = [];
  for (const id of AUTO_ORDER) {
    try { const r = await fetchOnce(url, id); return { ...r, usedUa: id }; } catch (e) { errors.push(`${id}: ${e.message}`); }
  }
  throw new Error(`Авто: ни один User-Agent не сработал (${errors.join('; ')})`);
}

// ---------- хосты в панели Remnawave ----------
const keyId = (raw) => crypto.createHash('sha1').update(String(raw).split('#')[0]).digest('hex').slice(0, 8);
const { markerAddress } = require('./replace');

function stub() { return state.settings.stubInbound || null; }

// Если заглушка не выбрана — берём инбаунд профиля Balancer (или любого профиля без нод)
async function ensureStub() {
  if (stub() || !rw.enabled()) return stub();
  try {
    const ib = await rw.findStubInbound();
    if (ib) { state.settings.stubInbound = { uuid: ib.uuid, profileUuid: ib.profileUuid, tag: ib.tag, type: ib.type, profileName: ib.profileName, auto: true }; save(); }
  } catch (e) { console.warn('[stub]', e.message); }
  return stub();
}

// Перевод старых источников: сквады без старого префикса, ЗАГЛАВНЫМИ, с инбаундом-заглушкой, и хосты в панели
async function migrate() {
  if (!rw.enabled() || !(await ensureStub())) return;
  let changed = false;
  for (const src of state.sources) {
    try {
      if (src.squadCreated && src.squadUuid && /^3xui\b/i.test(src.squadName || '')) {
        const name = await rw.uniqueSquadName(src.title || String(src.squadName).replace(/^3xui\s*/i, '') || defaultTitle(src), src.squadUuid);
        await rw.renameSquad(src.squadUuid, name); src.squadName = name; changed = true;
      }
      if (!src.hostMode) {
        src.hostMode = true; src.hostTag = rw.hostTag(src.title || src.squadName || defaultTitle(src)); changed = true;
        await syncHosts(src);
      }
      if (src.squadUuid) await rw.ensureSquadInbound(src.squadUuid, stub().uuid);
    } catch (e) { src.hostError = e.message; console.warn('[migrate]', e.message); }
  }
  if (changed) save();
}

function hostSquads(src) {
  return src.scope === 'squad' && src.squadUuid ? { mode: 'ALLOW_ONLY', squads: [src.squadUuid] } : { mode: 'EXCLUDE', squads: [] };
}

// Чистит название: убирает мусор вроде ^~2~^, оставляет буквы, цифры, эмодзи/флаги и разделители
function cleanRemark(name) {
  const s = String(name || '')
    .replace(/[^\p{L}\p{N}\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u200d\ufe0f\s·|()\-.,:+]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
  return s.replace(/^[\s·|\-.,:]+|[\s·|\-.,:]+$/g, '').trim();
}

// Если название занято — берём следующий номер: «🇳🇱 Нидерланды», «🇳🇱 Нидерланды 2», «… 3»
function uniqueRemark(name, used) {
  const clean = (cleanRemark(name) || 'Server').slice(0, 95);
  const key = (x) => x.toLowerCase();
  if (!used.has(key(clean))) { used.add(key(clean)); return clean; }
  const base = clean.replace(/\s+\d+$/, '');
  let max = 1;
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s+(\\d+))?$`, 'i');
  for (const u of used) { const m = u.match(re); if (m) max = Math.max(max, m[1] ? parseInt(m[1], 10) : 1); }
  const name2 = `${base} ${max + 1}`;
  used.add(key(name2));
  return name2;
}

async function syncHosts(src) {
  const st = stub();
  if (!src.hostMode || !st || !rw.enabled()) return;
  src.hosts = src.hosts || {};
  // Хост удалили руками в панели → считаем ключ выключенным и не пересоздаём
  let panelHosts;
  try { panelHosts = await rw.listHosts(); } catch (e) { src.hostError = e.message; return; }
  const panel = new Set(panelHosts.map((h) => h.uuid));
  const byUuid = new Map(panelHosts.map((h) => [h.uuid, h]));
  // занятые названия — все хосты панели, кроме наших ещё не почищенных
  const used = new Set(panelHosts.filter((h) => !Object.values(src.hosts).some((x) => x.uuid === h.uuid && !x.cleaned)).map((h) => String(h.remark).toLowerCase()));
  // разовая чистка уже созданных хостов: название без мусора, без описания сервера
  for (const h of Object.values(src.hosts)) {
    const ph = byUuid.get(h.uuid);
    if (!ph || h.cleaned) continue;
    try {
      const remark = uniqueRemark(ph.remark, used);
      await rw.updateHost({ uuid: h.uuid, remark, serverDescription: null });
      h.cleaned = true;
    } catch (e) { src.hostError = e.message; }
  }
  const off = new Set(src.disabledLinks || []);
  for (const [id, h] of Object.entries(src.hosts)) {
    if (!panel.has(h.uuid)) { if (h.raw) off.add(h.raw); delete src.hosts[id]; }
  }
  src.disabledLinks = [...off];
  const desired = new Map();
  for (const x of decodeLinks(src.links || []).ok) if (!off.has(x.raw)) desired.set(keyId(x.raw), x);
  // удалить хосты пропавших ключей
  const gone = Object.keys(src.hosts).filter((id) => !desired.has(id));
  try { await rw.deleteHosts(gone.map((id) => src.hosts[id].uuid)); gone.forEach((id) => delete src.hosts[id]); } catch (e) { src.hostError = e.message; }
  // создать хосты новых ключей
  const errs = [];
  for (const [id, x] of desired) {
    if (src.hosts[id]) { src.hosts[id].raw = x.raw; continue; }
    try {
      const h = await rw.createHost({
        inbound: { configProfileUuid: st.profileUuid, configProfileInboundUuid: st.uuid },
        remark: uniqueRemark(x.node.name || x.node.server, used),
        address: markerAddress(x.node.server, id),
        port: x.node.port,
        tags: [src.hostTag || 'VPN'],
        isDisabled: !src.enabled,
        internalSquads: hostSquads(src),
      });
      src.hosts[id] = { uuid: h.uuid, raw: x.raw, cleaned: true };
    } catch (e) { errs.push(e.message); }
  }
  src.hostError = errs.length ? errs[0] : undefined;
}

async function updateHostsMeta(src) {
  if (!src.hostMode || !src.hosts) return;
  for (const h of Object.values(src.hosts)) {
    try { await rw.updateHost({ uuid: h.uuid, internalSquads: hostSquads(src), tags: [src.hostTag || 'VPN'] }); } catch (e) { src.hostError = e.message; }
  }
}

// Ключ по id маркера (для подмены заглушек в подписке)
let markerCache = { ver: -1, map: new Map() };
let version = 0;
function resolveMarker(id) {
  if (markerCache.ver !== version) {
    const map = new Map();
    for (const src of state.sources) {
      if (!src.hostMode || !src.enabled) continue;
      for (const x of decodeLinks(src.links || []).ok) map.set(keyId(x.raw), x);
    }
    markerCache = { ver: version, map };
  }
  return markerCache.map.get(id) || null;
}

function uaLabel(id) { const p = UA_PRESETS.find((x) => x.id === id); return p ? p.label : id; }

// Разбирает вставленный текст: строки http(s) — подписки, остальное — ключи
function splitInput(text) {
  const subs = []; const rest = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    if (/^https?:\/\//i.test(l)) subs.push(l); else rest.push(l);
  }
  return { subs, links: extractLinksFromText(rest.join('\n')) };
}

async function preview(text, userAgent) {
  const { subs, links } = splitInput(text);
  const result = { sources: [] };
  if (links.length) {
    const d = decodeLinks(links);
    result.sources.push({ kind: 'links', input: `${links.length} ключ(ей)`, nodes: d.ok.map((x) => ({ raw: x.raw, ...summarize(x.node) })), errors: d.errors });
  }
  for (const url of subs) {
    try {
      const r = await fetchSubscription(url, userAgent);
      const d = decodeLinks(r.links);
      result.sources.push({ kind: 'sub', input: url, usedUa: uaLabel(r.usedUa), nodes: d.ok.map((x) => ({ raw: x.raw, ...summarize(x.node) })), errors: d.errors, userinfo: r.userinfo });
    } catch (e) {
      result.sources.push({ kind: 'sub', input: url, nodes: [], errors: [{ raw: url, error: e.message }] });
    }
  }
  return result;
}

async function refreshSource(src) {
  if (src.kind !== 'sub') return src;
  try {
    const r = await fetchSubscription(src.input, src.userAgent || 'auto');
    src.links = r.links;
    src.userinfo = r.userinfo;
    src.usedUa = r.usedUa;
    src.error = undefined;
    await syncHosts(src);
  } catch (e) {
    src.error = e.message; // старые ключи остаются в кэше
  }
  src.updatedAt = new Date().toISOString();
  return src;
}

function defaultTitle(src) {
  if (src.title) return src.title;
  if (src.kind === 'sub') { try { return new URL(src.input).hostname; } catch { return 'sub'; } }
  const d = decodeLinks(src.links.slice(0, 1)).ok[0];
  return d ? (d.node.name || d.node.server) : 'keys';
}

// scope: 'new' — создать свой сквад, 'all' — всем, иначе uuid существующего сквада
async function applyScope(src, scope) {
  if (scope === 'all') { src.scope = 'all'; src.squadUuid = undefined; src.squadName = undefined; return; }
  if (scope === 'new' || !scope) {
    const sq = await rw.createSquad(defaultTitle(src), stub() && src.hostMode ? [stub().uuid] : []);
    Object.assign(src, { scope: 'squad', squadUuid: sq.uuid, squadName: sq.name, squadCreated: true });
    return;
  }
  const sq = (await rw.listSquads()).find((s) => s.uuid === scope);
  if (!sq) throw new Error('Сквад не найден');
  Object.assign(src, { scope: 'squad', squadUuid: sq.uuid, squadName: sq.name, squadCreated: false });
  if (stub() && src.hostMode) await rw.ensureSquadInbound(sq.uuid, stub().uuid);
}

async function add(text, { title, userAgent = 'auto', scope = 'new', tag } = {}) {
  const { subs, links } = splitInput(text);
  const created = [];
  const now = new Date().toISOString();
  if (links.length) {
    const d = decodeLinks(links);
    if (d.ok.length) created.push({ id: crypto.randomUUID(), kind: 'links', title: title || '', input: '', links: d.ok.map((x) => x.raw), enabled: true, createdAt: now, updatedAt: now });
  }
  for (const url of subs) {
    if (state.sources.some((s) => s.kind === 'sub' && s.input === url)) continue;
    const src = { id: crypto.randomUUID(), kind: 'sub', title: subs.length > 1 ? '' : (title || ''), input: url, links: [], userAgent, enabled: true, createdAt: now };
    await refreshSource(src);
    created.push(src);
  }
  await ensureStub();
  for (const src of created) {
    src.hostMode = !!(stub() && rw.enabled());
    src.hostTag = rw.hostTag(tag || src.title || title || defaultTitle(src));
    try { await applyScope(src, scope); } catch (e) { src.scope = 'squad'; src.squadError = e.message; src.enabled = false; }
    await syncHosts(src);
  }
  state.sources.push(...created);
  save();
  return created;
}

function list() { return state.sources; }
function settings() { return state.settings; }

async function update(id, patch) {
  const s = state.sources.find((x) => x.id === id);
  if (!s) return null;
  if (typeof patch.enabled === 'boolean' && patch.enabled !== s.enabled) {
    s.enabled = patch.enabled;
    if (s.hostMode && s.hosts) { try { await rw.setHostsEnabled(Object.values(s.hosts).map((h) => h.uuid), s.enabled); } catch (e) { s.hostError = e.message; } }
  }
  if (patch.hostMode === true && !s.hostMode) {
    if (!(await ensureStub())) throw new Error('Нет инбаунда-заглушки: создай профиль Balancer без нод с одним инбаундом');
    s.hostMode = true; s.hostTag = s.hostTag || rw.hostTag(defaultTitle(s));
    if (s.squadUuid) await rw.ensureSquadInbound(s.squadUuid, stub().uuid);
    await syncHosts(s);
  }
  if (typeof patch.hostTag === 'string' && s.hostMode) { s.hostTag = rw.hostTag(patch.hostTag); await updateHostsMeta(s); }
  if (typeof patch.title === 'string') s.title = patch.title.slice(0, 100);
  if (Array.isArray(patch.disabledLinks)) s.disabledLinks = patch.disabledLinks.filter((x) => typeof x === 'string');
  if (typeof patch.scope === 'string') { await applyScope(s, patch.scope); s.squadError = undefined; await updateHostsMeta(s); }
  if (Array.isArray(patch.disabledLinks)) await syncHosts(s);
  if (typeof patch.userAgent === 'string' && s.kind === 'sub') { s.userAgent = patch.userAgent.slice(0, 300) || 'auto'; await refreshSource(s); }
  save();
  return s;
}

async function remove(id, { deleteSquad } = {}) {
  const src = state.sources.find((x) => x.id === id);
  if (!src) return false;
  if (deleteSquad && src.squadUuid && src.squadCreated && !state.sources.some((x) => x.id !== id && x.squadUuid === src.squadUuid)) {
    try { await rw.deleteSquad(src.squadUuid); } catch (e) { console.warn('[squad delete]', e.message); }
  }
  if (src.hosts) { try { await rw.deleteHosts(Object.values(src.hosts).map((h) => h.uuid)); } catch (e) { console.warn('[hosts delete]', e.message); } }
  state.sources = state.sources.filter((x) => x.id !== id);
  save();
  return true;
}

async function refresh(id) {
  const targets = id ? state.sources.filter((s) => s.id === id) : state.sources.filter((s) => s.kind === 'sub' && s.enabled);
  await Promise.all(targets.map(refreshSource));
  save();
  return targets;
}

async function setSettings(patch) {
  if (patch.stubInbound !== undefined) {
    if (!patch.stubInbound) state.settings.stubInbound = null;
    else {
      const ib = (await rw.listInbounds()).find((i) => i.uuid === patch.stubInbound);
      if (!ib) throw new Error('Инбаунд не найден');
      state.settings.stubInbound = { uuid: ib.uuid, profileUuid: ib.profileUuid, tag: ib.tag, type: ib.type, profileName: ib.profileName };
    }
  }
  const m = parseInt(patch.refreshMinutes, 10);
  if (m >= 1 && m <= 1440) state.settings.refreshMinutes = m;
  save();
  schedule();
  return state.settings;
}

// Ключи, которые надо дописать юзеру с данными сквадами (null = API недоступен → только «всем»)
const cache = new Map();
function extraFor(squadUuids) {
  const set = new Set(squadUuids || []);
  const raws = [];
  for (const s of state.sources) {
    if (!s.enabled || s.hostMode) continue;
    if (s.scope !== 'all' && !(s.squadUuid && set.has(s.squadUuid))) continue;
    const off = new Set(s.disabledLinks || []);
    for (const l of s.links || []) if (!off.has(l)) raws.push(l);
  }
  const uniq = [...new Set(raws)];
  const key = uniq.join('\n');
  let hit = cache.get(key);
  if (!hit) {
    hit = decodeLinks(uniq).ok;
    if (cache.size > 200) cache.clear();
    cache.set(key, hit);
  }
  return hit;
}
function hasAnySources() { return state.sources.some((s) => s.enabled && !s.hostMode && (s.links || []).length); }
function totalActive() { return extraFor(state.sources.map((s) => s.squadUuid).filter(Boolean)).length; }

let timer = null;
function schedule() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => { refresh().catch((e) => console.error('[refresh]', e.message)); }, state.settings.refreshMinutes * 60 * 1000);
  timer.unref();
}

function init() {
  load();
  schedule();
  migrate().catch((e) => console.warn('[migrate]', e.message)).finally(() => refresh().catch(() => {}));
}

module.exports = { resolveMarker, syncHosts, init, preview, add, list, update, remove, refresh, settings, setSettings, extraFor, hasAnySources, totalActive, decodeLinks, UA_PRESETS, uaLabel };
