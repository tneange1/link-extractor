'use strict';
// Конвертация разобранного ключа в форматы Mihomo (Clash), sing-box и Xray JSON.
// Если транспорт/протокол клиентом не поддерживается — возвращаем null и ключ пропускается.

function clean(obj) {
  if (Array.isArray(obj)) return obj.map(clean);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || v === null || v === '') continue;
      const c = clean(v);
      if (c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 0) continue;
      out[k] = c;
    }
    return out;
  }
  return obj;
}

// ---------------- Mihomo / Clash ----------------
function toMihomo(n, name) {
  const t = n.transport || {};
  const s = n.tls || {};
  const p = { name, server: n.server, port: n.port, udp: true };
  const applyTransport = () => {
    if (t.network === 'tcp') {
      if (t.headerType === 'http') return false;
      return true;
    }
    if (t.network === 'ws') { p.network = 'ws'; p['ws-opts'] = { path: t.path || '/', headers: t.host ? { Host: t.host } : undefined }; return true; }
    if (t.network === 'grpc') { p.network = 'grpc'; p['grpc-opts'] = { 'grpc-service-name': t.serviceName || '' }; return true; }
    if (t.network === 'http' || t.network === 'h2') { p.network = 'h2'; p['h2-opts'] = { path: t.path || '/', host: t.host ? [t.host] : undefined }; return true; }
    if (t.network === 'httpupgrade') { p.network = 'ws'; p['ws-opts'] = { path: t.path || '/', headers: t.host ? { Host: t.host } : undefined, 'v2ray-http-upgrade': true }; return true; }
    if (t.network === 'xhttp') { p.network = 'xhttp'; p['xhttp-opts'] = { path: t.path || '/', host: t.host, mode: t.mode }; return true; }
    return false;
  };
  const applyTls = (sniKey) => {
    if (s.security === 'tls' || s.security === 'reality') {
      p.tls = true;
      p[sniKey] = s.sni;
      p['client-fingerprint'] = s.fp;
      p.alpn = s.alpn;
      if (s.insecure) p['skip-cert-verify'] = true;
      if (s.security === 'reality') p['reality-opts'] = { 'public-key': s.pbk, 'short-id': s.sid || '' };
    }
  };
  switch (n.protocol) {
    case 'vless':
      Object.assign(p, { type: 'vless', uuid: n.uuid, flow: n.flow, 'packet-encoding': 'xudp' });
      if (!applyTransport()) return null;
      applyTls('servername');
      if (n.encryption && n.encryption !== 'none') p.encryption = n.encryption;
      break;
    case 'vmess':
      Object.assign(p, { type: 'vmess', uuid: n.uuid, alterId: n.alterId || 0, cipher: n.cipher || 'auto' });
      if (!applyTransport()) return null;
      applyTls('servername');
      break;
    case 'trojan':
      Object.assign(p, { type: 'trojan', password: n.password });
      if (!applyTransport()) return null;
      applyTls('sni');
      delete p.tls;
      break;
    case 'ss':
      if (n.plugin) return null;
      Object.assign(p, { type: 'ss', cipher: n.method, password: n.password });
      break;
    case 'hysteria2':
      Object.assign(p, { type: 'hysteria2', password: n.password, sni: s.sni, alpn: s.alpn, 'skip-cert-verify': s.insecure || undefined,
        obfs: n.obfs, 'obfs-password': n.obfsPassword, ports: n.ports, fingerprint: s.pinSHA256 });
      delete p.udp;
      break;
    case 'tuic':
      Object.assign(p, { type: 'tuic', uuid: n.uuid, password: n.password, sni: s.sni, alpn: s.alpn || ['h3'],
        'skip-cert-verify': s.insecure || undefined, 'congestion-controller': n.congestion, 'udp-relay-mode': n.udpRelayMode });
      break;
    default:
      return null;
  }
  return clean(p);
}

