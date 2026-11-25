'use strict';
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const rw = require('./remnawave');
const notify = require('./notify');
const backup = require('./backup');
const { mergeSubscription } = require('./merge');
const { replaceMarkers } = require('./replace');

const PORT = parseInt(process.env.PORT || '3020', 10);
const UPSTREAM = new URL(process.env.UPSTREAM_URL || 'http://remnawave-subscription-page:3010');
const BASE = (process.env.BASE_PATH || '/link-extractor').replace(/\/+$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ONLY_ACTIVE = (process.env.ONLY_ACTIVE_USERS || 'true') !== 'false';
const SUB_PREFIX = (process.env.SUB_PATH_PREFIX || '').replace(/^\/+|\/+$/g, '');
const PANEL_DOMAIN = (process.env.PANEL_DOMAIN || '').toLowerCase();
const PANEL_UPSTREAM = new URL(process.env.PANEL_UPSTREAM_URL || 'http://remnawave:3000');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SECRET = crypto.createHash('sha256').update(`le:${ADMIN_PASSWORD}`).digest();

if (!ADMIN_PASSWORD) console.warn('[link-extractor] ВНИМАНИЕ: ADMIN_PASSWORD не задан, админка отключена');

// ---------- авторизация ----------
function sign(exp) { return crypto.createHmac('sha256', SECRET).update(String(exp)).digest('hex'); }
function makeToken() { const exp = Date.now() + 7 * 24 * 3600 * 1000; return `${exp}.${sign(exp)}`; }
function checkToken(tok) {
  if (!tok || !ADMIN_PASSWORD) return false;
  const [exp, sig] = tok.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig); const b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function cookies(req) {
  const out = {};
  for (const p of (req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }
  return out;
}
// Токен для бота: Authorization: Bearer <API_TOKEN> (или ADMIN_PASSWORD, если API_TOKEN не задан)
const API_TOKEN = process.env.API_TOKEN || '';
function bearerOk(req) {
  const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  for (const want of [API_TOKEN, ADMIN_PASSWORD]) {
    if (!want) continue;
    const a = Buffer.from(m[1].trim()); const b = Buffer.from(want);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}
const authed = (req) => checkToken(cookies(req).le_session) || bearerOk(req);

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-store', ...extra });
  res.end(buf);
}
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// ---------- админка ----------
const STATIC = { 'index.html': 'text/html; charset=utf-8', 'inject.js': 'application/javascript; charset=utf-8' };
let loginFails = 0; let loginBlockedUntil = 0;

async function handleAdmin(req, res, pathname) {
  const sub = pathname.slice(BASE.length) || '/';
  if (sub === '/inject.js') {
    const js = fs.readFileSync(path.join(PUBLIC_DIR, 'inject.js'), 'utf8').replace(/__BASE__/g, BASE);
    return send(res, 200, js, STATIC['inject.js'], { 'Cache-Control': 'public, max-age=300' });
  }
  if (sub === '/' || sub === '/index.html') {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8').replace(/__BASE__/g, BASE);
    return send(res, 200, html, STATIC['index.html']);
  }
  if (!sub.startsWith('/api/')) return send(res, 404, { error: 'not found' });
  const route = `${req.method} ${sub.slice(4)}`;
  if (req.method !== 'GET') userCache.clear();
  try {
    if (route === 'POST /login') {
      if (Date.now() < loginBlockedUntil) return send(res, 429, { error: 'Слишком много попыток, подожди минуту' });
      const { password } = await readBody(req);
      const a = Buffer.from(String(password || '')); const b = Buffer.from(ADMIN_PASSWORD);
      if (!ADMIN_PASSWORD || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        if (++loginFails >= 5) { loginBlockedUntil = Date.now() + 60000; loginFails = 0; }
        return send(res, 401, { error: 'Неверный пароль' });
      }
      loginFails = 0;
      return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': `le_session=${makeToken()}; Path=${BASE}; HttpOnly; SameSite=Lax; Max-Age=604800; Secure` });
    }
    if (route === 'POST /logout') return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': `le_session=; Path=${BASE}; Max-Age=0` });
    if (!authed(req)) return send(res, 401, { error: 'unauthorized' });

    if (route === 'GET /state') {
      const sources = store.list().map((s) => {
        const d = store.decodeLinks(s.links || []);
        const off = new Set(s.disabledLinks || []);
        return { ...s, usedUaLabel: s.usedUa ? store.uaLabel(s.usedUa) : undefined, nodes: d.ok.map((x) => ({ raw: x.raw, off: off.has(x.raw), protocol: x.node.protocol, name: x.node.name, server: x.node.server, port: x.node.port, network: x.node.transport?.network, security: x.node.tls?.security })) };
      });
      let squads = []; let squadsError;
      try { squads = rw.enabled() ? await rw.listSquads() : []; } catch (e) { squadsError = e.message; }
      if (!rw.enabled()) squadsError = 'REMNAWAVE_API_TOKEN не задан — сквады недоступны';
      let inbounds = []; try { inbounds = rw.enabled() ? await rw.listInbounds() : []; } catch (e) { squadsError = squadsError || e.message; }
      return send(res, 200, { groups: store.groupsSummary(), telegram: notify.enabled(), sources, squads, inbounds, squadsError, uaPresets: store.UA_PRESETS.map(({ id, label, ua }) => ({ id, label, ua })), settings: store.settings(), activeCount: store.totalActive(), activeCheck: ONLY_ACTIVE && rw.enabled() });
    }
    if (route === 'POST /preview') { const { text, userAgent } = await readBody(req); return send(res, 200, await store.preview(text, userAgent || 'auto')); }
    if (route === 'POST /sources') { const b = await readBody(req); return send(res, 200, { created: await store.add(b.text, { title: b.title, userAgent: b.userAgent || 'auto', scope: b.scope || 'new', tag: b.tag }) }); }
    if (route === 'POST /refresh') { const { id } = await readBody(req); await store.refresh(id); return send(res, 200, { ok: true }); }
    if (route === 'POST /debug') {
      const { target, userAgent } = await readBody(req);
      let p = String(target || '').trim();
      try { if (/^https?:\/\//i.test(p)) p = new URL(p).pathname; } catch { /* keep */ }
      if (!p.startsWith('/')) p = `/${p}`;
      const shortUuid = extractShortUuid(p);
      if (!shortUuid) return send(res, 400, { error: 'Не вижу shortUuid — вставь ссылку подписки юзера' });
      userCache.delete(shortUuid);
      const preset = store.UA_PRESETS.find((x) => x.id === userAgent);
      const ua = preset ? preset.ua : (userAgent || 'Happ/4.13.0/ios/2606221801679');
      const out = { shortUuid, ua, path: p };
      try {
        const u = await rw.getUserByShortUuid(shortUuid);
        out.remnawave = { username: u.username, status: u.status, squads: (u.activeInternalSquads || []).map((x) => x.name) };
      } catch (e) { out.remnawave = { error: e.message }; }
      const r = await fetch(new URL(p, UPSTREAM).toString(), { headers: { 'User-Agent': ua, 'Accept-Encoding': 'identity', 'X-Link-Extractor-Fetch': '1' }, signal: AbortSignal.timeout(10000) }).catch((e) => ({ err: e.message }));
      if (r.err) { out.upstreamError = r.err; return send(res, 200, out); }
      const body = Buffer.from(await r.arrayBuffer());
      out.upstream = { status: r.status, contentType: r.headers.get('content-type'), bytes: body.length, sample: body.toString('utf8').slice(0, 300) };
      if (r.status === 200) {
        const a = await augment(shortUuid, body, r.headers.get('content-type') || '');
        out.result = { groups: a.groups, hostsReplaced: a.hostsReplaced, hostsDropped: a.hostsDropped, format: a.format, added: a.added, extraForUser: a.extraCount, reason: a.reason, squadsMatched: a.user?.squads?.length };
      }
      return send(res, 200, out);
    }
    if (route === 'GET /backups') return send(res, 200, { backups: backup.list() });
    if (route === 'POST /backups') return send(res, 200, await backup.create(store.exportState(), 'manual', { send: (await readBody(req)).sendTelegram !== false }));
    if (route === 'POST /backups/panel-db') { backup.requestPanelDb(); return send(res, 200, { ok: true, note: 'Бэкап БД сделает updater в течение минуты и пришлёт в Telegram' }); }
    const bm = sub.match(/^\/api\/backups\/([A-Za-z0-9._-]+)$/);
    if (bm && req.method === 'GET') {
      const buf = backup.read(bm[1]);
      return send(res, 200, buf, bm[1].endsWith('.gz') ? 'application/gzip' : 'application/json', { 'Content-Disposition': `attachment; filename="${bm[1]}"` });
    }
    if (route === 'POST /restore') {
      const body = await readBody(req, 20 * 1024 * 1024);
      const data = backup.parseRestore(body.backup || body);
      return send(res, 200, await store.restoreState(data));
    }
    if (route === 'GET /info') return send(res, 200, { app: 'link-extractor', panel: process.env.PANEL_NAME || '', apiRemnawave: rw.enabled(), telegram: notify.enabled() });
    if (route === 'POST /notify-test') {
      if (!notify.enabled()) return send(res, 400, { error: 'В .env не заданы TG_BOT_TOKEN и TG_CHAT_ID' });
      return (await notify.send('✅ Тестовое уведомление: бот настроен правильно')) ? send(res, 200, { ok: true }) : send(res, 502, { error: 'Telegram не принял сообщение — проверь токен и chat id (бот должен быть в чате)' });
    }
    if (route === 'POST /settings') { return send(res, 200, await store.setSettings(await readBody(req))); }
    const m = sub.match(/^\/api\/sources\/([0-9a-f-]{36})$/);
    if (m && req.method === 'PATCH') { const s = await store.update(m[1], await readBody(req)); return s ? send(res, 200, s) : send(res, 404, { error: 'not found' }); }
    if (m && req.method === 'DELETE') { const q = new URL(req.url, 'http://x').searchParams; return send(res, (await store.remove(m[1], { deleteSquad: q.get('deleteSquad') === '1' })) ? 200 : 404, { ok: true }); }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('[admin]', e);
    return send(res, 400, { error: e.message });
  }
}

// ---------- юзер Remnawave: статус и сквады ----------
const userCache = new Map();
async function getUserInfo(shortUuid) {
  if (!rw.enabled()) return { active: true, squads: [] }; // без API — только источники «всем»
  const c = userCache.get(shortUuid);
  if (c && c.exp > Date.now()) return c.info;
  let info = { active: false, squads: [] };
  try {
    const u = await rw.getUserByShortUuid(shortUuid);
    info = { active: !ONLY_ACTIVE || u.status === 'ACTIVE', squads: (u.activeInternalSquads || []).map((x) => x.uuid) };
  } catch (e) { console.warn('[user-check]', shortUuid, e.message); }
  userCache.set(shortUuid, { info, exp: Date.now() + 60000 });
  if (userCache.size > 20000) userCache.clear();
  return info;
}

// Дописывает ключи в тело подписки. Возвращает подробности для отладки.
async function augment(shortUuid, bodyIn, ct) {
  let body = bodyIn;
  const res = { body: null, format: 'skip', added: 0, reason: '' };
  try {
    // 1) подмена хостов-заглушек на настоящие ключи (кому выдавать — решил сам Remnawave)
    const text0 = body.toString('utf8');
    let squads = [];
    if (text0.includes('.le-') || /^[A-Za-z0-9+/=\s]+$/.test(text0.slice(0, 200))) {
      const info = await getUserInfo(shortUuid);
      squads = info.squads || [];
    }
    const rep = replaceMarkers(text0, ct, { resolve: store.resolveMarker, expand: (code) => store.expandGroup(code, squads) });
    res.groups = rep.groups;
    res.hostsReplaced = rep.replaced; res.hostsDropped = rep.dropped;
    if (rep.replaced || rep.dropped || rep.groups) { body = Buffer.from(rep.body, 'utf8'); res.body = rep.body; res.format = rep.format; res.added = rep.replaced + rep.groups; }
    // 2) старый режим: дописывание ключей источников без хостов
    if (!store.hasAnySources()) { if (!res.added) res.reason = 'нет включённых источников с ключами'; return res; }
    const info = await getUserInfo(shortUuid);
    res.user = info;
    if (!info.active) { if (!res.added) res.reason = 'юзер не ACTIVE или не найден'; return res; }
    const extra = store.extraFor(info.squads);
    res.extraCount = extra.length;
    if (!extra.length) { if (!res.added) res.reason = 'юзеру не положено ни одного ключа: нет хостов-заглушек в его подписке (проверь, что инбаунд-заглушка есть в его скваде) и нет источников без хостов для его сквадов'; return res; }
    const r = mergeSubscription(body.toString('utf8'), ct, extra);
    res.body = r.body; res.format = r.format; res.added += r.added;
    if (!res.added) res.reason = `формат «${r.format}» не поддержан или ключи не подошли под него`;
  } catch (e) { res.reason = e.message; console.error('[merge]', e.message); }
  return res;
}

function extractShortUuid(pathname) {
  let parts = pathname.split('/').filter(Boolean);
  if (SUB_PREFIX) { if (parts[0] !== SUB_PREFIX) return null; parts = parts.slice(1); }
  if (parts[0] === 'api' && parts[1] === 'sub') parts = parts.slice(2);
  const id = parts[0];
  if (!id || !/^[A-Za-z0-9_-]{6,64}$/.test(id)) return null;
  if (['assets', 'locales', 'favicon.ico', 'img', 'static', 'api'].includes(id)) return null;
  return id;
}

const STATIC_EXT = /\.(js|mjs|css|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|map|json|txt|webmanifest)$/i;

function decompress(buf, enc) {
  enc = (enc || '').toLowerCase();
  if (enc === 'gzip') return zlib.gunzipSync(buf);
  if (enc === 'br') return zlib.brotliDecompressSync(buf);
  if (enc === 'deflate') return zlib.inflateSync(buf);
  return buf;
}

// ---------- HTML панели: вставляем скрипт пункта меню ----------
function proxyPanel(req, res) {
  const headers = { ...req.headers, 'accept-encoding': 'identity' };
  const lib = PANEL_UPSTREAM.protocol === 'https:' ? require('https') : http;
  const upReq = lib.request({
    protocol: PANEL_UPSTREAM.protocol, hostname: PANEL_UPSTREAM.hostname, port: PANEL_UPSTREAM.port || (PANEL_UPSTREAM.protocol === 'https:' ? 443 : 80),
    method: req.method, path: req.url, headers,
  }, (upRes) => {
    const ct = String(upRes.headers['content-type'] || '');
    if (!/text\/html/i.test(ct) || req.method !== 'GET') { res.writeHead(upRes.statusCode, upRes.headers); upRes.pipe(res); return; }
    const chunks = [];
    upRes.on('data', (c) => chunks.push(c));
    upRes.on('error', () => res.destroy());
    upRes.on('end', () => {
      let html = Buffer.concat(chunks).toString('utf8');
      const tag = `<script src="${BASE}/inject.js" defer></script>`;
      if (!html.includes(`${BASE}/inject.js`)) html = html.includes('</head>') ? html.replace('</head>', `${tag}</head>`) : html + tag;
      const out = Buffer.from(html, 'utf8');
      const h = { ...upRes.headers, 'content-length': out.length };
      delete h['content-encoding']; delete h['transfer-encoding']; delete h.etag;
      res.writeHead(upRes.statusCode, h);
      res.end(out);
    });
  });
  upReq.on('error', (e) => { console.error('[panel]', e.message); if (!res.headersSent) send(res, 502, 'Bad gateway', 'text/plain'); else res.destroy(); });
  req.pipe(upReq);
}

// ---------- прокси подписки ----------
function proxy(req, res, pathname) {
  const shortUuid = req.method === 'GET' && !STATIC_EXT.test(pathname) ? extractShortUuid(pathname) : null;
  const headers = { ...req.headers, host: req.headers.host || UPSTREAM.host };
  if (shortUuid) headers['accept-encoding'] = 'gzip, deflate, br';
  const lib = UPSTREAM.protocol === 'https:' ? require('https') : http;
  const upReq = lib.request({
    protocol: UPSTREAM.protocol, hostname: UPSTREAM.hostname, port: UPSTREAM.port || (UPSTREAM.protocol === 'https:' ? 443 : 80),
    method: req.method, path: req.url, headers,
  }, (upRes) => {
    const ct = String(upRes.headers['content-type'] || '');
    const candidate = shortUuid && upRes.statusCode === 200 && !/text\/html|javascript|text\/css|image\//i.test(ct);
    if (!candidate) { res.writeHead(upRes.statusCode, upRes.headers); upRes.pipe(res); return; }
    const chunks = [];
    upRes.on('data', (c) => chunks.push(c));
    upRes.on('error', () => res.destroy());
    upRes.on('end', async () => {
      const outHeaders = { ...upRes.headers };
      let body;
      try { body = decompress(Buffer.concat(chunks), upRes.headers['content-encoding']); } catch {
        res.writeHead(upRes.statusCode, upRes.headers); res.end(Buffer.concat(chunks)); return;
      }
      delete outHeaders['content-encoding'];
      delete outHeaders['content-length'];
      delete outHeaders['transfer-encoding'];
      delete outHeaders.etag;
      let outBody = body;
      if (!req.headers['x-link-extractor-fetch']) {
        const r = await augment(shortUuid, body, ct);
        if (r.added > 0) outBody = Buffer.from(r.body, 'utf8');
        outHeaders['x-link-extractor'] = `${r.format};+${r.added}`;
      }
      outHeaders['content-length'] = outBody.length;
      res.writeHead(upRes.statusCode, outHeaders);
      res.end(outBody);
    });
  });
  upReq.on('error', (e) => { console.error('[upstream]', e.message); if (!res.headersSent) send(res, 502, 'Bad gateway', 'text/plain'); else res.destroy(); });
  req.pipe(upReq);
}

const server = http.createServer((req, res) => {
  const pathname = (req.url || '/').split('?')[0];
  if (pathname === '/__le_health') return send(res, 200, { ok: true });
  if (pathname === BASE || pathname.startsWith(`${BASE}/`)) {
    if (pathname === BASE) { res.writeHead(301, { Location: `${BASE}/` }); return res.end(); }
    return handleAdmin(req, res, pathname);
  }
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].toLowerCase();
  if (PANEL_DOMAIN && host === PANEL_DOMAIN) return proxyPanel(req, res);
  return proxy(req, res, pathname);
});

store.init();
server.listen(PORT, () => console.log(`[link-extractor] :${PORT}, upstream ${UPSTREAM.origin}, admin ${BASE}/, API Remnawave: ${rw.enabled() ? 'вкл' : 'выкл (только источники «всем»)'}`));
