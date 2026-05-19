/**
 * Gem Wallet — Telegram Bot
 * Handles /start command and sends a premium welcome message.
 *
 * Setup:
 *   1. Set BOT_TOKEN and WEBAPP_URL in your .env (or environment)
 *   2. Run: node bot.js
 *
 * Required env vars:
 *   BOT_TOKEN   — your Telegram bot token from @BotFather
 *   WEBAPP_URL  — deployed URL of the Gem Wallet mini-app
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.VITE_BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://t.me/GemWalletBot/app';
const BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Use generated premium banner, fallback to logo
const BANNER_PATH = path.join(__dirname, 'src/assets/welcome-banner.png');
const LOGO_PATH   = path.join(__dirname, 'src/assets/gem-logo.jpg');
const PHOTO_PATH  = fs.existsSync(BANNER_PATH) ? BANNER_PATH : LOGO_PATH;

if (!BOT_TOKEN) {
  console.error('❌  BOT_TOKEN is not set. Export it or add it to .env');
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function apiCall(method, params = {}) {
  const res = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

async function sendWelcomePhoto(chatId, firstName = '') {
  const greeting = firstName ? `Привет, ${firstName}!` : 'Добро пожаловать!';

  const caption =
    `💎 <b>Gem Wallet</b>\n` +
    `<i>Некастодиальный криптокошелёк в Telegram</i>\n\n` +
    `${greeting}\n\n` +
    `<b>Только вы контролируете свои активы.</b>\n` +
    `Приватные ключи хранятся исключительно на вашем устройстве — ни серверов, ни посредников.\n\n` +
    `<b>Поддерживаемые сети:</b>\n` +
    `Bitcoin · Ethereum · TON · BNB Chain\n` +
    `Solana · Arbitrum · Litecoin · USDT\n\n` +
    `<b>Возможности:</b>\n` +
    `— Отправка и получение криптовалют\n` +
    `— Портфель в реальном времени\n` +
    `— Обмен токенов внутри приложения\n` +
    `— Без KYC и ограничений\n\n` +
    `Нажмите кнопку ниже, чтобы открыть кошелёк 👇`;

  const replyMarkup = {
    inline_keyboard: [[
      {
        text: '💎  Открыть Gem Wallet',
        web_app: { url: WEBAPP_URL },
      },
    ]],
  };

  if (fs.existsSync(PHOTO_PATH)) {
    const photoBuffer = fs.readFileSync(PHOTO_PATH);
    const isJpeg = PHOTO_PATH.endsWith('.jpg') || PHOTO_PATH.endsWith('.jpeg');
    const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
    const fileName  = path.basename(PHOTO_PATH);

    const boundary = '----GemBoundary' + Date.now();
    const enc = new TextEncoder();

    const parts = [
      enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`),
      enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`),
      enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML\r\n`),
      enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="reply_markup"\r\n\r\n${JSON.stringify(replyMarkup)}\r\n`),
      enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
      new Uint8Array(photoBuffer),
      enc.encode(`\r\n--${boundary}--\r\n`),
    ];

    const totalLen = parts.reduce((s, p) => s + p.length, 0);
    const body = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of parts) { body.set(part, offset); offset += part.length; }

    const res = await fetch(`${BASE}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const data = await res.json();
    if (!data.ok) {
      console.warn('[sendPhoto] failed:', data.description, '— falling back to sendMessage');
      await sendWelcomeFallback(chatId, caption, replyMarkup);
    }
  } else {
    await sendWelcomeFallback(chatId, caption, replyMarkup);
  }
}

async function sendWelcomeFallback(chatId, caption, replyMarkup) {
  await apiCall('sendMessage', {
    chat_id: chatId,
    text: caption,
    parse_mode: 'HTML',
    reply_markup: replyMarkup,
  });
}

// ─── Polling ──────────────────────────────────────────────────────────────────

let offset = 0;

async function poll() {
  try {
    const data = await apiCall('getUpdates', {
      offset,
      timeout: 30,
      allowed_updates: ['message'],
    });

    if (!data.ok || !data.result) return;

    for (const update of data.result) {
      offset = update.update_id + 1;
      const msg = update.message;
      if (!msg) continue;

      const text   = (msg.text || '').trim();
      const chatId = msg.chat.id;
      const firstName = msg.from?.first_name || '';

      if (text === '/start' || text.startsWith('/start ')) {
        console.log(`[/start] chatId=${chatId} user=${msg.from?.username || firstName}`);
        await sendWelcomePhoto(chatId, firstName);
      }
    }
  } catch (e) {
    console.warn('[poll error]', e.message);
  }

  setTimeout(poll, 500);
}

console.log('🚀  Gem Wallet Bot started — polling for updates...');
poll();