// ---------------- sing-box ----------------
function toSingbox(n, tag) {
  const t = n.transport || {};
  const s = n.tls || {};
  const o = { tag, server: n.server, server_port: n.port };
  const transport = () => {
    if (t.network === 'tcp') return t.headerType === 'http' ? false : undefined;
    if (t.network === 'ws') return { type: 'ws', path: t.path || '/', headers: t.host ? { Host: t.host } : undefined };
    if (t.network === 'grpc') return { type: 'grpc', service_name: t.serviceName || '' };
    if (t.network === 'http' || t.network === 'h2') return { type: 'http', path: t.path, host: t.host ? [t.host] : undefined };
    if (t.network === 'httpupgrade') return { type: 'httpupgrade', path: t.path || '/', host: t.host };
    return false; // xhttp и прочее sing-box не умеет
  };
  const tls = (forceOn) => {
    if (!(forceOn || s.security === 'tls' || s.security === 'reality')) return undefined;
    return {
      enabled: true, server_name: s.sni || n.server, insecure: s.insecure || undefined, alpn: s.alpn,
      utls: s.fp ? { enabled: true, fingerprint: s.fp } : undefined,
      reality: s.security === 'reality' ? { enabled: true, public_key: s.pbk, short_id: s.sid || '' } : undefined,
    };
  };
  switch (n.protocol) {
    case 'vless': {
      const tr = transport(); if (tr === false) return null;
      Object.assign(o, { type: 'vless', uuid: n.uuid, flow: n.flow, packet_encoding: 'xudp', tls: tls(), transport: tr });
      break;
    }
    case 'vmess': {
      const tr = transport(); if (tr === false) return null;
      Object.assign(o, { type: 'vmess', uuid: n.uuid, alter_id: n.alterId || 0, security: n.cipher || 'auto', tls: tls(), transport: tr });
      break;
    }
    case 'trojan': {
      const tr = transport(); if (tr === false) return null;
      Object.assign(o, { type: 'trojan', password: n.password, tls: tls(true), transport: tr });
      break;
    }
    case 'ss':
      if (n.plugin) return null;
      Object.assign(o, { type: 'shadowsocks', method: n.method, password: n.password });
      break;
    case 'hysteria2':
      Object.assign(o, { type: 'hysteria2', password: n.password, tls: tls(true),
        obfs: n.obfs ? { type: n.obfs, password: n.obfsPassword } : undefined });
      if (n.ports) o.server_ports = String(n.ports).split(',').map((x) => x.replace('-', ':'));
      break;
    case 'tuic':
      Object.assign(o, { type: 'tuic', uuid: n.uuid, password: n.password, congestion_control: n.congestion,
        udp_relay_mode: n.udpRelayMode, tls: { ...tls(true), alpn: s.alpn || ['h3'] } });
      break;
    default:
      return null;
  }
  return clean(o);
}

// ---------------- Xray JSON outbound ----------------
function toXrayOutbound(n, tag = 'proxy') {
  const t = n.transport || {};
  const s = n.tls || {};
  const ss = { network: t.network === 'h2' ? 'http' : (t.network || 'tcp'), security: s.security === 'reality' || s.security === 'tls' ? s.security : 'none' };
  if (n.protocol === 'hysteria2') {
    // Xray-core: protocol "hysteria" version 2 (как отдаёт Remnawave для Happ)
    if (n.obfs || n.ports) return null;
    return clean({
      tag, protocol: 'hysteria',
      settings: { address: n.server, port: n.port, version: 2 },
      streamSettings: {
        network: 'hysteria', security: 'tls',
        hysteriaSettings: { auth: n.password, version: 2 },
        tlsSettings: { serverName: s.sni || n.server, alpn: s.alpn || ['h3'], fingerprint: s.fp || 'chrome', allowInsecure: s.insecure || undefined },
        finalmask: n.finalmask,
      },
    });
  }
  if (ss.network === 'udp') return null;
  if (ss.network === 'tcp' && t.headerType === 'http') {
    ss.tcpSettings = { header: { type: 'http', request: { path: [t.path || '/'], headers: t.host ? { Host: [t.host] } : undefined } } };
  }
  if (ss.network === 'ws') ss.wsSettings = { path: t.path || '/', host: t.host };
  if (ss.network === 'grpc') ss.grpcSettings = { serviceName: t.serviceName || '', authority: t.authority };
  if (ss.network === 'httpupgrade') ss.httpupgradeSettings = { path: t.path || '/', host: t.host };
  if (ss.network === 'xhttp') ss.xhttpSettings = { path: t.path || '/', host: t.host, mode: t.mode || 'auto' };
  if (ss.network === 'http') ss.httpSettings = { path: t.path || '/', host: t.host ? [t.host] : undefined };
  if (ss.security === 'tls') ss.tlsSettings = { serverName: s.sni, fingerprint: s.fp, alpn: s.alpn, allowInsecure: s.insecure || undefined };
  if (ss.security === 'reality') ss.realitySettings = { serverName: s.sni, fingerprint: s.fp || 'chrome', publicKey: s.pbk, shortId: s.sid || '', spiderX: s.spx || '' };

  let settings;
  switch (n.protocol) {
    case 'vless':
      settings = { vnext: [{ address: n.server, port: n.port, users: [{ id: n.uuid, encryption: n.encryption || 'none', flow: n.flow || '' }] }] };
      break;
    case 'vmess':
      settings = { vnext: [{ address: n.server, port: n.port, users: [{ id: n.uuid, alterId: n.alterId || 0, security: n.cipher || 'auto' }] }] };
      break;
    case 'trojan':
      if (ss.security === 'none') { ss.security = 'tls'; ss.tlsSettings = { serverName: s.sni, fingerprint: s.fp, allowInsecure: s.insecure || undefined }; }
      settings = { servers: [{ address: n.server, port: n.port, password: n.password }] };
      break;
    case 'ss':
      if (n.plugin) return null;
      settings = { servers: [{ address: n.server, port: n.port, method: n.method, password: n.password }] };
      break;
    default:
      return null; // hysteria2/tuic в Xray JSON не поддерживаются
  }
  const out = clean({ tag, protocol: n.protocol === 'ss' ? 'shadowsocks' : n.protocol, settings, streamSettings: ss });
  if (out.settings?.vnext?.[0]?.users?.[0] && n.protocol === 'vless') out.settings.vnext[0].users[0].flow = n.flow || '';
  return out;
}

module.exports = { toMihomo, toSingbox, toXrayOutbound };
