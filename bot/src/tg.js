'use strict';
// Минимальный клиент Telegram Bot API (long polling), без зависимостей.
const API = (process.env.TG_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');

class TG {
  constructor(token) { this.token = token; this.base = `${API}/bot${token}`; this.offset = 0; }

  async call(method, params = {}) {
    const r = await fetch(`${this.base}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
      signal: AbortSignal.timeout(method === 'getUpdates' ? 70000 : 30000),
    });
    const j = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
    if (!j.ok) {
      const err = new Error(j.description || 'Telegram error'); err.code = j.error_code; throw err;
    }
    return j.result;
  }

  send(chatId, text, keyboard, extra = {}) {
    return this.call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined, ...extra });
  }

  async edit(chatId, messageId, text, keyboard) {
    try {
      return await this.call('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined });
    } catch (e) {
      if (/message is not modified/i.test(e.message)) return null;
      if (/message to edit not found|can't be edited/i.test(e.message)) return this.send(chatId, text, keyboard);
      throw e;
    }
  }

  answer(id, text, alert = false) { return this.call('answerCallbackQuery', { callback_query_id: id, text, show_alert: alert }).catch(() => {}); }
  del(chatId, messageId) { return this.call('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => {}); }

  async sendDoc(chatId, filename, buf, caption) {
    const fd = new FormData();
    fd.append('chat_id', String(chatId));
    if (caption) { fd.append('caption', caption.slice(0, 1000)); fd.append('parse_mode', 'HTML'); }
    fd.append('document', new Blob([buf]), filename);
    const r = await fetch(`${this.base}/sendDocument`, { method: 'POST', body: fd, signal: AbortSignal.timeout(120000) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.description || `HTTP ${r.status}`);
    return j.result;
  }

  async download(fileId, maxBytes = 20 * 1024 * 1024) {
    const f = await this.call('getFile', { file_id: fileId });
    if (f.file_size && f.file_size > maxBytes) throw new Error('Файл слишком большой');
    const r = await fetch(`${API}/file/bot${this.token}/${f.file_path}`, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`Не удалось скачать файл: HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }

  async poll(onUpdate) {
    for (;;) {
      try {
        const ups = await this.call('getUpdates', { offset: this.offset, timeout: 50, allowed_updates: ['message', 'callback_query'] });
        for (const u of ups) {
          this.offset = u.update_id + 1;
          Promise.resolve(onUpdate(u)).catch((e) => console.error('[update]', e));
        }
      } catch (e) {
        console.error('[poll]', e.message);
        if (e.code === 401) { console.error('Неверный TG_BOT_TOKEN'); process.exit(1); }
        if (e.code === 409) console.error('Этот токен уже опрашивает другой бот (409). Запусти бота только в одном месте.');
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

module.exports = { TG, esc };
