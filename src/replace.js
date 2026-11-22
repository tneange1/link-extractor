'use strict';
// Хосты-заглушки в Remnawave: адрес вида "<что-угодно>.le-<id>". Remnawave сам решает, кому их выдать
// (сквады, вкл/выкл, порядок, название), а мы подменяем каждую заглушку:
//   • ключ  → настоящий ключ;
//   • группа (страна / «все») → автовыбор (url-test / urltest / балансер Xray leastPing) из скрытых ключей.
const YAML = require('yaml');
const { b64decode, looksLikeBase64, parseLink } = require('./parse');
const { toMihomo, toSingbox, toXrayOutbound } = require('./convert');

const MARK_RE = /\.le-([a-f0-9]{8})$/i;
const markerId = (server) => { const m = String(server || '').match(MARK_RE); return m ? m[1].toLowerCase() : null; };
const markerAddress = (server, id) => `${server}.le-${id}`;

const TEST_URL = 'https://www.gstatic.com/generate_204';

function renameRaw(raw, name) {
  if (!name) return raw;
  if (raw.startsWith('vmess://')) {
    try { const j = JSON.parse(b64decode(raw.slice(8).split('#')[0])); j.ps = name; return `vmess://${Buffer.from(JSON.stringify(j)).toString('base64')}`; } catch { return raw; }
  }
  return `${raw.split('#')[0]}#${encodeURIComponent(name)}`;
}

function uniqueIn(base, used) {
  let n = base || 'node'; let i = 2;
  while (used.has(n)) n = `${base} ${i++}`;
  used.add(n);
  return n;
}

// ---------- обычный список ссылок ----------
function replacePlainLines(text, ctx, stat) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    let node; try { node = parseLink(l); } catch { out.push(line); continue; }
    const id = markerId(node.server);
    if (!id) { out.push(line); continue; }
    const r = ctx.resolve(id);
    if (!r) { stat.dropped++; continue; }
    if (r.type === 'key') { out.push(renameRaw(r.raw, node.name || r.node.name)); stat.replaced++; continue; }
    // группа: в простом списке автовыбора нет — отдаём ключи страны по отдельности, «Все» пропускаем
    if (r.code === 'ALL') { stat.dropped++; continue; }
    const members = ctx.expand(r.code);
    if (!members.length) { stat.dropped++; continue; }
    const base = node.name || r.name;
    members.forEach((m, i) => out.push(renameRaw(m.raw, members.length > 1 ? `${base} ${i + 1}` : base)));
    stat.groups++;
  }
  return out.join('\n');
}

// ---------- Xray JSON (Happ, v2rayNG и др.) ----------
function xrayAddress(ob) {
  const s = ob?.settings || {};
  return s.vnext?.[0]?.address || s.servers?.[0]?.address || s.address;
}

function xrayGroup(cfg, idx, members) {
  const orig = cfg.outbounds[idx];
  const tag = orig.tag || 'proxy';
  const obs = members.map((m, i) => toXrayOutbound(m.node, `${tag}-${i + 1}`)).filter(Boolean);
  if (!obs.length) return false;
  if (obs.length === 1) { obs[0].tag = tag; cfg.outbounds[idx] = obs[0]; return true; }
  cfg.outbounds.splice(idx, 1, ...obs);
  const balTag = `${tag}-auto`;
  cfg.routing = cfg.routing || {};
  cfg.routing.balancers = (cfg.routing.balancers || []).filter((b) => b.tag !== balTag);
  cfg.routing.balancers.push({ tag: balTag, selector: [`${tag}-`], strategy: { type: 'leastPing' }, fallbackTag: `${tag}-1` });
  cfg.routing.rules = (cfg.routing.rules || []).map((r) => {
    if (r.outboundTag !== tag) return r;
    const { outboundTag, ...rest } = r;
    return { ...rest, balancerTag: balTag };
  });
  cfg.routing.rules.push({ type: 'field', network: 'tcp,udp', balancerTag: balTag });
  cfg.observatory = { subjectSelector: [`${tag}-`], probeUrl: TEST_URL, probeInterval: '1m', enableConcurrency: true };
  return true;
}

