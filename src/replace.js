'use strict';
// Хосты-заглушки в Remnawave: адрес вида "<server>.le-<id>". Remnawave сам решает, кому их выдать
// (сквады, вкл/выкл, порядок, название), а мы подменяем каждую заглушку на настоящий ключ.
const YAML = require('yaml');
const { b64decode, looksLikeBase64, parseLink } = require('./parse');
const { toMihomo, toSingbox, toXrayOutbound } = require('./convert');

const MARK_RE = /\.le-([a-f0-9]{8})$/i;
const markerId = (server) => { const m = String(server || '').match(MARK_RE); return m ? m[1].toLowerCase() : null; };
const markerAddress = (server, id) => `${server}.le-${id}`;

function renameRaw(raw, name) {
  if (!name) return raw;
  if (raw.startsWith('vmess://')) {
    try { const j = JSON.parse(b64decode(raw.slice(8).split('#')[0])); j.ps = name; return `vmess://${Buffer.from(JSON.stringify(j)).toString('base64')}`; } catch { return raw; }
  }
  return `${raw.split('#')[0]}#${encodeURIComponent(name)}`;
}

function replacePlainLines(text, resolve, stat) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    let node; try { node = parseLink(l); } catch { out.push(line); continue; }
    const id = markerId(node.server);
    if (!id) { out.push(line); continue; }
    const k = resolve(id);
    if (!k) { stat.dropped++; continue; }
    out.push(renameRaw(k.raw, node.name || k.node.name)); stat.replaced++;
  }
  return out.join('\n');
}

function xrayAddress(ob) {
  const s = ob?.settings || {};
  return s.vnext?.[0]?.address || s.servers?.[0]?.address || s.address;
}

function replaceMarkers(text, contentType, resolve) {
  const stat = { replaced: 0, dropped: 0, format: 'none' };
  const trimmed = (text || '').trim();
  if (!trimmed.includes('.le-') && !looksLikeBase64(trimmed)) return { body: text, ...stat };
  if ((contentType || '').includes('text/html') || /^<!doctype html|^<html/i.test(trimmed)) return { body: text, ...stat };

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let obj; try { obj = JSON.parse(trimmed); } catch { return { body: text, ...stat }; }
    if (Array.isArray(obj)) {
      stat.format = 'xray-json';
      const res = [];
      for (const cfg of obj) {
        const obs = Array.isArray(cfg?.outbounds) ? cfg.outbounds : [];
        const idx = obs.findIndex((o) => markerId(xrayAddress(o)));
        if (idx < 0) { res.push(cfg); continue; }
        const k = resolve(markerId(xrayAddress(obs[idx])));
        const ob = k && toXrayOutbound(k.node, obs[idx].tag || 'proxy');
        if (!ob) { stat.dropped++; continue; }
        obs[idx] = ob; res.push(cfg); stat.replaced++;
      }
      return { body: JSON.stringify(res, null, 2), ...stat };
    }
    if (obj && Array.isArray(obj.outbounds) && obj.outbounds.some((o) => o && o.type)) {
      stat.format = 'sing-box';
      const removed = new Set();
      obj.outbounds = obj.outbounds.map((o) => {
        const id = markerId(o?.server);
        if (!id) return o;
        const k = resolve(id);
        const n = k && toSingbox(k.node, o.tag);
        if (!n) { removed.add(o.tag); stat.dropped++; return null; }
        stat.replaced++; return n;
      }).filter(Boolean);
      if (removed.size) for (const o of obj.outbounds) if (Array.isArray(o.outbounds)) o.outbounds = o.outbounds.filter((t) => !removed.has(t));
      return { body: JSON.stringify(obj, null, 2), ...stat };
    }
    return { body: text, ...stat };
  }

  if (/^(proxies|proxy-groups|mixed-port|port|rules|dns|mode):/m.test(trimmed) && !/^[a-z0-9]+:\/\//im.test(trimmed)) {
    let doc; try { doc = YAML.parse(trimmed); } catch { return { body: text, ...stat }; }
    if (!doc || !Array.isArray(doc.proxies)) return { body: text, ...stat };
    stat.format = 'mihomo';
    const removed = new Set();
    doc.proxies = doc.proxies.map((p) => {
      const id = markerId(p?.server);
      if (!id) return p;
      const k = resolve(id);
      const n = k && toMihomo(k.node, p.name);
      if (!n) { removed.add(p.name); stat.dropped++; return null; }
      stat.replaced++; return n;
    }).filter(Boolean);
    if (removed.size) for (const g of doc['proxy-groups'] || []) if (Array.isArray(g.proxies)) g.proxies = g.proxies.filter((n) => !removed.has(n));
    if (!stat.replaced && !stat.dropped) return { body: text, ...stat };
    return { body: YAML.stringify(doc, { lineWidth: 0 }), ...stat };
  }

  if (/^[a-z0-9]+:\/\//im.test(trimmed)) {
    stat.format = 'plain';
    const body = replacePlainLines(trimmed, resolve, stat);
    return { body: stat.replaced || stat.dropped ? body : text, ...stat };
  }

  if (looksLikeBase64(trimmed)) {
    let dec; try { dec = b64decode(trimmed); } catch { return { body: text, ...stat }; }
    if (!dec.includes('.le-')) return { body: text, ...stat };
    stat.format = 'base64';
    const body = replacePlainLines(dec.trim(), resolve, stat);
    return { body: Buffer.from(body, 'utf8').toString('base64'), ...stat };
  }
  return { body: text, ...stat };
}

module.exports = { replaceMarkers, markerId, markerAddress };
