'use strict';
// Уведомления в Telegram: TG_BOT_TOKEN + TG_CHAT_ID (+ TG_THREAD_ID для топика).
const TOKEN = process.env.TG_BOT_TOKEN || '';
const CHAT = process.env.TG_CHAT_ID || '';
const THREAD = process.env.TG_THREAD_ID || '';

const enabled = () => !!(TOKEN && CHAT);
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

async function send(html) {
  if (!enabled()) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, message_thread_id: THREAD ? Number(THREAD) : undefined, text: `🔗 <b>Link Extractor</b>\n${html}`.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) { console.warn('[telegram]', r.status, (await r.text()).slice(0, 200)); return false; }
    return true;
  } catch (e) { console.warn('[telegram]', e.message); return false; }
}

module.exports = { enabled, send, esc };
