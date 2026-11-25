'use strict';
// Telegram-бот управления Link Extractor: несколько панелей, источники, группы, бэкапы, установка по SSH.
const { TG, esc } = require('./tg');
const panels = require('./panels');
const installer = require('./installer');

const TOKEN = process.env.TG_BOT_TOKEN || '';
const ADMINS = new Set(String(process.env.TG_ADMIN_IDS || process.env.TG_CHAT_ID || '').split(/[,\s]+/).filter(Boolean).map(String));
if (!TOKEN) { console.error('TG_BOT_TOKEN не задан'); process.exit(1); }
if (!ADMINS.size) console.warn('TG_ADMIN_IDS пуст — бот никого не пустит. Впиши свой id в .env');

const tg = new TG(TOKEN);
const sessions = new Map();
const S = (chatId) => { if (!sessions.has(chatId)) sessions.set(chatId, {}); return sessions.get(chatId); };
const btn = (text, data) => ({ text, callback_data: data });
const back = (data = 'm', text = '« Назад') => [btn(text, data)];
const plural = (n, a, b, c) => { const m = n % 10; const h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };
const keysWord = (n) => `${n} ${plural(n, 'ключ', 'ключа', 'ключей')}`;

// ---------- экраны ----------
function mainScreen() {
  const list = panels.list();
  const rows = list.map((p) => [btn(`🖥 ${p.name}`, `p:${p.id}`)]);
  rows.push([btn('➕ Добавить панель', 'np'), btn('🛠 Установить на сервер', 'inst')]);
  rows.push([btn('💾 Бэкап бота', 'bb'), btn('❓ Помощь', 'help')]);
  const text = list.length
    ? `🔗 <b>Link Extractor</b>\n\nПанелей: ${list.length}. Выбери панель для управления.`
    : '🔗 <b>Link Extractor</b>\n\nПанелей пока нет.\n• <b>Установить на сервер</b> — бот сам поставит экстрактор на сервер с Remnawave по SSH.\n• <b>Добавить панель</b> — если экстрактор уже стоит (нужен адрес и API-токен из .env).';
  return { text, kb: rows };
}

async function panelScreen(p) {
  const st = await panels.api(p, 'GET', '/state');
  const subs = st.sources.filter((s) => s.kind === 'sub').length;
  const errs = st.sources.filter((s) => s.error || s.hostError || s.squadError).length;
  const grp = (st.groups || []).filter((g) => g.code !== 'ALL');
  const lines = [
    `🖥 <b>${esc(p.name)}</b>`,
    `<code>${esc(p.url)}</code>`,
    '',
    `📚 Источников: <b>${st.sources.length}</b> (подписок: ${subs})${errs ? ` · ⚠️ с ошибками: ${errs}` : ''}`,
    `🔑 Ключей в работе: <b>${(st.groups || []).find((g) => g.code === 'ALL')?.count ?? st.activeCount}</b>`,
    `🌍 Группы: ${st.settings.groupsEnabled ? `вкл, стран: ${grp.length}` : 'выкл'}`,
    `🧩 Заглушка: ${st.settings.stubInbound ? esc(`${st.settings.stubInbound.profileName || ''} → ${st.settings.stubInbound.tag}`) : '—'}`,
    `🔔 Telegram: ${st.telegram ? 'да' : 'нет'} · проверка ACTIVE: ${st.activeCheck ? 'да' : 'нет'}`,
    `🏷 Версия: ${esc(st.version || '—')}`,
  ];
  if (st.squadsError) lines.push(`\n⚠️ ${esc(st.squadsError)}`);
  return {
    text: lines.join('\n'),
    kb: [
      [btn('📥 Добавить ключи', 'add'), btn('📚 Источники', 'src')],
      [btn('🌍 Группы', 'grp'), btn('🔎 Проверить подписку', 'chk')],
      [btn('💾 Бэкапы', 'bk'), btn('⚙️ Настройки', 'set')],
      [btn('🔄 Обновить все подписки', 'refresh')],
      [btn('⬆️ Обновить экстрактор', 'upd'), btn('⬆️ Обновить Remnawave', 'updrw')],
      [btn('✏️ Переименовать', 'pren'), btn('🗑 Убрать из бота', 'pdel')],
      back('m', '« Все панели'),
    ],
  };
}

async function sourcesScreen(p, s) {
  const st = await panels.api(p, 'GET', '/state');
  s.sourceIds = st.sources.map((x) => x.id);
  const rows = st.sources.map((x, i) => [btn(`${x.enabled ? '✅' : '⛔'}${x.error || x.hostError ? '⚠️' : ''} ${(x.title || x.squadName || (x.kind === 'sub' ? 'Подписка' : 'Ключи')).slice(0, 30)} · ${x.nodes.length}`, `s:${i}`)]);
  rows.push([btn('📥 Добавить ключи', 'add')]);
  rows.push(back(`p:${p.id}`));
  return { text: st.sources.length ? `📚 <b>Источники</b> · ${esc(p.name)}` : '📚 Источников пока нет.', kb: rows };
}

async function getSource(p, s) {
  const st = await panels.api(p, 'GET', '/state');
  const src = st.sources.find((x) => x.id === s.source);
  if (!src) throw new Error('Источник не найден (его удалили?)');
  return { st, src };
}

async function sourceScreen(p, s) {
  const { src } = await getSource(p, s);
  const on = src.nodes.filter((n) => !n.off).length;
  const lines = [
    `${src.enabled ? '✅' : '⛔'} <b>${esc(src.title || src.squadName || 'Источник')}</b>`,
    src.kind === 'sub' ? `🔗 <code>${esc(src.input)}</code>` : '🔑 Ключи вставлены вручную',
    `👥 ${src.scope === 'all' ? 'Всем пользователям' : `Сквад: <b>${esc(src.squadName || '—')}</b>`}`,
    src.hostMode ? `🏷 Тег хостов: <b>${esc(src.hostTag || '')}</b> · хостов: ${Object.keys(src.hosts || {}).length}` : '',
    src.kind === 'sub' ? `🕵️ User-Agent: ${esc(src.userAgent === 'auto' || !src.userAgent ? 'Авто' : src.userAgent)}${src.usedUaLabel ? ` (сработал: ${esc(src.usedUaLabel)})` : ''}` : '',
    `🔑 Ключей: ${on} из ${src.nodes.length}`,
    src.updatedAt ? `🕒 Обновлено: ${new Date(src.updatedAt).toLocaleString('ru-RU', { timeZone: process.env.TZ || 'Europe/Moscow' })}` : '',
    src.error ? `\n⚠️ Ошибка обновления: ${esc(src.error)}` : '',
    src.hostError ? `⚠️ Хосты: ${esc(src.hostError)}` : '',
    src.squadError ? `⚠️ Сквад: ${esc(src.squadError)}` : '',
  ].filter(Boolean);
  return {
    text: lines.join('\n'),
    kb: [
      [btn(src.enabled ? '⛔ Выключить' : '✅ Включить', 'st:toggle'), btn('🔑 Ключи', 'st:keys')],
      src.kind === 'sub' ? [btn('🔄 Обновить', 'st:refresh'), btn('🕵️ User-Agent', 'st:ua')] : [],
      [btn('👥 Кому выдавать', 'st:squad'), btn('🗑 Удалить', 'st:del')],
      back('src'),
    ].filter((r) => r.length),
  };
}

async function keysScreen(p, s) {
  const { src } = await getSource(p, s);
  s.keyRaws = src.nodes.map((n) => n.raw);
  const rows = src.nodes.slice(0, 60).map((n, i) => [btn(`${n.off ? '⛔' : '✅'} ${(n.name || n.server).slice(0, 40)} · ${n.protocol}`, `k:${i}`)]);
  rows.push(back('st:back'));
  return { text: `🔑 <b>Ключи</b> · нажми, чтобы включить/выключить${src.nodes.length > 60 ? `\n(показаны первые 60 из ${src.nodes.length})` : ''}`, kb: rows };
}

