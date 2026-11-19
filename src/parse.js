'use strict';
// Разбор ключей vless / vmess / trojan / ss / hysteria2 / tuic в единый объект.

const SUPPORTED = ['vless', 'vmess', 'trojan', 'ss', 'hysteria2', 'hy2', 'tuic', 'hysteria'];

function b64decode(str) {
  let s = String(str).trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

function looksLikeBase64(str) {
  const s = String(str).trim().replace(/\s+/g, '');
  return s.length > 8 && /^[A-Za-z0-9+/=_-]+$/.test(s);
}

function safeDecode(s) {
  if (s == null) return '';
  try { return decodeURIComponent(String(s).replace(/\+/g, '%20')); } catch { return String(s); }
}

function bool(v) {
  return v === '1' || v === 'true' || v === true || v === 1;
}

function splitList(v) {
  if (!v) return undefined;
  const arr = String(v).split(',').map((x) => x.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}

// Разбор "scheme://userinfo@host:port/path?query#name" без капризов WHATWG URL
function genericParse(link) {
  const m = link.match(/^([a-z0-9+.-]+):\/\/([^#]*)(?:#(.*))?$/i);
  if (!m) throw new Error('Неверный формат ссылки');
  const scheme = m[1].toLowerCase();
  let rest = m[2];
  const name = m[3] !== undefined ? safeDecode(m[3]) : '';
  let query = '';
  const qi = rest.indexOf('?');
  if (qi >= 0) { query = rest.slice(qi + 1); rest = rest.slice(0, qi); }
  let path = '';
  const at = rest.lastIndexOf('@');
  let userinfo = '';
  let hostport = rest;
  if (at >= 0) { userinfo = rest.slice(0, at); hostport = rest.slice(at + 1); }
  const si = hostport.indexOf('/');
  if (si >= 0) { path = hostport.slice(si); hostport = hostport.slice(0, si); }
  let host; let port;
  const v6 = hostport.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (v6) { host = v6[1]; port = v6[2]; } else {
    const ci = hostport.lastIndexOf(':');
    if (ci >= 0) { host = hostport.slice(0, ci); port = hostport.slice(ci + 1); } else host = hostport;
  }
  const params = {};
  for (const part of query.split('&')) {
    if (!part) continue;
    const ei = part.indexOf('=');
    const k = safeDecode(ei >= 0 ? part.slice(0, ei) : part);
    const v = ei >= 0 ? safeDecode(part.slice(ei + 1)) : '';
    params[k] = v;
  }
  let ui = userinfo; try { ui = decodeURIComponent(userinfo); } catch { /* keep */ }
  return { scheme, userinfo: ui, host, port: port ? parseInt(port, 10) : undefined, path, params, name };
}

function transportFrom(p) {
  const t = {
    network: (p.type || p.network || 'tcp').toLowerCase(),
    path: p.path || undefined,
    host: p.host || undefined,
    serviceName: p.serviceName || p.servicename || undefined,
    mode: p.mode || undefined,
    headerType: p.headerType || undefined,
    authority: p.authority || undefined,
  };
  if (t.network === 'raw') t.network = 'tcp';
  if (t.network === 'splithttp') t.network = 'xhttp';
  return t;
}

function tlsFrom(p, defaultSecurity) {
  return {
    security: (p.security || defaultSecurity || 'none').toLowerCase(),
    sni: p.sni || p.peer || p.servername || undefined,
    fp: p.fp || undefined,
    alpn: splitList(p.alpn),
    pbk: p.pbk || undefined,
    sid: p.sid || undefined,
    spx: p.spx || undefined,
    insecure: bool(p.allowInsecure) || bool(p.insecure) || bool(p.allow_insecure),
  };
}

function parseLink(raw) {
  const link = String(raw).trim();
  const schemeMatch = link.match(/^([a-z0-9]+):\/\//i);
  if (!schemeMatch) throw new Error('Не ключ: нет схемы');
  const scheme = schemeMatch[1].toLowerCase();
  if (!SUPPORTED.includes(scheme)) throw new Error(`Протокол ${scheme} не поддерживается`);

  if (scheme === 'vmess') {
    const body = link.slice('vmess://'.length).split('#')[0];
    let j;
    try { j = JSON.parse(b64decode(body)); } catch { throw new Error('vmess: не удалось декодировать base64/JSON'); }
    const net = (j.net || 'tcp').toLowerCase();
    return {
      protocol: 'vmess', raw: link, name: j.ps || '', server: j.add, port: parseInt(j.port, 10),
      uuid: j.id, alterId: parseInt(j.aid || 0, 10) || 0, cipher: j.scy || 'auto',
      transport: { network: net === 'raw' ? 'tcp' : net, path: j.path || undefined, host: j.host || undefined, serviceName: net === 'grpc' ? (j.path || undefined) : undefined, headerType: j.type || undefined },
      tls: { security: j.tls === 'tls' ? 'tls' : 'none', sni: j.sni || undefined, fp: j.fp || undefined, alpn: splitList(j.alpn), insecure: bool(j.allowInsecure) },
    };
  }

  const g = genericParse(link);
  if (!g.host || !g.port) throw new Error('Не найден адрес или порт');
  const base = { raw: link, name: g.name, server: g.host, port: g.port };

  if (scheme === 'vless') {
    return { ...base, protocol: 'vless', uuid: g.userinfo, flow: g.params.flow || undefined,
      encryption: g.params.encryption || 'none', transport: transportFrom(g.params), tls: tlsFrom(g.params, 'none') };
  }
  if (scheme === 'trojan') {
    return { ...base, protocol: 'trojan', password: g.userinfo, transport: transportFrom(g.params), tls: tlsFrom(g.params, 'tls') };
  }
  if (scheme === 'ss') {
    let method; let password;
    let userinfo = g.userinfo;
    let server = g.host; let port = g.port;
    if (!userinfo) {
      // legacy: ss://base64(method:pass@host:port)
      const dec = b64decode(link.slice(5).split('#')[0].split('?')[0]);
      const mm = dec.match(/^([^:]+):(.*)@(.+):(\d+)$/);
      if (!mm) throw new Error('ss: неизвестный формат');
      [, method, password, server] = mm; port = parseInt(mm[4], 10);
    } else {
      if (!userinfo.includes(':') && looksLikeBase64(userinfo)) userinfo = b64decode(userinfo);
      const ci = userinfo.indexOf(':');
      method = userinfo.slice(0, ci); password = userinfo.slice(ci + 1);
    }
    return { ...base, server, port, protocol: 'ss', method, password, plugin: g.params.plugin || undefined, transport: { network: 'tcp' }, tls: { security: 'none' } };
  }
  if (scheme === 'hysteria2' || scheme === 'hy2') {
    return { ...base, protocol: 'hysteria2', password: g.userinfo,
      obfs: g.params.obfs || undefined, obfsPassword: g.params['obfs-password'] || undefined,
      ports: g.params.mport || undefined,
      finalmask: (() => { try { return g.params.fm ? JSON.parse(g.params.fm) : undefined; } catch { return undefined; } })(),
      transport: { network: 'udp' },
      tls: { security: 'tls', sni: g.params.sni || undefined, alpn: splitList(g.params.alpn), insecure: bool(g.params.insecure), pinSHA256: g.params.pinSHA256 || undefined } };
  }
  if (scheme === 'tuic') {
    const ci = g.userinfo.indexOf(':');
    return { ...base, protocol: 'tuic', uuid: ci >= 0 ? g.userinfo.slice(0, ci) : g.userinfo, password: ci >= 0 ? g.userinfo.slice(ci + 1) : '',
      congestion: g.params.congestion_control || g.params.congestion || undefined, udpRelayMode: g.params.udp_relay_mode || undefined,
      transport: { network: 'udp' },
      tls: { security: 'tls', sni: g.params.sni || undefined, alpn: splitList(g.params.alpn), insecure: bool(g.params.allow_insecure) || bool(g.params.insecure) } };
  }
  if (scheme === 'hysteria') {
    return { ...base, protocol: 'hysteria', auth: g.params.auth || g.userinfo, up: g.params.upmbps, down: g.params.downmbps,
      obfs: g.params.obfsParam || g.params.obfs || undefined, transport: { network: 'udp' },
      tls: { security: 'tls', sni: g.params.peer || g.params.sni || undefined, alpn: splitList(g.params.alpn), insecure: bool(g.params.insecure) } };
  }
  throw new Error('Неизвестный протокол');
}

// Достаёт все ключи из произвольного текста: строки, base64-подписка, JSON/YAML мусор вокруг.
function extractLinksFromText(text) {
  if (!text) return [];
  let body = String(text).trim();
  const { linksFromConfig } = require('./fromconfig');
  const fromCfg = linksFromConfig(body);
  if (fromCfg && fromCfg.length) return [...new Set(fromCfg)];
  if (!/:\/\//.test(body) && looksLikeBase64(body)) {
    try { const dec = b64decode(body); const c2 = linksFromConfig(dec); if (c2 && c2.length) return [...new Set(c2)]; } catch { /* ignore */ }
  }
  const re = new RegExp(`(?:${SUPPORTED.join('|')})://[^\\s"'<>\`]+`, 'gi');
  let found = body.match(re) || [];
  if (!found.length && looksLikeBase64(body)) {
    try {
      const dec = b64decode(body);
      found = dec.match(re) || [];
    } catch { /* not base64 */ }
  }
  return [...new Set(found.map((s) => s.trim()))];
}

// Заглушки, которые провайдеры отдают «чужим» клиентам: 127.0.0.1, 0.0.0.0, localhost и т.п.
function isStub(node) {
  const h = String(node.server || '').toLowerCase();
  return h === 'localhost' || h === '::1' || h === '0.0.0.0' || /^127\./.test(h) || h === 'example.com' || node.port === 0;
}

function summarize(node) {
  return {
    protocol: node.protocol,
    name: node.name,
    server: node.server,
    port: node.port,
    network: node.transport?.network,
    security: node.tls?.security,
    sni: node.tls?.sni,
    flow: node.flow,
  };
}

module.exports = { parseLink, extractLinksFromText, b64decode, looksLikeBase64, summarize, isStub, SUPPORTED };
