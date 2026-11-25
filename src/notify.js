'use strict';
// Уведомления в Telegram: TG_BOT_TOKEN + TG_CHAT_ID (+ TG_THREAD_ID для топика).
const TOKEN = process.env.TG_BOT_TOKEN || '';
// куда слать: TG_CHAT_ID, а если пусто — первому админу из TG_ADMIN_IDS
const CHAT = process.env.TG_CHAT_ID || String(process.env.TG_ADMIN_IDS || '').split(/[,\s]+/).filter(Boolean)[0] || '';
const THREAD = process.env.TG_THREAD_ID || '';
const PANEL = process.env.PANEL_NAME || '';
const API = (process.env.TG_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');

const enabled = () => !!(TOKEN && CHAT);
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

async function send(html) {
  if (!enabled()) return false;
  try {
    const r = await fetch(`${API}/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, message_thread_id: THREAD ? Number(THREAD) : undefined, text: `🔗 <b>Link Extractor${PANEL ? ` · ${esc(PANEL)}` : ''}</b>\n${html}`.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) { console.warn('[telegram]', r.status, (await r.text()).slice(0, 200)); return false; }
    return true;
  } catch (e) { console.warn('[telegram]', e.message); return false; }
}

async function sendDocument(filename, buf, caption) {
  if (!enabled()) return false;
  try {
    const fd = new FormData();
    fd.append('chat_id', CHAT);
    if (THREAD) fd.append('message_thread_id', THREAD);
    fd.append('caption', `${PANEL ? `[${PANEL}] ` : ''}${caption || ''}`.slice(0, 1000));
    fd.append('document', new Blob([buf]), filename);
    const r = await fetch(`${API}/bot${TOKEN}/sendDocument`, { method: 'POST', body: fd, signal: AbortSignal.timeout(60000) });
    if (!r.ok) { console.warn('[telegram doc]', r.status, (await r.text()).slice(0, 200)); return false; }
    return true;
  } catch (e) { console.warn('[telegram doc]', e.message); return false; }
}

module.exports = { enabled, send, sendDocument, esc };
