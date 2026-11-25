'use strict';
// Мини-клиент API Remnawave: юзеры по shortUuid и внутренние сквады.
const API_URL = (process.env.REMNAWAVE_API_URL || 'http://remnawave:3000').replace(/\/+$/, '');
let API_TOKEN = process.env.REMNAWAVE_API_TOKEN || '';

const enabled = () => !!API_TOKEN;
// Токен можно задать из бота/страницы — он перекрывает .env
function setToken(t) { if (t) API_TOKEN = t; }
const TOKEN_HINT = 'API-токен Remnawave без нужных прав. Создай новый: панель → Настройки Remnawave → API-токены, и вставь его в экстракторе (Настройки → Токен Remnawave)';

async function call(method, path, body, token = API_TOKEN) {
  if (!token) throw new Error('Не задан API-токен Remnawave (Настройки → Токен Remnawave)');
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Forwarded-For': '127.0.0.1',
      'X-Forwarded-Proto': 'https',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = {}; }
  if (r.status === 401 || r.status === 403) throw new Error(`${TOKEN_HINT} (Remnawave ответил ${r.status})`);
  if (!r.ok) throw new Error(`Remnawave API ${r.status}: ${j.message || text.slice(0, 200)}`);
  return j.response !== undefined ? j.response : j;
}

async function getUserByShortUuid(shortUuid) {
  return call('GET', `/api/users/by-short-uuid/${encodeURIComponent(shortUuid)}`);
}

async function listSquads() {
  const r = await call('GET', '/api/internal-squads');
  return (r.internalSquads || []).map((s) => ({ uuid: s.uuid, name: s.name, members: s.info?.membersCount ?? 0, inbounds: s.info?.inboundsCount ?? 0 }));
}

const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

// Имя сквада: из названия, ЗАГЛАВНЫМИ, только латиница, цифры, _ - и пробел, 2..30 символов (правило Remnawave)
function squadName(raw) {
  let s = String(raw || '').toLowerCase().split('').map((c) => (TRANSLIT[c] !== undefined ? TRANSLIT[c] : c)).join('');
  s = s.replace(/[^a-z0-9_\s-]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 30).trim();
  return s.length >= 2 ? s : 'VPN';
}

async function createSquad(wanted, inbounds = []) {
  const name = await uniqueSquadName(wanted);
  const s = await call('POST', '/api/internal-squads', { name, inbounds });
  return { uuid: s.uuid, name: s.name };
}

async function renameSquad(uuid, name) { return call('PATCH', '/api/internal-squads', { uuid, name }); }

async function uniqueSquadName(wanted, exceptUuid) {
  const existing = new Set((await listSquads()).filter((s) => s.uuid !== exceptUuid).map((s) => s.name.toLowerCase()));
  const base = squadName(wanted);
  let name = base; let i = 2;
  while (existing.has(name.toLowerCase())) { const suf = ` ${i++}`; name = base.slice(0, 30 - suf.length) + suf; }
  return name;
}

async function deleteSquad(uuid) {
  return call('DELETE', `/api/internal-squads/${uuid}`);
}

async function listProfiles() {
  const r = await call('GET', '/api/config-profiles');
  return (r.configProfiles || []).map((p) => ({ uuid: p.uuid, name: p.name, nodes: (p.nodes || []).length, inbounds: p.inbounds || [] }));
}

async function listInbounds() {
  const out = [];
  for (const p of await listProfiles()) {
    for (const i of p.inbounds) out.push({ uuid: i.uuid, profileUuid: p.uuid, profileName: p.name, profileNodes: p.nodes, tag: i.tag, type: i.type, network: i.network, security: i.security, port: i.port });
  }
  return out;
}

// Инбаунд-заглушка: профиль «Balancer» без нод, иначе любой профиль без нод
async function findStubInbound() {
  const all = await listInbounds();
  const free = all.filter((i) => i.profileNodes === 0);
  return free.find((i) => /balancer/i.test(i.profileName)) || free[0] || null;
}

async function getSquad(uuid) { return call('GET', `/api/internal-squads/${uuid}`); }

// Добавляет инбаунд-заглушку в сквад, если его там ещё нет
async function ensureSquadInbound(squadUuid, inboundUuid) {
  const sq = await getSquad(squadUuid);
  const cur = (sq.inbounds || []).map((i) => i.uuid);
  if (cur.includes(inboundUuid)) return false;
  await call('PATCH', '/api/internal-squads', { uuid: squadUuid, inbounds: [...cur, inboundUuid] });
  return true;
}

async function listHosts() { return call('GET', '/api/hosts'); }
async function createHost(body) { return call('POST', '/api/hosts', body); }
async function updateHost(body) { return call('PATCH', '/api/hosts', body); }
async function deleteHosts(uuids) { if (uuids.length) await call('POST', '/api/hosts/bulk/delete', { uuids }); }
async function setHostsEnabled(uuids, on) { if (uuids.length) await call('POST', `/api/hosts/bulk/${on ? 'enable' : 'disable'}`, { uuids }); }

// Тег хоста: A-Z 0-9 _ :, до 36 символов
function hostTag(raw) {
  let s = String(raw || '').toLowerCase().split('').map((c) => (TRANSLIT[c] !== undefined ? TRANSLIT[c] : c)).join('');
  s = s.toUpperCase().replace(/[^A-Z0-9_:]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 36);
  return s || 'VPN';
}

// Проверка токена: нужны права на сквады, хосты и профили
async function checkToken(token) {
  await call('GET', '/api/internal-squads', undefined, token);
  await call('GET', '/api/hosts', undefined, token);
  await call('GET', '/api/config-profiles', undefined, token);
  return true;
}

module.exports = { setToken, checkToken, listProfiles, findStubInbound, renameSquad, uniqueSquadName, enabled, getUserByShortUuid, listSquads, createSquad, deleteSquad, squadName, listInbounds, ensureSquadInbound, listHosts, createHost, updateHost, deleteHosts, setHostsEnabled, hostTag };