function squadPicker(st, s, purpose) {
  s.pick = purpose;
  s.squadChoices = ['new', 'all', ...st.squads.map((q) => q.uuid)];
  const rows = [];
  if (purpose === 'add') rows.push([btn('🆕 Создать сквад из названия', 'sq:0')]);
  rows.push(...st.squads.map((q, i) => [btn(`👥 ${q.name} (${q.members})`, `sq:${i + 2}`)]));
  rows.push([btn('🌐 Всем пользователям', 'sq:1')]);
  rows.push(back(purpose === 'add' ? 'x' : 'st:back', purpose === 'add' ? '✖️ Отмена' : '« Назад'));
  return { text: '👥 <b>Кому выдавать ключи?</b>\nНовый сквад создаётся с инбаундом-заглушкой — потом добавь в него юзеров в панели.', kb: rows };
}

function uaPicker(st, s, purpose) {
  s.pickUa = purpose;
  s.uaChoices = ['auto', ...st.uaPresets.map((u) => u.id), 'custom'];
  const rows = [[btn('🤖 Авто (перебор)', 'ua:0')]];
  st.uaPresets.forEach((u, i) => rows.push([btn(u.label, `ua:${i + 1}`)]));
  if (purpose === 'source') rows.push([btn('✏️ Свой…', `ua:${s.uaChoices.length - 1}`)]);
  rows.push(back(purpose === 'source' ? 'st:back' : 'x', purpose === 'source' ? '« Назад' : '✖️ Отмена'));
  return { text: purpose === 'check' ? '📱 <b>Как какой клиент проверить?</b>' : '🕵️ <b>User-Agent для загрузки подписки</b>', kb: rows };
}

async function groupsScreen(p) {
  const st = await panels.api(p, 'GET', '/state');
  const g = st.groups || [];
  const lines = [`🌍 <b>Группы стран</b> · ${st.settings.groupsEnabled ? 'включены' : 'выключены'}`, ''];
  if (st.settings.groupsEnabled) {
    lines.push('Одна точка входа на страну с автовыбором по пингу + общий автовыбор. Ключи — скрытые хосты.', '');
    for (const x of g) lines.push(`${x.code === 'ALL' ? '' : '• '}${esc(x.name)} — ${keysWord(x.count)}${x.inPanel ? '' : ' ⏳'}`);
    if (!g.length) lines.push('Групп пока нет.');
  } else lines.push('Каждый ключ — отдельный видимый хост.');
  return {
    text: lines.join('\n'),
    kb: [[btn(st.settings.groupsEnabled ? '⛔ Выключить группы' : '✅ Включить группы', 'grp:toggle')], [btn('✏️ Название «все страны»', 'grp:rename')], back(`p:${p.id}`)],
  };
}

async function backupsScreen(p, s) {
  const r = await panels.api(p, 'GET', '/backups');
  s.backups = r.backups.slice(0, 10).map((b) => b.name);
  const lines = ['💾 <b>Бэкапы</b>', '', 'Автоматически раз в сутки: источники, ключи, связи со сквадами и хостами, настройки — с отправкой сюда.', ''];
  lines.push(r.backups.length ? 'Последние:' : 'Бэкапов пока нет.');
  const rows = [[btn('💾 Сделать бэкап сейчас', 'bk:make')]];
  r.backups.slice(0, 10).forEach((b, i) => rows.push([btn(`💾 ${b.name.replace(/\.json$/, '')} · ${Math.max(1, Math.round(b.size / 1024))} КБ`, `bk:get:${i}`)]));
  rows.push([btn('♻️ Восстановить из файла', 'bk:restore')]);
  rows.push(back(`p:${p.id}`));
  return { text: lines.join('\n'), kb: rows };
}

function notifyLine(st) {
  const n = st.notify || {};
  if (!n.chatId) return '🔔 Уведомления: не настроены';
  const where = Number(n.chatId) > 0 ? `личка <code>${esc(n.chatId)}</code>` : `чат <code>${esc(n.chatId)}</code>`;
  return `🔔 Уведомления: ${where}${n.threadId ? `, топик <code>${esc(n.threadId)}</code>` : ''}${n.custom ? '' : ' (из .env)'}`;
}

async function settingsScreen(p) {
  const st = await panels.api(p, 'GET', '/state');
  return {
    text: ['⚙️ <b>Настройки</b>', '', `🔄 Обновление подписок: каждые <b>${st.settings.refreshMinutes}</b> мин`, `🧩 Инбаунд-заглушка: ${st.settings.stubInbound ? esc(`${st.settings.stubInbound.profileName || ''} → ${st.settings.stubInbound.tag}`) : '—'}`, `🔑 Токен Remnawave: ${st.squadsError ? `⚠️ ${esc(st.squadsError)}` : 'работает'}`, notifyLine(st), `🌐 Домен панели: ${esc(st.settings.panelDomain || '—')}`].join('\n'),
    kb: [[btn('🔄 Интервал обновления', 'set:refresh')], [btn('🧩 Инбаунд-заглушка', 'set:stub')], [btn('🔑 Токен Remnawave', 'set:rwtoken')], [btn('🔔 Куда слать уведомления', 'set:notify')],
      [btn('🌐 Домен панели', 'set:domain'), btn('🔐 Пароль страницы', 'set:pass')],
      [btn(`${st.settings.autoUpdate !== false ? '✅' : '⬜'} Автообновление экстрактора`, 'set:t:autoUpdate')],
      [btn(`${st.settings.remnawaveAutoUpdate ? '✅' : '⬜'} Автообновление Remnawave`, 'set:t:remnawaveAutoUpdate')],
      [btn(`💾 Бэкап каждые ${st.settings.backupHours || 24} ч`, 'set:backupH')], [btn('🔔 Тест уведомления', 'set:test')], back(`p:${p.id}`)],
  };
}

function helpText() {
  return ['❓ <b>Помощь</b>', '',
    '• <b>Установить на сервер</b> — укажи IP, логин и пароль или приватный ключ сервера с Remnawave. Бот поставит экстрактор, настроит Caddy/nginx и добавит панель сюда. Сообщения с паролем/ключом бот сразу удаляет и нигде не хранит.',
    '• <b>Добавить панель</b> — для уже установленного экстрактора: адрес (домен подписки) и <code>API_TOKEN</code> из <code>/opt/link-extractor/.env</code>.',
    '• <b>Добавить ключи</b> — пришли ключи vless/vmess/trojan/ss/hysteria2/tuic или ссылки на подписки, по одной на строку.',
    '• /start — главное меню, /cancel — отменить ввод.'].join('\n');
}

// ---------- отрисовка ----------
async function show(chatId, s, screenPromise) {
  let sc;
  try { sc = await screenPromise; } catch (e) { sc = { text: `⚠️ ${esc(e.message)}`, kb: [back(s.panel ? `p:${s.panel}` : 'm')] }; }
  if (s.msgId) {
    try {
      const r = await tg.edit(chatId, s.msgId, sc.text, sc.kb);
      if (r && r.message_id && r.message_id !== s.msgId) s.msgId = r.message_id;
      return;
    } catch (e) { console.warn('[edit]', e.message); }
  }
  const m = await tg.send(chatId, sc.text, sc.kb);
  s.msgId = m.message_id;
}
async function fresh(chatId, s, screen) { s.msgId = null; return show(chatId, s, screen); }
function ask(chatId, s, step, text, kb) { s.step = step; s.msgId = null; return tg.send(chatId, text, kb || [[btn('✖️ Отмена', 'x')]]).then((m) => { s.msgId = m.message_id; }); }
const panelOf = (s) => { const p = panels.get(s.panel); if (!p) throw new Error('Панель не выбрана'); return p; };

