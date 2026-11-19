'use strict';
// Обратная конвертация: Xray JSON / sing-box JSON / Clash YAML → ссылки vless:// hysteria2:// ...
const YAML = require('yaml');

function q(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    parts.push(`${k}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}
const hostPart = (h) => (String(h).includes(':') ? `[${h}]` : h);
const frag = (name) => (name ? `#${encodeURIComponent(name)}` : '');
const one = (v) => (Array.isArray(v) ? v[0] : v);

// ---------- Xray ----------
function xrayStreamParams(ss = {}) {
  const net = ss.network || 'tcp';
  const p = { type: net === 'raw' ? 'tcp' : net, security: ss.security && ss.security !== 'none' ? ss.security : 'none' };
  const tls = ss.tlsSettings || {};
  const rl = ss.realitySettings || {};
  if (p.security === 'tls') Object.assign(p, { sni: tls.serverName, fp: tls.fingerprint, alpn: tls.alpn, allowInsecure: tls.allowInsecure ? 1 : undefined });
  if (p.security === 'reality') Object.assign(p, { sni: rl.serverName, fp: rl.fingerprint, pbk: rl.publicKey || rl.password, sid: rl.shortId, spx: rl.spiderX });
  const ws = ss.wsSettings; const gr = ss.grpcSettings; const xh = ss.xhttpSettings || ss.splithttpSettings; const hu = ss.httpupgradeSettings; const tcp = ss.tcpSettings || ss.rawSettings;
  if (net === 'ws' && ws) Object.assign(p, { path: ws.path, host: ws.host || ws.headers?.Host });
  if (net === 'grpc' && gr) Object.assign(p, { serviceName: gr.serviceName, authority: gr.authority, mode: gr.multiMode ? 'multi' : undefined });
  if ((net === 'xhttp' || net === 'splithttp') && xh) Object.assign(p, { type: 'xhttp', path: xh.path, host: xh.host, mode: xh.mode });
  if (net === 'httpupgrade' && hu) Object.assign(p, { path: hu.path, host: hu.host });
  if ((net === 'tcp' || net === 'raw') && tcp?.header?.type === 'http') Object.assign(p, { headerType: 'http', path: one(tcp.header.request?.path), host: one(tcp.header.request?.headers?.Host) });
  return p;
}

function xrayOutboundToLink(ob, name) {
  if (!ob || !ob.protocol) return null;
  const s = ob.settings || {};
  const ss = ob.streamSettings || {};
  const srv = s.vnext?.[0] || s.servers?.[0] || s;
  const user = srv.users?.[0] || s;
  const address = srv.address; const port = srv.port;
  if (!address || !port) return null;
  switch (ob.protocol) {
    case 'vless': {
      const p = { encryption: user.encryption || 'none', flow: user.flow, ...xrayStreamParams(ss) };
      return `vless://${user.id}@${hostPart(address)}:${port}${q(p)}${frag(name)}`;
    }
    case 'trojan':
      return `trojan://${encodeURIComponent(srv.password)}@${hostPart(address)}:${port}${q(xrayStreamParams(ss))}${frag(name)}`;
    case 'shadowsocks':
      return `ss://${Buffer.from(`${srv.method}:${srv.password}`).toString('base64')}@${hostPart(address)}:${port}${frag(name)}`;
    case 'vmess': {
      const p = xrayStreamParams(ss);
      const j = { v: '2', ps: name || '', add: address, port: String(port), id: user.id, aid: String(user.alterId || 0), scy: user.security || 'auto',
        net: p.type, type: p.headerType || 'none', host: p.host || '', path: p.type === 'grpc' ? (p.serviceName || '') : (p.path || ''),
        tls: p.security === 'tls' ? 'tls' : '', sni: p.sni || '', fp: p.fp || '', alpn: Array.isArray(p.alpn) ? p.alpn.join(',') : (p.alpn || '') };
      return `vmess://${Buffer.from(JSON.stringify(j)).toString('base64')}`;
    }
    case 'hysteria': {
      if ((s.version || ss.hysteriaSettings?.version) !== 2) return null;
      const tls = ss.tlsSettings || {};
      const p = { sni: tls.serverName, alpn: tls.alpn && tls.alpn.join(',') !== 'h3' ? tls.alpn : undefined, insecure: tls.allowInsecure ? 1 : undefined,
        fm: ss.finalmask ? JSON.stringify(ss.finalmask) : undefined };
      const auth = ss.hysteriaSettings?.auth || s.auth || s.password;
      return `hysteria2://${encodeURIComponent(auth)}@${hostPart(address)}:${port}/${q(p)}${frag(name)}`;
    }
    default:
      return null;
  }
}

const PROXY_PROTOCOLS = new Set(['vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria']);

function fromXrayConfig(cfg) {
  if (!cfg || !Array.isArray(cfg.outbounds)) return [];
  const proxies = cfg.outbounds.filter((o) => o && PROXY_PROTOCOLS.has(o.protocol));
  const main = proxies.find((o) => o.tag === 'proxy') || proxies[0];
  const out = [];
  for (const ob of proxies) {
    const name = ob === main ? (cfg.remarks || ob.tag) : `${cfg.remarks ? `${cfg.remarks} · ` : ''}${ob.tag || ob.protocol}`;
    const l = xrayOutboundToLink(ob, name);
    if (l) out.push(l);
  }
  return main ? out : [];
}

// ---------- sing-box ----------
function sbTls(o, p) {
  const t = o.tls; if (!t?.enabled) return;
  p.security = t.reality?.enabled ? 'reality' : 'tls';
  p.sni = t.server_name; p.fp = t.utls?.fingerprint; p.alpn = t.alpn; if (t.insecure) p.allowInsecure = 1;
  if (t.reality?.enabled) { p.pbk = t.reality.public_key; p.sid = t.reality.short_id; }
}
function sbTransport(o, p) {
  const t = o.transport; if (!t) { p.type = 'tcp'; return; }
  p.type = t.type === 'http' ? 'http' : t.type;
  p.path = t.path; p.host = t.headers?.Host || (Array.isArray(t.host) ? t.host[0] : t.host); p.serviceName = t.service_name;
}
function singboxOutboundToLink(o) {
  const name = o.tag; const h = hostPart(o.server); const port = o.server_port;
  if (!o.server || !port) return null;
  if (o.type === 'vless') { const p = { encryption: 'none', flow: o.flow, security: 'none' }; sbTransport(o, p); sbTls(o, p); return `vless://${o.uuid}@${h}:${port}${q(p)}${frag(name)}`; }
  if (o.type === 'trojan') { const p = {}; sbTransport(o, p); sbTls(o, p); return `trojan://${encodeURIComponent(o.password)}@${h}:${port}${q(p)}${frag(name)}`; }
  if (o.type === 'shadowsocks') return `ss://${Buffer.from(`${o.method}:${o.password}`).toString('base64')}@${h}:${port}${frag(name)}`;
  if (o.type === 'hysteria2') {
    const p = { sni: o.tls?.server_name, insecure: o.tls?.insecure ? 1 : undefined, obfs: o.obfs?.type, 'obfs-password': o.obfs?.password };
    return `hysteria2://${encodeURIComponent(o.password)}@${h}:${port}/${q(p)}${frag(name)}`;
  }
  if (o.type === 'tuic') return `tuic://${o.uuid}:${encodeURIComponent(o.password || '')}@${h}:${port}${q({ sni: o.tls?.server_name, congestion_control: o.congestion_control, alpn: o.tls?.alpn })}${frag(name)}`;
  if (o.type === 'vmess') {
    const p = {}; sbTransport(o, p); sbTls(o, p);
    const j = { v: '2', ps: name, add: o.server, port: String(port), id: o.uuid, aid: String(o.alter_id || 0), scy: o.security || 'auto', net: p.type, type: 'none', host: p.host || '', path: p.type === 'grpc' ? (p.serviceName || '') : (p.path || ''), tls: p.security === 'tls' ? 'tls' : '', sni: p.sni || '' };
    return `vmess://${Buffer.from(JSON.stringify(j)).toString('base64')}`;
  }
  return null;
}

// ---------- Clash / Mihomo ----------
function clashProxyToLink(x) {
  const h = hostPart(x.server); const name = x.name;
  if (!x.server || !x.port) return null;
  const tr = (p) => {
    p.type = x.network || 'tcp';
    if (x.network === 'ws') { p.path = x['ws-opts']?.path; p.host = x['ws-opts']?.headers?.Host; }
    if (x.network === 'grpc') p.serviceName = x['grpc-opts']?.['grpc-service-name'];
    if (x.network === 'xhttp') { p.path = x['xhttp-opts']?.path; p.host = x['xhttp-opts']?.host; p.mode = x['xhttp-opts']?.mode; }
    if (x.tls || x.type === 'trojan') { p.security = x['reality-opts'] ? 'reality' : 'tls'; p.sni = x.servername || x.sni; p.fp = x['client-fingerprint']; p.alpn = x.alpn; if (x['skip-cert-verify']) p.allowInsecure = 1; }
    if (x['reality-opts']) { p.pbk = x['reality-opts']['public-key']; p.sid = x['reality-opts']['short-id']; }
    return p;
  };
  if (x.type === 'vless') return `vless://${x.uuid}@${h}:${x.port}${q(tr({ encryption: 'none', flow: x.flow }))}${frag(name)}`;
  if (x.type === 'trojan') return `trojan://${encodeURIComponent(x.password)}@${h}:${x.port}${q(tr({}))}${frag(name)}`;
  if (x.type === 'ss') return `ss://${Buffer.from(`${x.cipher}:${x.password}`).toString('base64')}@${h}:${x.port}${frag(name)}`;
  if (x.type === 'hysteria2') return `hysteria2://${encodeURIComponent(x.password)}@${h}:${x.port}/${q({ sni: x.sni, insecure: x['skip-cert-verify'] ? 1 : undefined, obfs: x.obfs, 'obfs-password': x['obfs-password'] })}${frag(name)}`;
  if (x.type === 'vmess') {
    const p = tr({});
    const j = { v: '2', ps: name, add: x.server, port: String(x.port), id: x.uuid, aid: String(x.alterId || 0), scy: x.cipher || 'auto', net: p.type, type: 'none', host: p.host || '', path: p.type === 'grpc' ? (p.serviceName || '') : (p.path || ''), tls: x.tls ? 'tls' : '', sni: p.sni || '' };
    return `vmess://${Buffer.from(JSON.stringify(j)).toString('base64')}`;
  }
  return null;
}

// Пытается вытащить ключи из структурированного конфига. Возвращает null, если это не конфиг.
function linksFromConfig(text) {
  const t = String(text || '').trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    let j; try { j = JSON.parse(t); } catch { return null; }
    const arr = Array.isArray(j) ? j : [j];
    const out = [];
    for (const c of arr) {
      if (!c || !Array.isArray(c.outbounds)) continue;
      if (c.outbounds.some((o) => o && o.protocol)) out.push(...fromXrayConfig(c));
      else for (const o of c.outbounds) { const l = o && singboxOutboundToLink(o); if (l) out.push(l); }
    }
    return out;
  }
  if (/^proxies:/m.test(t)) {
    let y; try { y = YAML.parse(t); } catch { return null; }
    return (y?.proxies || []).map(clashProxyToLink).filter(Boolean);
  }
  return null;
}

module.exports = { linksFromConfig, xrayOutboundToLink };
