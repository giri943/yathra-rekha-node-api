// A thin client for the Telegram Bot API.
//
// The token (TELEGRAM_BOT_TOKEN) is part of every request URL, so errors are
// rebuilt from Telegram's own description and never carry the URL: a logged
// network error must not leak the token.

const API = 'https://api.telegram.org';
const fetchFn = globalThis.fetch || require('node-fetch');

const token = () => process.env.TELEGRAM_BOT_TOKEN || '';
const botUsername = () => (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');

/** Whether the bot is set up on this server; the app hides Telegram if not. */
const isConfigured = () => Boolean(token() && botUsername());

class TelegramError extends Error {
  constructor(method, status, description) {
    super(`Telegram ${method} failed (${status}): ${description || 'no description'}`);
    this.method = method;
    this.status = status;
    this.description = description || '';
  }

  /** The person blocked the bot or deleted the chat: stop writing to it. */
  get chatGone() {
    return this.status === 403 ||
      /chat not found|user is deactivated|bot was blocked/i.test(this.description);
  }

  /** Editing a message to what it already says; harmless. */
  get notModified() {
    return /message is not modified/i.test(this.description);
  }
}

async function request(method, init) {
  if (!token()) throw new TelegramError(method, 0, 'TELEGRAM_BOT_TOKEN is not set');
  let response;
  try {
    response = await fetchFn(`${API}/bot${token()}/${method}`, init);
  } catch (error) {
    throw new TelegramError(method, 0, 'network error');
  }
  const data = await response.json().catch(() => ({}));
  if (!data.ok) throw new TelegramError(method, response.status, data.description);
  return data.result;
}

const call = (method, payload) => request(method, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});

const sendMessage = (chatId, text, extra = {}) => call('sendMessage', {
  chat_id: chatId,
  text,
  parse_mode: 'HTML',
  disable_web_page_preview: true,
  ...extra
});

const editMessageText = (chatId, messageId, text, extra = {}) => call('editMessageText', {
  chat_id: chatId,
  message_id: messageId,
  text,
  parse_mode: 'HTML',
  disable_web_page_preview: true,
  ...extra
});

const answerCallbackQuery = (id, text) => call('answerCallbackQuery', {
  callback_query_id: id,
  ...(text ? { text } : {})
});

/** Sends a PDF (or any file) from memory. */
function sendDocument(chatId, buffer, filename, caption) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  form.append('document', new Blob([buffer], { type: 'application/pdf' }), filename);
  return request('sendDocument', { method: 'POST', body: form });
}

module.exports = {
  isConfigured,
  botUsername,
  call,
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  sendDocument,
  TelegramError
};