// ---------- главная функция ----------
function replaceMarkers(text, contentType, ctx) {
  const stat = { replaced: 0, dropped: 0, groups: 0, format: 'none' };
  const trimmed = (text || '').trim();
  if (!trimmed.includes('.le-') && !looksLikeBase64(trimmed)) return { body: text, ...stat };
  if ((contentType || '').includes('text/html') || /^<!doctype html|^<html/i.test(trimmed)) return { body: text, ...stat };
  const changed = () => stat.replaced || stat.dropped || stat.groups;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let obj; try { obj = JSON.parse(trimmed); } catch { return { body: text, ...stat }; }

    if (Array.isArray(obj)) {
      stat.format = 'xray-json';
      const res = [];
      for (const cfg of obj) {
        if (!Array.isArray(cfg?.outbounds)) { res.push(cfg); continue; }
        let keep = true;
        for (let i = 0; i < cfg.outbounds.length; i++) {
          const id = markerId(xrayAddress(cfg.outbounds[i]));
          if (!id) continue;
          const r = ctx.resolve(id);
          if (r && r.type === 'key') {
            const ob = toXrayOutbound(r.node, cfg.outbounds[i].tag || 'proxy');
            if (ob) { cfg.outbounds[i] = ob; stat.replaced++; continue; }
          } else if (r && r.type === 'group') {
            const before = cfg.outbounds.length;
            if (xrayGroup(cfg, i, ctx.expand(r.code))) { stat.groups++; i += cfg.outbounds.length - before; continue; }
          }
          keep = false; stat.dropped++; break;
        }
        if (keep) res.push(cfg);
      }
      return { body: changed() ? JSON.stringify(res, null, 2) : text, ...stat };
    }

    if (obj && Array.isArray(obj.outbounds) && obj.outbounds.some((o) => o && o.type)) {
      stat.format = 'sing-box';
      const removed = new Set(); const groupMembers = new Map();
      const tags = new Set(obj.outbounds.map((o) => o.tag));
      const byRaw = new Map(); const extra = [];
      const memberTag = (m) => {
        if (byRaw.has(m.raw)) return byRaw.get(m.raw);
        const t = uniqueIn(m.node.name || m.node.server, tags);
        const o = toSingbox(m.node, t);
        if (!o) { tags.delete(t); return null; }
        extra.push(o); byRaw.set(m.raw, t); return t;
      };
      obj.outbounds = obj.outbounds.map((o) => {
        const id = markerId(o?.server);
        if (!id) return o;
        const r = ctx.resolve(id);
        if (r && r.type === 'key') { const n = toSingbox(r.node, o.tag); if (n) { stat.replaced++; return n; } }
        if (r && r.type === 'group') {
          const mt = ctx.expand(r.code).map(memberTag).filter(Boolean);
          if (mt.length) { stat.groups++; groupMembers.set(o.tag, mt); return { type: 'urltest', tag: o.tag, outbounds: mt, url: TEST_URL, interval: '3m', tolerance: 50 }; }
        }
        removed.add(o.tag); stat.dropped++; return null;
      }).filter(Boolean);
      // ключи групп добавляем перед первым служебным аутбаундом
      const at = obj.outbounds.findIndex((o) => ['direct', 'block', 'dns'].includes(o.type));
      obj.outbounds.splice(at < 0 ? obj.outbounds.length : at, 0, ...extra);
      for (const o of obj.outbounds) {
        if (!Array.isArray(o.outbounds) || groupMembers.has(o.tag)) continue;
        o.outbounds = o.outbounds.filter((t) => !removed.has(t));
        // в urltest вложенные группы не кладём — раскрываем в ключи
        if (o.type === 'urltest') o.outbounds = [...new Set(o.outbounds.flatMap((t) => groupMembers.get(t) || [t]))];
      }
      return { body: changed() ? JSON.stringify(obj, null, 2) : text, ...stat };
    }
    return { body: text, ...stat };
  }

  if (/^(proxies|proxy-groups|mixed-port|port|rules|dns|mode):/m.test(trimmed) && !/^[a-z0-9]+:\/\//im.test(trimmed)) {
    let doc; try { doc = YAML.parse(trimmed); } catch { return { body: text, ...stat }; }
    if (!doc || !Array.isArray(doc.proxies)) return { body: text, ...stat };
    stat.format = 'mihomo';
    const removed = new Set(); const groupMembers = new Map(); const newGroups = [];
    const names = new Set([...doc.proxies.map((p) => p?.name), ...(doc['proxy-groups'] || []).map((g) => g?.name)]);
    const byRaw = new Map(); const extra = [];
    const memberName = (m) => {
      if (byRaw.has(m.raw)) return byRaw.get(m.raw);
      const n = uniqueIn(m.node.name || m.node.server, names);
      const p = toMihomo(m.node, n);
      if (!p) { names.delete(n); return null; }
      extra.push(p); byRaw.set(m.raw, n); return n;
    };
    doc.proxies = doc.proxies.map((p) => {
      const id = markerId(p?.server);
      if (!id) return p;
      const r = ctx.resolve(id);
      if (r && r.type === 'key') { const n = toMihomo(r.node, p.name); if (n) { stat.replaced++; return n; } }
      if (r && r.type === 'group') {
        const mn = ctx.expand(r.code).map(memberName).filter(Boolean);
        if (mn.length) {
          stat.groups++; groupMembers.set(p.name, mn);
          newGroups.push({ name: p.name, type: 'url-test', proxies: mn, url: TEST_URL, interval: 300, tolerance: 50, lazy: true });
          return null;
        }
      }
      removed.add(p.name); stat.dropped++; return null;
    }).filter(Boolean);
    doc.proxies.push(...extra);
    const groups = Array.isArray(doc['proxy-groups']) ? doc['proxy-groups'] : [];
    for (const g of groups) {
      if (!Array.isArray(g.proxies)) continue;
      g.proxies = g.proxies.filter((n) => !removed.has(n));
      if (['url-test', 'fallback', 'load-balance'].includes(g.type)) g.proxies = [...new Set(g.proxies.flatMap((n) => groupMembers.get(n) || [n]))];
    }
    // группы стран — первыми, чтобы их было видно сверху
    doc['proxy-groups'] = [...groups.slice(0, 1), ...newGroups, ...groups.slice(1)];
    if (!groups.length) doc['proxy-groups'] = newGroups;
    if (!changed()) return { body: text, ...stat };
    return { body: YAML.stringify(doc, { lineWidth: 0 }), ...stat };
  }

  if (/^[a-z0-9]+:\/\//im.test(trimmed)) {
    stat.format = 'plain';
    const body = replacePlainLines(trimmed, ctx, stat);
    return { body: changed() ? body : text, ...stat };
  }

  if (looksLikeBase64(trimmed)) {
    let dec; try { dec = b64decode(trimmed); } catch { return { body: text, ...stat }; }
    if (!dec.includes('.le-')) return { body: text, ...stat };
    stat.format = 'base64';
    const body = replacePlainLines(dec.trim(), ctx, stat);
    return { body: Buffer.from(body, 'utf8').toString('base64'), ...stat };
  }
  return { body: text, ...stat };
}

module.exports = { replaceMarkers, markerId, markerAddress };