// ---------- нажатия кнопок ----------
async function onCallback(cq) {
  const chatId = cq.message.chat.id;
  const s = S(chatId);
  s.msgId = cq.message.message_id;
  const d = cq.data || '';
  const done = (t, alert) => tg.answer(cq.id, t, alert);
  try {
    if (d === 'm') { s.step = null; s.panel = null; await show(chatId, s, mainScreen()); return done(); }
    if (d === 'help') { await show(chatId, s, { text: helpText(), kb: [back('m')] }); return done(); }
    if (d === 'x') { s.step = null; s.flow = null; await show(chatId, s, s.panel ? panelScreen(panelOf(s)) : mainScreen()); return done('Отменено'); }
    if (d.startsWith('p:')) { s.panel = d.slice(2); s.step = null; await show(chatId, s, panelScreen(panelOf(s))); return done(); }

    // --- панели ---
    if (d === 'np') { s.flow = {}; await ask(chatId, s, 'np_url', '➕ <b>Новая панель</b>\n\nПришли адрес экстрактора — обычно это домен подписки, например <code>sub.example.com</code>.'); return done(); }
    if (d === 'pren') { await ask(chatId, s, 'pren_name', '✏️ Новое название панели:'); return done(); }
    if (d === 'pdel') { await show(chatId, s, { text: `Убрать «${esc(panelOf(s).name)}» из бота?\nНа сервере ничего не удалится.`, kb: [[btn('🗑 Да, убрать', 'pdel:yes')], back(`p:${s.panel}`)] }); return done(); }
    if (d === 'pdel:yes') { panels.remove(s.panel); s.panel = null; await show(chatId, s, mainScreen()); return done('Убрано'); }

    if (d === 'bb') {
      const st = panels.settings();
      await show(chatId, s, { text: ['💾 <b>Бэкап бота</b>', '', 'Один файл: список панелей с токенами, настройки бота и свежие данные каждой панели (источники, ключи, сквады, хосты, настройки).',
        `Автоматически каждые ${st.backupHours} ч — сюда.${st.lastBackupAt ? `\nПоследний: ${new Date(st.lastBackupAt).toLocaleString('ru-RU')}` : ''}`, '', '🔒 В файле токены и пароли — не пересылай его никому.'].join('\n'),
      kb: [[btn('💾 Сделать сейчас', 'bb:make')], [btn('♻️ Восстановить из файла', 'bb:restore')], [btn(`⏱ Интервал: ${st.backupHours} ч`, 'bb:interval')], back('m')] });
      return done();
    }
    if (d === 'bb:make') { done('Собираю бэкап…'); await sendBotBackup(chatId, 'manual'); return fresh(chatId, s, mainScreen()); }
    if (d === 'bb:restore') { await ask(chatId, s, 'bb_restore', '♻️ Пришли файл бэкапа бота (<code>bot-backup-….json</code>).'); return done(); }
    if (d === 'bb:interval') { s.flow = null; await ask(chatId, s, 'bb_interval', '⏱ Как часто делать автобэкап бота (в часах, 1–720)?'); return done(); }
    if (d.startsWith('bb:yes:')) {
      const j = s.flow?.bb; if (!j) return done('Пришли файл заново', true);
      done('Восстанавливаю…');
      panels.importDb(j.db);
      const lines = [`✅ Список панелей восстановлен: ${j.db.panels.length}`];
      if (d === 'bb:yes:all') {
        for (const p2 of panels.list()) {
          const data = j.extractors?.[p2.id];
          if (!data) continue;
          try { const r = await panels.api(p2, 'POST', '/restore', { backup: data }, { timeout: 300000 }); lines.push(`♻️ ${esc(p2.name)}: источников ${r.sources}`); }
          catch (e) { lines.push(`❌ ${esc(p2.name)}: ${esc(e.message)}`); }
        }
      }
      s.flow = null;
      await tg.send(chatId, lines.join('\n'));
      return fresh(chatId, s, mainScreen());
    }

    const needPanel = !['inst'].some((x) => d.startsWith(x)) && !d.startsWith('i:');
    const p = needPanel ? panelOf(s) : null;

    // --- источники ---
    if (d === 'src') { await show(chatId, s, sourcesScreen(p, s)); return done(); }
    if (d.startsWith('s:')) { s.source = s.sourceIds?.[Number(d.slice(2))]; await show(chatId, s, sourceScreen(p, s)); return done(); }
    if (d === 'st:back') { await show(chatId, s, sourceScreen(p, s)); return done(); }
    if (d === 'st:toggle') {
      const { src } = await getSource(p, s);
      await panels.api(p, 'PATCH', `/sources/${s.source}`, { enabled: !src.enabled });
      await show(chatId, s, sourceScreen(p, s)); return done(src.enabled ? 'Выключен' : 'Включён');
    }
    if (d === 'st:refresh') { done('Обновляю…'); await panels.api(p, 'POST', '/refresh', { id: s.source }); return show(chatId, s, sourceScreen(p, s)); }
    if (d === 'st:keys') { await show(chatId, s, keysScreen(p, s)); return done(); }
    if (d.startsWith('k:')) {
      const raw = s.keyRaws?.[Number(d.slice(2))];
      const { src } = await getSource(p, s);
      const off = new Set(src.disabledLinks || []);
      if (off.has(raw)) off.delete(raw); else off.add(raw);
      await panels.api(p, 'PATCH', `/sources/${s.source}`, { disabledLinks: [...off] });
      await show(chatId, s, keysScreen(p, s)); return done();
    }
    if (d === 'st:squad') { const { st } = await getSource(p, s); await show(chatId, s, squadPicker(st, s, 'source')); return done(); }
    if (d === 'st:ua') { const { st } = await getSource(p, s); await show(chatId, s, uaPicker(st, s, 'source')); return done(); }
    if (d === 'st:del') {
      const { src } = await getSource(p, s);
      const kb = [[btn('🗑 Удалить источник', 'st:delkeep')]];
      if (src.squadCreated && src.squadUuid) kb.unshift([btn(`🗑 Удалить + сквад «${src.squadName}»`, 'st:delsq')]);
      kb.push(back('st:back'));
      await show(chatId, s, { text: `Удалить «${esc(src.title || src.squadName || 'источник')}»?\nЕго хосты удалятся из панели.`, kb });
      return done();
    }
    if (d === 'st:delkeep' || d === 'st:delsq') {
      await panels.api(p, 'DELETE', `/sources/${s.source}${d === 'st:delsq' ? '?deleteSquad=1' : ''}`);
      await show(chatId, s, sourcesScreen(p, s)); return done('Удалено');
    }
    if (d.startsWith('sq:')) {
      const scope = s.squadChoices?.[Number(d.slice(3))];
      if (s.pick === 'source') {
        await panels.api(p, 'PATCH', `/sources/${s.source}`, { scope, enabled: true });
        await show(chatId, s, sourceScreen(p, s)); return done('Сохранено');
      }
      s.flow.scope = scope; done();
      return addCommit(chatId, s, p);
    }
    if (d.startsWith('ua:')) {
      const ua = s.uaChoices?.[Number(d.slice(3))];
      if (s.pickUa === 'source') {
        if (ua === 'custom') { await ask(chatId, s, 'src_ua', '✏️ Пришли User-Agent, например <code>Happ/4.13.0/ios/2606221801679</code>'); return done(); }
        done('Перезагружаю подписку…');
        await panels.api(p, 'PATCH', `/sources/${s.source}`, { userAgent: ua });
        return show(chatId, s, sourceScreen(p, s));
      }
      if (s.pickUa === 'add') { s.flow.userAgent = ua; done(); return addPreview(chatId, s, p); }
      if (s.pickUa === 'check') { done('Проверяю…'); return checkRun(chatId, s, p, ua); }
    }

    // --- добавить ключи ---
    if (d === 'add') { s.flow = {}; await ask(chatId, s, 'add_text', '📥 <b>Добавить ключи</b>\n\nПришли ключи (<code>vless://</code>, <code>hysteria2://</code>…) и/или ссылки на подписки — по одной на строку. Можно прислать .txt-файл.'); return done(); }
    if (d === 'add:ua') { const st = await panels.api(p, 'GET', '/state'); await show(chatId, s, uaPicker(st, s, 'add')); return done(); }
    if (d === 'add:skip') { s.flow.title = ''; done(); return addAskScope(chatId, s, p); }

    // --- группы ---
    if (d === 'grp') { await show(chatId, s, groupsScreen(p)); return done(); }
    if (d === 'grp:toggle') {
      const st = await panels.api(p, 'GET', '/state');
      done('Применяю… это может занять до минуты');
      await panels.api(p, 'POST', '/settings', { groupsEnabled: !st.settings.groupsEnabled }, { timeout: 180000 });
      return show(chatId, s, groupsScreen(p));
    }
    if (d === 'grp:rename') { await ask(chatId, s, 'grp_name', '✏️ Название общего автовыбора, например <code>⚡ Авто · все страны</code>:'); return done(); }

    // --- проверка подписки ---
    if (d === 'chk') { s.flow = {}; await ask(chatId, s, 'chk_link', '🔎 Пришли ссылку подписки юзера (или его shortUuid):'); return done(); }

    // --- бэкапы ---
    if (d === 'bk') { await show(chatId, s, backupsScreen(p, s)); return done(); }
    if (d === 'bk:make') {
      done('Делаю бэкап…');
      const b = await panels.api(p, 'POST', '/backups', { sendTelegram: false });
      const f = await panels.api(p, 'GET', `/backups/${encodeURIComponent(b.name)}`, undefined, { raw: true });
      await tg.sendDoc(chatId, b.name, f.buf, `💾 Бэкап экстрактора · <b>${esc(p.name)}</b>`);
      return fresh(chatId, s, backupsScreen(p, s));
    }
    if (d === 'upd') { const r = await panels.api(p, 'POST', '/update'); return done(r.note, true); }
    if (d === 'updrw') { await show(chatId, s, { text: `⬆️ Обновить панель Remnawave на «${esc(p.name)}»?\nБудут скачаны новые образы и панель перезапустится (перерыв ~10–30 секунд).`, kb: [[btn('⬆️ Да, обновить', 'updrw:yes')], back(`p:${p.id}`)] }); return done(); }
    if (d === 'updrw:yes') { const r = await panels.api(p, 'POST', '/update-remnawave'); await show(chatId, s, panelScreen(p)); return done(r.note, true); }
    if (d === 'set:notify') {
      const st = await panels.api(p, 'GET', '/state');
      await show(chatId, s, { text: [`🔔 <b>Уведомления «${esc(p.name)}»</b>`, '', notifyLine(st), '',
        '<b>В группу или топик:</b>', '1. Добавь этого бота в группу (для топиков — включи в группе «Темы»).', '2. В нужном топике отправь команду <code>/bind</code>.', '3. Нажми на панель, которую туда привязать (или «Все панели»).'].join('\n'),
      kb: [[btn('📍 Слать мне в личку', 'set:notify:me')], [btn('↩️ Как в .env', 'set:notify:reset')], [btn('🔔 Тест', 'set:test')], back('set')] });
      return done();
    }
    if (d === 'set:notify:me' || d === 'set:notify:reset') {
      await panels.api(p, 'POST', '/settings', d === 'set:notify:me' ? { notifyChatId: String(chatId), notifyThreadId: '' } : { notifyChatId: '' });
      await show(chatId, s, settingsScreen(p)); return done('Сохранено');
    }
    if (d === 'set:domain') { await ask(chatId, s, 'set_domain', '🌐 Домен панели Remnawave (например <code>panel.example.com</code>). Нужен, чтобы в меню панели появился «Экстрактор ссылок» (Caddy):'); return done(); }
    if (d === 'set:backupH') { await ask(chatId, s, 'set_backupH', '💾 Как часто делать автобэкап (в часах, 1–720)?'); return done(); }
    if (d.startsWith('set:t:')) {
      const k = d.slice(6); const st = await panels.api(p, 'GET', '/state');
      const cur = k === 'autoUpdate' ? st.settings.autoUpdate !== false : !!st.settings[k];
      if (k === 'remnawaveAutoUpdate' && !cur && s.confirmRw !== p.id) { s.confirmRw = p.id; return done('Панель будет сама обновляться и перезапускаться. Нажми ещё раз, чтобы включить', true); }
      s.confirmRw = null;
      await panels.api(p, 'POST', '/settings', { [k]: !cur });
      await show(chatId, s, settingsScreen(p)); return done('Сохранено');
    }
    if (d === 'set:pass') {
      const sec = await panels.api(p, 'GET', '/secrets');
      await show(chatId, s, { text: `🔐 <b>Пароль страницы экстрактора</b>\n\n<tg-spoiler>${esc(sec.adminPassword)}</tg-spoiler>\n\nСтраница: <code>${esc(p.url)}/</code>`, kb: [[btn('🔄 Сменить пароль', 'set:pass:new')], back('set')] });
      return done();
    }
    if (d === 'set:pass:new') { await panels.api(p, 'POST', '/settings', { regeneratePassword: true }); await show(chatId, s, { text: '✅ Пароль сменён.', kb: [[btn('🔐 Показать', 'set:pass')], back('set')] }); return done(); }
    if (d === 'set:rwtoken') { await ask(chatId, s, 'set_rwtoken', '🔑 Пришли API-токен Remnawave.\nГде взять: панель → Настройки Remnawave → API-токены → создать. Сообщение сразу удалю.'); return done(); }
    if (d.startsWith('bk:get:')) {
      const name = s.backups?.[Number(d.slice(7))];
      if (!name) return done('Обнови список');
      done('Отправляю…');
      const f = await panels.api(p, 'GET', `/backups/${encodeURIComponent(name)}`, undefined, { raw: true, timeout: 300000 });
      await tg.sendDoc(chatId, name, f.buf, `${esc(p.name)} · ${esc(name)}`);
      return fresh(chatId, s, backupsScreen(p, s));
    }
    if (d === 'bk:restore') { await ask(chatId, s, 'restore_file', '♻️ Пришли файл бэкапа экстрактора (<code>store-….json</code>).\nТекущие данные перед восстановлением сохранятся отдельным бэкапом.'); return done(); }
    if (d === 'bk:yes') {
      done('Восстанавливаю…');
      const r = await panels.api(p, 'POST', '/restore', { backup: s.flow.restore }, { timeout: 300000 });
      s.flow = null;
      await tg.send(chatId, `✅ Восстановлено: источников ${r.sources}. Хосты и группы в панели синхронизированы.`);
      return fresh(chatId, s, panelScreen(p));
    }

    // --- настройки ---
    if (d === 'set') { await show(chatId, s, settingsScreen(p)); return done(); }
    if (d === 'set:refresh') { await ask(chatId, s, 'set_refresh', '🔄 Как часто обновлять подписки (в минутах, 1–1440)?'); return done(); }
    if (d === 'set:test') { await panels.api(p, 'POST', '/notify-test'); return done('Отправлено', false); }
    if (d === 'set:stub') {
      const st = await panels.api(p, 'GET', '/state');
      s.stubs = st.inbounds.map((i) => i.uuid);
      const rows = st.inbounds.map((i, n) => [btn(`${st.settings.stubInbound?.uuid === i.uuid ? '✅ ' : ''}${i.profileName} → ${i.tag}${i.profileNodes ? ` ⚠️ нод: ${i.profileNodes}` : ''}`, `stub:${n}`)]);
      rows.push(back('set'));
      await show(chatId, s, { text: '🧩 <b>Инбаунд-заглушка</b>\nБери профиль без нод (⚠️ — профиль стоит на нодах).', kb: rows });
      return done();
    }
    if (d.startsWith('stub:')) {
      await panels.api(p, 'POST', '/settings', { stubInbound: s.stubs?.[Number(d.slice(5))] });
      await show(chatId, s, settingsScreen(p)); return done('Сохранено');
    }
    if (d === 'refresh') { done('Обновляю все подписки…'); await panels.api(p, 'POST', '/refresh', {}, { timeout: 180000 }); return show(chatId, s, panelScreen(p)); }

    // --- установка ---
    if (d === 'inst') return installStart(chatId, s).then(() => done());
    if (d.startsWith('i:')) return installCallback(chatId, s, d.slice(2), done);

    return done();
  } catch (e) {
    console.error('[cb]', d, e.message);
    done(e.message.slice(0, 190), true);
  }
}

