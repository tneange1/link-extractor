'use strict';
// Определяет формат ответа подписки Remnawave и дописывает в него дополнительные ключи.
const YAML = require('yaml');
const { b64decode, looksLikeBase64 } = require('./parse');
const { toMihomo, toSingbox, toXrayOutbound } = require('./convert');

const SINGBOX_PROXY_TYPES = new Set(['vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria2', 'hysteria', 'tuic', 'wireguard', 'shadowtls', 'anytls', 'ssh', 'socks', 'http']);
const MIHOMO_GROUP_TYPES = new Set(['select', 'url-test', 'fallback', 'load-balance']);

function uniqueName(base, used) {
  let name = base || 'node';
  let i = 2;
  while (used.has(name)) name = `${base} (${i++})`;
  used.add(name);
  return name;
}

function mergePlain(text, extra) {
  const lines = text.replace(/\s+$/, '');
  const add = extra.map((e) => e.raw).join('\n');
  return lines ? `${lines}\n${add}` : add;
}

function mergeMihomo(text, extra) {
  const doc = YAML.parse(text);
  if (!doc || typeof doc !== 'object') return null;
  doc.proxies = Array.isArray(doc.proxies) ? doc.proxies : [];
  const originalNames = new Set(doc.proxies.map((p) => p && p.name).filter(Boolean));
  const used = new Set(originalNames);
  const added = [];
  for (const e of extra) {
    const p = toMihomo(e.node, uniqueName(e.node.name || e.node.server, used));
    if (p) { doc.proxies.push(p); added.push(p.name); }
  }
  if (!added.length) return { body: text, added: 0 };
  const groups = Array.isArray(doc['proxy-groups']) ? doc['proxy-groups'] : [];
  let attached = false;
  for (const g of groups) {
    if (!g || !MIHOMO_GROUP_TYPES.has(g.type) || !Array.isArray(g.proxies)) continue;
    if (g.proxies.some((n) => originalNames.has(n)) || (originalNames.size === 0 && !g['include-all'])) {
      g.proxies.push(...added); attached = true;
    }
  }
  if (!attached && groups.length === 0) {
    doc['proxy-groups'] = [{ name: 'Proxy', type: 'select', proxies: added }];
  }
  return { body: YAML.stringify(doc, { lineWidth: 0 }), added: added.length };
}

function mergeSingbox(obj, extra) {
  const outbounds = obj.outbounds;
  const proxyTags = new Set(outbounds.filter((o) => SINGBOX_PROXY_TYPES.has(o.type)).map((o) => o.tag));
  const used = new Set(outbounds.map((o) => o.tag));
  const added = [];
  for (const e of extra) {
    const o = toSingbox(e.node, uniqueName(e.node.name || e.node.server, used));
    if (o) added.push(o);
  }
  if (!added.length) return { body: null, added: 0 };
  // Вставляем после последнего прокси-аутбаунда, чтобы порядок выглядел естественно
  let lastProxyIdx = -1;
  outbounds.forEach((o, i) => { if (SINGBOX_PROXY_TYPES.has(o.type)) lastProxyIdx = i; });
  outbounds.splice(lastProxyIdx + 1, 0, ...added);
  const tags = added.map((o) => o.tag);
  for (const o of outbounds) {
    if ((o.type === 'selector' || o.type === 'urltest') && Array.isArray(o.outbounds)) {
      if (o.outbounds.some((t) => proxyTags.has(t)) || proxyTags.size === 0) o.outbounds.push(...tags);
    }
  }
  return { body: JSON.stringify(obj, null, 2), added: added.length };
}

function mergeXrayArray(arr, extra) {
  // Формат Happ / v2rayNG / Streisand: массив полных конфигов Xray, по одному на сервер
  const template = arr.find((c) => c && Array.isArray(c.outbounds) && c.outbounds.some((o) => o.tag === 'proxy'));
  const added = [];
  for (const e of extra) {
    const ob = toXrayOutbound(e.node, 'proxy');
    if (!ob) continue;
    let cfg;
    if (template) {
      cfg = JSON.parse(JSON.stringify(template));
      cfg.outbounds = cfg.outbounds.map((o) => (o.tag === 'proxy' ? ob : o));
    } else {
      cfg = {
        log: { loglevel: 'warning' },
        inbounds: [{ tag: 'socks', port: 10808, listen: '127.0.0.1', protocol: 'socks', settings: { udp: true }, sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'] } }],
        outbounds: [ob, { tag: 'direct', protocol: 'freedom' }, { tag: 'block', protocol: 'blackhole' }],
      };
    }
    cfg.remarks = e.node.name || e.node.server;
    added.push(cfg);
  }
  arr.push(...added);
  return { body: JSON.stringify(arr, null, 2), added: added.length };
}

/**
 * @param {string} text тело ответа подписки
 * @param {string} contentType
 * @param {{raw:string,node:object}[]} extra
 * @returns {{body:string, format:string, added:number}}
 */
function mergeSubscription(text, contentType, extra) {
  if (!extra.length) return { body: text, format: 'none', added: 0 };
  const trimmed = (text || '').trim();
  const ct = (contentType || '').toLowerCase();

  if (ct.includes('text/html') || /^<!doctype html|^<html/i.test(trimmed)) return { body: text, format: 'html', added: 0 };

  // JSON: sing-box или массив Xray
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let obj;
    try { obj = JSON.parse(trimmed); } catch { obj = undefined; }
    if (Array.isArray(obj)) {
      const r = mergeXrayArray(obj, extra);
      return { body: r.body, format: 'xray-json', added: r.added };
    }
    if (obj && Array.isArray(obj.outbounds)) {
      if (obj.outbounds.some((o) => o && o.type)) {
        const r = mergeSingbox(obj, extra);
        return { body: r.body || text, format: 'sing-box', added: r.added };
      }
      // Одиночный Xray-конфиг: превращаем в массив, чтобы добавить сервера
      const r = mergeXrayArray([obj], extra);
      return { body: r.body, format: 'xray-json', added: r.added };
    }
    return { body: text, format: 'unknown-json', added: 0 };
  }

  // YAML Mihomo / Clash
  if (/^(proxies|proxy-groups|mixed-port|port|rules|dns|mode):/m.test(trimmed) && !/^[a-z0-9]+:\/\//im.test(trimmed)) {
    try {
      const r = mergeMihomo(trimmed, extra);
      if (r) return { body: r.body, format: 'mihomo', added: r.added };
    } catch { /* fallthrough */ }
    return { body: text, format: 'unknown-yaml', added: 0 };
  }

  // Список ссылок открытым текстом
  if (/^[a-z0-9]+:\/\//im.test(trimmed)) {
    return { body: mergePlain(trimmed, extra), format: 'plain', added: extra.length };
  }

  // base64
  if (looksLikeBase64(trimmed)) {
    try {
      const dec = b64decode(trimmed);
      if (/^[a-z0-9]+:\/\//im.test(dec.trim()) || dec.trim() === '') {
        const merged = mergePlain(dec.trim(), extra);
        return { body: Buffer.from(merged, 'utf8').toString('base64'), format: 'base64', added: extra.length };
      }
    } catch { /* not base64 */ }
  }

  // Пустая подписка (у юзера нет хостов) — отдаём base64-список наших ключей
  if (trimmed === '') {
    return { body: Buffer.from(mergePlain('', extra), 'utf8').toString('base64'), format: 'base64', added: extra.length };
  }

  return { body: text, format: 'unknown', added: 0 };
}

module.exports = { mergeSubscription };