// ---------- добавление ключей ----------
async function addPreview(chatId, s, p) {
  const m = await tg.send(chatId, '⏳ Расшифровываю…');
  const r = await panels.api(p, 'POST', '/preview', { text: s.flow.text, userAgent: s.flow.userAgent || 'auto' }, { timeout: 180000 });
  const lines = ['🔍 <b>Что нашёл</b>', ''];
  let total = 0;
  for (const src of r.sources) {
    total += src.nodes.length;
    lines.push(`${src.kind === 'sub' ? '🔗' : '🔑'} <code>${esc(src.input.slice(0, 60))}</code> — ${keysWord(src.nodes.length)}${src.usedUa ? ` (UA: ${esc(src.usedUa)})` : ''}`);
    for (const n of src.nodes.slice(0, 12)) lines.push(`   • ${esc(n.name || n.server)} <i>${n.protocol}</i>`);
    if (src.nodes.length > 12) lines.push(`   … ещё ${src.nodes.length - 12}`);
    for (const er of src.errors.slice(0, 3)) lines.push(`   ✖️ ${esc(er.error)}`);
  }
  if (!total) {
    await tg.edit(chatId, m.message_id, `${lines.join('\n')}\nКлючей не найдено. Пришли другие ключи или /cancel.`);
    s.step = 'add_text'; return;
  }
  s.step = 'add_title';
  await tg.edit(chatId, m.message_id, `${lines.join('\n')}\n\n✏️ Пришли <b>название</b> (из него имя сквада и тег хостов) или пропусти.`, [[btn('⏭ Пропустить', 'add:skip')], [btn('🕵️ Другой User-Agent', 'add:ua')], [btn('✖️ Отмена', 'x')]]);
  s.msgId = m.message_id;
}

async function addAskScope(chatId, s, p) {
  s.step = null;
  const st = await panels.api(p, 'GET', '/state');
  await fresh(chatId, s, squadPicker(st, s, 'add'));
}

async function addCommit(chatId, s, p) {
  const m = await tg.send(chatId, '⏳ Добавляю: создаю сквад и хосты…');
  const r = await panels.api(p, 'POST', '/sources', { text: s.flow.text, title: s.flow.title, userAgent: s.flow.userAgent || 'auto', scope: s.flow.scope }, { timeout: 300000 });
  const lines = ['✅ <b>Добавлено</b>', ''];
  for (const c of r.created) {
    lines.push(`• ${esc(c.title || c.squadName || 'источник')}: ${keysWord((c.links || []).length)}${c.squadName ? ` · сквад <b>${esc(c.squadName)}</b>` : c.scope === 'all' ? ' · всем' : ''}`);
    if (c.error) lines.push(`  ⚠️ ${esc(c.error)}`);
    if (c.squadError) lines.push(`  ⚠️ ${esc(c.squadError)}`);
    if (c.hostError) lines.push(`  ⚠️ ${esc(c.hostError)}`);
  }
  if (!r.created.length) lines.push('Ничего нового (такая подписка уже добавлена?).');
  if (r.created.some((c) => c.squadCreated)) lines.push('', '👉 Добавь юзеров в новый сквад: панель → Внутренние сквады.');
  s.flow = null;
  await tg.edit(chatId, m.message_id, lines.join('\n'), [[btn('📚 Источники', 'src'), btn('« К панели', `p:${p.id}`)]]);
}

async function checkRun(chatId, s, p, ua) {
  const r = await panels.api(p, 'POST', '/debug', { target: s.flow.target, userAgent: ua });
  const L = ['🔎 <b>Проверка подписки</b>', ''];
  L.push(r.remnawave.error ? `Юзер: ошибка API — ${esc(r.remnawave.error)}` : `👤 ${esc(r.remnawave.username)} · ${esc(r.remnawave.status)}\n👥 Сквады: ${esc(r.remnawave.squads.join(', ') || '—')}`);
  if (r.upstreamError) L.push(`Remnawave не ответил: ${esc(r.upstreamError)}`);
  if (r.upstream) L.push(`📦 Ответ: HTTP ${r.upstream.status}, ${esc(r.upstream.contentType || '?')}`);
  if (r.result) {
    if (r.result.groups || r.result.hostsReplaced || r.result.hostsDropped) L.push(`🌍 Автовыборов: ${r.result.groups || 0} · ключей подменено: ${r.result.hostsReplaced || 0} · убрано: ${r.result.hostsDropped || 0}`);
    L.push(`Формат: ${esc(r.result.format)} · добавлено: ${r.result.added}`);
    L.push(r.result.added ? '✅ Ключи выдаются' : `❌ Не выдаются: ${esc(r.result.reason || '')}`);
  }
  s.flow = null;
  await fresh(chatId, s, { text: L.join('\n'), kb: [[btn('🔎 Ещё раз', 'chk')], back(`p:${p.id}`)] });
}

// ---------- установка по SSH ----------
async function installStart(chatId, s) {
  if (s.inst?.running) return tg.send(chatId, '⏳ Установка уже идёт.');
  s.inst = { port: 22, user: 'root', autoUpdate: true, proxy: true };
  await ask(chatId, s, 'i_host', '🛠 <b>Установка на сервер с Remnawave</b>\n\nБот подключится по SSH, поставит экстрактор, настроит Caddy/nginx, автообновление и бэкапы экстрактора, и добавит панель сюда.\n\n🔒 Пароль/ключ используется только на время установки: сообщение с ним сразу удаляется, бот его не сохраняет.\n\nПришли <b>IP или домен</b> сервера:', [[btn('✖️ Отмена', 'i:cancel')]]);
}

function installSummary(s) {
  const i = s.inst; const det = i.detect || {};
  const lines = ['🛠 <b>Проверка сервера</b>', '',
    `🖥 <code>${esc(i.user)}@${esc(i.host)}:${i.port}</code>`,
    `🔐 Отпечаток: <code>${esc(i.fingerprint || '?')}</code>`,
    `🐳 Docker: ${det.docker === '1' ? 'есть' : 'нет (поставлю)'}`,
    `🧩 Панель Remnawave: ${det.panel === '1' ? 'найдена' : '❌ не найдена'}`,
    `🌐 Reverse proxy: ${det.proxy === 'caddy' ? 'Caddy' : det.proxy === 'nginx' ? 'nginx' : 'не найден'}`,
    `📨 Домен подписки: ${esc(i.subDomain || det.sub_domain || '—')}`,
    `🔑 API-токен Remnawave: ${i.rwToken ? 'указан' : det.api_token === 'found' ? 'уже есть в .env' : '❌ нужен (панель → Настройки Remnawave → API-токены)'}`,
    det.installed === '1' ? '♻️ Экстрактор уже стоит — обновлю, настройки сохранятся' : '',
    '', '<b>Что сделать:</b>',
    `🏷 Название: <b>${esc(i.name)}</b>`,
  ].filter((x) => x !== '');
  const kb = [
    [btn(`${i.proxy ? '✅' : '⬜'} Настроить ${det.proxy === 'nginx' ? 'nginx' : 'Caddy'} автоматически`, 'i:t:proxy')],
    [btn(`${i.autoUpdate ? '✅' : '⬜'} Автообновление`, 'i:t:autoUpdate')],
    [btn('✏️ Название', 'i:name'), btn('📨 Домен подписки', 'i:sub')],
  ];
  if (det.api_token !== 'found') kb.push([btn(i.rwToken ? '🔑 API-токен ✅' : '🔑 Указать API-токен Remnawave', 'i:rwtoken')]);
  if (det.panel === '1' && (det.api_token === 'found' || i.rwToken)) kb.push([btn('🚀 Установить', 'i:go')]);
  else if (det.panel !== '1') lines.push('', '❌ На этом сервере нет панели Remnawave (контейнеры remnawave и remnawave-subscription-page). Экстрактор ставится на сервер с панелью.');
  kb.push([btn('✖️ Отмена', 'i:cancel')]);
  return { text: lines.join('\n'), kb };
}

function wipeCreds(s) { if (s.inst) { delete s.inst.password; delete s.inst.key; delete s.inst.passphrase; } }
function closeConn(s) { try { s.inst?.conn?.end(); } catch { /* ignore */ } if (s.inst) s.inst.conn = null; }

async function installConnect(chatId, s) {
  const i = s.inst;
  const m = await tg.send(chatId, '🔌 Подключаюсь…');
  try {
    const { conn, fingerprint } = await installer.connect(i);
    i.conn = conn; i.fingerprint = fingerprint;
    await tg.edit(chatId, m.message_id, '🔍 Подключился, проверяю сервер…');
    i.detect = await installer.detect(conn);
    i.name = i.name || i.detect.panel_domain || i.host;
    s.step = null; s.msgId = m.message_id;
    await show(chatId, s, installSummary(s));
  } catch (e) {
    closeConn(s); wipeCreds(s);
    s.step = null;
    await tg.edit(chatId, m.message_id, `❌ ${esc(e.message)}`, [[btn('🔁 Заново', 'inst')], back('m')]);
  }
}

async function installCallback(chatId, s, a, done) {
  const i = s.inst;
  if (a === 'cancel') { closeConn(s); wipeCreds(s); s.inst = null; s.step = null; await show(chatId, s, mainScreen()); return done('Отменено'); }
  if (!i) return done('Начни заново: Установить на сервер', true);
  if (a === 'portok') { await ask(chatId, s, 'i_user', '👤 Пользователь SSH:', [[btn('root', 'i:root')], [btn('✖️ Отмена', 'i:cancel')]]); return done(); }
  if (a === 'root') { i.user = 'root'; await askAuth(chatId, s); return done(); }
  if (a === 'pw') { await ask(chatId, s, 'i_pass', '🔑 Пришли <b>пароль</b> (сообщение сразу удалю):', [[btn('✖️ Отмена', 'i:cancel')]]); return done(); }
  if (a === 'key') { await ask(chatId, s, 'i_key', '🗝 Пришли <b>приватный ключ</b> текстом или файлом (сообщение сразу удалю):', [[btn('✖️ Отмена', 'i:cancel')]]); return done(); }
  if (a.startsWith('t:')) { const k = a.slice(2); i[k] = !i[k]; await show(chatId, s, installSummary(s)); return done(); }
  if (a === 'name') { await ask(chatId, s, 'i_name', '🏷 Название панели:'); return done(); }
  if (a === 'sub') { await ask(chatId, s, 'i_sub', '📨 Домен подписки (например <code>sub.example.com</code>):'); return done(); }
  if (a === 'rwtoken') { await ask(chatId, s, 'i_rwtoken', '🔑 API-токен Remnawave (панель → Настройки Remnawave → API-токены). Сообщение сразу удалю:'); return done(); }
  if (a === 'go') {
    if (i.running) return done('Уже идёт');
    if (!i.conn) return done('Соединение потеряно — начни заново', true);
    i.running = true; done('Устанавливаю…');
    const m = await tg.send(chatId, '🚀 Установка началась…');
    let log = ''; let last = 0;
    const flush = async (force) => {
      if (!force && Date.now() - last < 2500) return;
      last = Date.now();
      const tail = log.replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((l) => l.trim() && !/^LE_(RESULT|DETECT)/.test(l)).slice(-12).join('\n');
      await tg.edit(chatId, m.message_id, `🚀 <b>Установка…</b>\n<pre>${esc(tail.slice(-3000))}</pre>`).catch(() => {});
    };
    try {
      const res = await installer.install(i.conn, {
        name: i.name, autoUpdate: i.autoUpdate, proxy: i.proxy,
        tgToken: TOKEN, tgChat: chatId, rwToken: i.rwToken, subDomain: i.subDomain,
      }, (d) => { log += d; flush(false); });
      await flush(true);
      closeConn(s); wipeCreds(s);
      const url = res.url || (i.subDomain || i.detect.sub_domain ? `https://${i.subDomain || i.detect.sub_domain}/link-extractor` : '');
      if (!url) {
        i.pending = res; i.running = false;
        await ask(chatId, s, 'i_url', '✅ Экстрактор установлен, но reverse proxy не настроен автоматически.\nНастрой его по README и пришли домен подписки, чтобы добавить панель в бота:');
        return null;
      }
      const p = panels.add({ name: res.name || i.name, url, token: res.token });
      let ok = '✅';
      try { await panels.api(p, 'GET', '/info', undefined, { timeout: 20000 }); } catch (e) { ok = `⚠️ панель добавлена, но пока не отвечает (${esc(e.message)}) — проверь DNS/прокси`; }
      s.inst = null; s.panel = p.id;
      await tg.send(chatId, [`🎉 <b>Готово!</b> ${ok}`, '',
        `🖥 ${esc(p.name)}`, `🌐 ${esc(url)}/`,
        `🔧 Прокси: ${res.proxy === 'caddy' ? 'Caddy настроен' : res.proxy === 'nginx' ? 'nginx настроен' : res.proxy === 'already' ? 'уже был настроен' : 'не настроен — см. README'}`,
        '', '🔒 Данные входа на сервер удалены из памяти бота. Рекомендуем сменить пароль root, если присылал его.'].join('\n'),
      [[btn('🖥 Открыть панель', `p:${p.id}`)]]);
    } catch (e) {
      await flush(true);
      closeConn(s); wipeCreds(s); s.inst = null;
      await tg.send(chatId, `❌ Установка не удалась:\n<pre>${esc(e.message.slice(-1500))}</pre>`, [[btn('🔁 Заново', 'inst')], back('m')]);
    }
    return null;
  }
  return done();
}

function askAuth(chatId, s) {
  return ask(chatId, s, null, '🔐 Как входить на сервер?', [[btn('🔑 Пароль', 'i:pw'), btn('🗝 Приватный ключ', 'i:key')], [btn('✖️ Отмена', 'i:cancel')]]);
}

// ---------- сообщения ----------
async function onMessage(msg) {
  const chatId = msg.chat.id;
  const s = S(chatId);
  const text = (msg.text || msg.caption || '').trim();

  if (text === '/start' || text === '/menu') { s.step = null; s.flow = null; return fresh(chatId, s, mainScreen()); }
  if (text === '/cancel') { closeConn(s); wipeCreds(s); s.inst = null; s.step = null; s.flow = null; return fresh(chatId, s, mainScreen()); }
  if (text === '/id') return tg.send(chatId, `Твой id: <code>${msg.from.id}</code>`);

  const step = s.step;
  const secret = ['i_pass', 'i_key', 'i_passphrase', 'i_rwtoken', 'np_token', 'set_rwtoken'].includes(step);
  if (!s.panel && !step?.startsWith('np_') && !step?.startsWith('i_') && !step?.startsWith('bb_') && step) { s.step = null; return fresh(chatId, s, mainScreen()); }
  if (secret) await tg.del(chatId, msg.message_id);
  if (!step) return fresh(chatId, s, mainScreen());

  try {
    // панели
    if (step === 'bb_interval') {
      const n = parseInt(text, 10); if (!(n >= 1 && n <= 720)) return tg.send(chatId, 'Число от 1 до 720.');
      panels.setSetting('backupHours', n); s.step = null; return fresh(chatId, s, mainScreen());
    }
    if (step === 'np_url') { s.flow.url = text; return ask(chatId, s, 'np_token', '🔑 Пришли <b>API_TOKEN</b> из <code>/opt/link-extractor/.env</code> (или ADMIN_PASSWORD). Сообщение сразу удалю.'); }
    if (step === 'np_token') {
      const probe = { id: 'probe', name: 'панель', url: panels.normUrl(s.flow.url), token: text };
      const st = await panels.api(probe, 'GET', '/info', undefined, { timeout: 20000 });
      s.flow.token = text; s.flow.defName = st.panel || new URL(probe.url).hostname;
      return ask(chatId, s, 'np_name', `✅ Подключился.\n🏷 Название панели (или «-», чтобы оставить <b>${esc(s.flow.defName)}</b>):`);
    }
    if (step === 'np_name') {
      const p = panels.add({ name: text === '-' ? s.flow.defName : text, url: s.flow.url, token: s.flow.token });
      s.step = null; s.flow = null; s.panel = p.id;
      return fresh(chatId, s, panelScreen(p));
    }
    if (step === 'pren_name') { panels.rename(s.panel, text); await panels.api(panelOf(s), 'POST', '/settings', { panelName: text }).catch(() => {}); s.step = null; return fresh(chatId, s, panelScreen(panelOf(s))); }

    const p = s.panel ? panels.get(s.panel) : null;
    // ключи
    if (step === 'add_text') {
      let t = text;
      if (msg.document) t = (await tg.download(msg.document.file_id, 2 * 1024 * 1024)).toString('utf8');
      if (!t) return tg.send(chatId, 'Пришли ключи текстом или файлом.');
      s.flow.text = t; s.flow.userAgent = 'auto'; s.step = null;
      return addPreview(chatId, s, p);
    }
    if (step === 'add_title') { s.flow.title = text.slice(0, 60); return addAskScope(chatId, s, p); }
    if (step === 'src_ua') { s.step = null; await panels.api(p, 'PATCH', `/sources/${s.source}`, { userAgent: text }); return fresh(chatId, s, sourceScreen(p, s)); }
    if (step === 'chk_link') {
      s.flow.target = text; s.step = null;
      const st = await panels.api(p, 'GET', '/state');
      return fresh(chatId, s, uaPicker(st, s, 'check'));
    }
    if (step === 'grp_name') { s.step = null; await panels.api(p, 'POST', '/settings', { allGroupName: text }); return fresh(chatId, s, groupsScreen(p)); }
    if (step === 'set_refresh') {
      const n = parseInt(text, 10);
      if (!(n >= 1 && n <= 1440)) return tg.send(chatId, 'Число от 1 до 1440.');
      s.step = null; await panels.api(p, 'POST', '/settings', { refreshMinutes: n }); return fresh(chatId, s, settingsScreen(p));
    }
    if (step === 'set_domain') { s.step = null; await panels.api(p, 'POST', '/settings', { panelDomain: text }); return fresh(chatId, s, settingsScreen(p)); }
    if (step === 'set_backupH') {
      const n = parseInt(text, 10); if (!(n >= 1 && n <= 720)) return tg.send(chatId, 'Число от 1 до 720.');
      s.step = null; await panels.api(p, 'POST', '/settings', { backupHours: n }); return fresh(chatId, s, settingsScreen(p));
    }
    if (step === 'bb_restore') {
      if (!msg.document) return tg.send(chatId, 'Пришли именно файл бэкапа бота (.json).');
      const j = JSON.parse((await tg.download(msg.document.file_id)).toString('utf8'));
      if (j.app !== 'link-extractor-bot' || !j.db) return tg.send(chatId, '❌ Это не бэкап бота. Бэкап одной панели восстанавливается в меню панели → Бэкапы.');
      s.flow = { bb: j }; s.step = null;
      const n = Object.keys(j.extractors || {}).length;
      return fresh(chatId, s, { text: `♻️ Бэкап бота от ${new Date(j.createdAt).toLocaleString('ru-RU')}: панелей ${j.db.panels.length}, с данными экстракторов: ${n}.\nЧто восстановить?`,
        kb: [[btn('📋 Только список панелей и настройки бота', 'bb:yes:db')], [btn('♻️ Всё (+ данные каждой панели)', 'bb:yes:all')], [btn('✖️ Отмена', 'x')]] });
    }
    if (step === 'set_rwtoken') {
      s.step = null;
      await panels.api(p, 'POST', '/settings', { remnawaveToken: text });
      await tg.send(chatId, '✅ Токен подошёл. Синхронизирую сквады, хосты и группы — через минуту всё будет в порядке.');
      return fresh(chatId, s, settingsScreen(p));
    }
    if (step === 'restore_file') {
      if (!msg.document) return tg.send(chatId, 'Пришли именно файл .json.');
      const buf = await tg.download(msg.document.file_id);
      let j; try { j = JSON.parse(buf.toString('utf8')); } catch { return tg.send(chatId, '❌ Это не JSON.'); }
      const data = j.app === 'link-extractor' ? j.data : j;
      if (!data || !Array.isArray(data.sources)) return tg.send(chatId, '❌ Это не бэкап Link Extractor.');
      s.flow = { restore: j }; s.step = null;
      return fresh(chatId, s, { text: `♻️ В бэкапе ${data.sources.length} источников${j.createdAt ? ` от ${new Date(j.createdAt).toLocaleString('ru-RU')}` : ''}${j.panel ? ` (панель ${esc(j.panel)})` : ''}.\nВосстановить в «${esc(p.name)}»? Текущие данные заменятся.`, kb: [[btn('♻️ Восстановить', 'bk:yes')], [btn('✖️ Отмена', 'x')]] });
    }

    // установка
    const i = s.inst;
    if (step.startsWith('i_') && !i) { s.step = null; return tg.send(chatId, 'Установка отменена. /start'); }
    if (step === 'i_host') {
      if (!/^[A-Za-z0-9.:-]+$/.test(text)) return tg.send(chatId, 'Похоже, это не IP/домен. Ещё раз:');
      const [h, port] = text.split(':'); i.host = h; if (port) i.port = Number(port);
      return ask(chatId, s, 'i_port', `🔌 Порт SSH (сейчас ${i.port}):`, [[btn(`${i.port}`, 'i:portok')], [btn('✖️ Отмена', 'i:cancel')]]);
    }
    if (step === 'i_port') { const n = parseInt(text, 10); if (!(n > 0 && n < 65536)) return tg.send(chatId, 'Порт — число 1–65535.'); i.port = n; return ask(chatId, s, 'i_user', '👤 Пользователь SSH:', [[btn('root', 'i:root')], [btn('✖️ Отмена', 'i:cancel')]]); }
    if (step === 'i_user') { i.user = text; return askAuth(chatId, s); }
    if (step === 'i_pass') { i.password = text; s.step = null; return installConnect(chatId, s); }
    if (step === 'i_key') {
      let key = text;
      if (msg.document) key = (await tg.download(msg.document.file_id, 64 * 1024)).toString('utf8');
      const chk = installer.checkKey(key);
      if (chk === 'passphrase') { i.key = key; return ask(chatId, s, 'i_passphrase', '🔒 Ключ зашифрован. Пришли пароль от ключа (сообщение сразу удалю):', [[btn('✖️ Отмена', 'i:cancel')]]); }
      if (chk) return tg.send(chatId, `❌ ${esc(chk)}\nПришли ключ ещё раз (полностью, с BEGIN/END).`);
      i.key = key; s.step = null; return installConnect(chatId, s);
    }
    if (step === 'i_passphrase') {
      const chk = installer.checkKey(i.key, text);
      if (chk) return tg.send(chatId, '❌ Пароль от ключа не подошёл. Ещё раз:');
      i.passphrase = text; s.step = null; return installConnect(chatId, s);
    }
    if (step === 'i_name') { i.name = text.slice(0, 40); s.step = null; return fresh(chatId, s, installSummary(s)); }
    if (step === 'i_sub') { i.subDomain = text.replace(/^https?:\/\//, '').replace(/\/.*$/, ''); s.step = null; return fresh(chatId, s, installSummary(s)); }
    if (step === 'i_rwtoken') { i.rwToken = text; s.step = null; return fresh(chatId, s, installSummary(s)); }
    if (step === 'i_url') {
      const p2 = panels.add({ name: i.pending.name || i.name, url: text, token: i.pending.token });
      s.inst = null; s.step = null; s.panel = p2.id;
      return fresh(chatId, s, panelScreen(p2));
    }
  } catch (e) {
    console.error('[msg]', step, e.message);
    return tg.send(chatId, `⚠️ ${esc(e.message)}`);
  }
  return null;
}

// ---------- бэкап бота: база бота + данные всех панелей одним файлом ----------
async function sendBotBackup(chatId, reason) {
  const out = { app: 'link-extractor-bot', version: 1, createdAt: new Date().toISOString(), reason, db: panels.exportDb(), extractors: {}, errors: {} };
  for (const p of panels.list()) {
    try {
      const b = await panels.api(p, 'POST', '/backups', { sendTelegram: false });
      const f = await panels.api(p, 'GET', `/backups/${encodeURIComponent(b.name)}`, undefined, { raw: true });
      out.extractors[p.id] = JSON.parse(f.buf.toString('utf8'));
    } catch (e) { out.errors[p.id] = e.message; }
  }
  const name = `bot-backup-${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}.json`;
  const ok = Object.keys(out.extractors).length; const bad = Object.keys(out.errors).length;
  await tg.sendDoc(chatId, name, Buffer.from(JSON.stringify(out, null, 2)), `💾 Бэкап бота: панелей ${panels.list().length}${bad ? `, ⚠️ без данных: ${bad}` : ''}\n🔒 Внутри токены — не пересылай.`);
  panels.setSetting('lastBackupAt', out.createdAt);
  return { ok, bad };
}

function scheduleBotBackups() {
  setInterval(async () => {
    const st = panels.settings();
    if (!panels.list().length) return;
    if (st.lastBackupAt && Date.now() - new Date(st.lastBackupAt).getTime() < st.backupHours * 3600 * 1000 - 60000) return;
    const to = [...ADMINS][0];
    try { await sendBotBackup(to, 'auto'); } catch (e) { console.warn('[bot-backup]', e.message); }
  }, 10 * 60 * 1000).unref();
}

// Экстрактор на этом же сервере: берём его токен прямо из его базы (папка смонтирована только для чтения)
function discoverLocal() {
  const file = process.env.EXTRACTOR_DB || '/extractor-data/store.json';
  let token = ''; let name = '';
  try { const j = JSON.parse(require('fs').readFileSync(file, 'utf8')); token = j.secrets?.apiToken || ''; name = j.settings?.panelName || ''; } catch { /* нет рядом экстрактора */ }
  token = token || process.env.API_TOKEN || '';
  if (!token) return;
  const url = 'http://link-extractor:3020/link-extractor';
  const ex = panels.list().find((p) => p.url === url);
  if (!ex) panels.add({ name: name || 'Эта панель', url, token, local: true });
  else if (ex.token !== token) { ex.token = token; panels.save(); }
}

// ---------- привязка уведомлений к группе/топику ----------
async function bindPrompt(m) {
  const list = panels.list();
  const thread = m.is_topic_message ? m.message_thread_id : undefined;
  if (!list.length) return tg.send(m.chat.id, 'В боте пока нет панелей.', null, { message_thread_id: thread });
  const kb = list.map((p) => [btn(`🖥 ${p.name}`, `bind:${p.id}`)]);
  if (list.length > 1) kb.push([btn('🔔 Все панели', 'bind:*')]);
  return tg.send(m.chat.id, `🔔 Какую панель присылать сюда${thread ? ' (в этот топик)' : ''}?`, kb, { message_thread_id: thread });
}

async function bindApply(cq) {
  const m = cq.message;
  const id = cq.data.slice(5);
  const thread = m.is_topic_message ? m.message_thread_id : undefined;
  const targets = id === '*' ? panels.list() : [panels.get(id)].filter(Boolean);
  const res = [];
  for (const p of targets) {
    try {
      await panels.api(p, 'POST', '/settings', { notifyChatId: String(m.chat.id), notifyThreadId: thread ? String(thread) : '' });
      await panels.api(p, 'POST', '/notify-test').catch(() => {});
      res.push(`✅ ${esc(p.name)}`);
    } catch (e) { res.push(`❌ ${esc(p.name)}: ${esc(e.message)}`); }
  }
  tg.answer(cq.id, 'Готово');
  return tg.edit(m.chat.id, m.message_id, `🔔 Уведомления сюда${thread ? ' (в этот топик)' : ''}:\n${res.join('\n')}`);
}

// ---------- вход ----------
async function onUpdate(u) {
  const from = u.message?.from || u.callback_query?.from;
  if (!from) return;
  const chat = u.message?.chat || u.callback_query?.message?.chat;
  if (chat && chat.type !== 'private') {
    // в группах — только привязка уведомлений: /bind и кнопки под ним, и только от админов
    if (!ADMINS.has(String(from.id))) { if (u.callback_query) tg.answer(u.callback_query.id, 'Нет доступа', true); return; }
    if (u.message && /^\/bind(@\w+)?\b/.test(u.message.text || '')) return bindPrompt(u.message);
    if (u.callback_query && /^bind:/.test(u.callback_query.data || '')) return bindApply(u.callback_query);
    return;
  }
  if (!ADMINS.has(String(from.id))) {
    if (u.message) await tg.send(from.id, `⛔ Нет доступа.\nТвой id: <code>${from.id}</code> — добавь его в <code>TG_ADMIN_IDS</code> в .env бота.`);
    else tg.answer(u.callback_query.id, 'Нет доступа', true);
    return;
  }
  if (u.callback_query) return onCallback(u.callback_query);
  if (u.message) return onMessage(u.message);
  return null;
}

async function main() {
  panels.load();
  // экстрактор на этом же сервере добавляется сам (и подхватывает смену токена)
  discoverLocal();
  setInterval(discoverLocal, 5 * 60 * 1000).unref();
  scheduleBotBackups();
  await tg.call('setMyCommands', { commands: [{ command: 'start', description: 'Меню' }, { command: 'cancel', description: 'Отменить ввод' }, { command: 'id', description: 'Мой Telegram id' }, { command: 'bind', description: 'В группе: слать сюда уведомления панели' }] }).catch(() => {});
  const me = await tg.call('getMe');
  console.log(`[bot] @${me.username} запущен, панелей: ${panels.list().length}, админов: ${ADMINS.size}`);
  await tg.poll(onUpdate);
}

main().catch((e) => { console.error(e); process.exit(1); });
