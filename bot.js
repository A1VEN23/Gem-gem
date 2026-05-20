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
const LOGO_PATH = path.join(__dirname, 'src/assets/gem-logo.jpg');

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

async function sendWelcomePhoto(chatId) {
  const caption =
    `💎 <b>Gem Wallet</b>\n` +
    `<i>Ваш персональный некастодиальный кошелёк</i>\n\n` +
    `─────────────────────────\n\n` +
    `Gem Wallet даёт вам <b>полный контроль</b> над криптовалютой — без банков, без посредников, без лимитов.\n\n` +
    `🔑 <b>Только вы владеете ключами</b>\n` +
    `Ваша seed-фраза хранится исключительно у вас. Никто — ни мы, ни кто-либо другой — не имеет доступа к вашим средствам.\n\n` +
    `⚡ <b>Быстро. Глобально. Без ограничений</b>\n` +
    `Отправляйте и получайте криптовалюту в любую точку мира мгновенно.\n\n` +
    `🌐 <b>Поддерживаемые сети:</b>\n` +
    `ETH · TON · BNB · SOL · ARB · LTC · USDT\n\n` +
    `🛡 Без KYC · Без верификации · Без комиссий платформы\n\n` +
    `─────────────────────────\n\n` +
    `Нажмите кнопку ниже, чтобы открыть кошелёк 👇`;

  const replyMarkup = {
    inline_keyboard: [[
      {
        text: '💎  Открыть Gem Wallet',
        web_app: { url: WEBAPP_URL },
      },
    ]],
  };

  // Try to send with local photo file first, fall back to text-only on error
  if (fs.existsSync(LOGO_PATH)) {
    const logoBuffer = fs.readFileSync(LOGO_PATH);
    const boundary = '----GemWalletBoundary' + Date.now();

    const buildMultipart = (boundary, fields) => {
      let body = '';
      const parts = [];
      for (const [name, value] of Object.entries(fields)) {
        if (value && value.buffer) {
          parts.push(
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="gem-logo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
          );
        } else {
          parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
        }
      }
      return parts;
    };

    // Use Uint8Array multipart manually (no external deps)
    const enc = new TextEncoder();

    const fieldParts = [
      enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`),
      enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`),
      enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML\r\n`),
      enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="reply_markup"\r\n\r\n${JSON.stringify(replyMarkup)}\r\n`),
      enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="gem-logo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      new Uint8Array(logoBuffer),
      enc.encode(`\r\n--${boundary}--\r\n`),
    ];

    const totalLen = fieldParts.reduce((s, p) => s + p.length, 0);
    const body = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of fieldParts) {
      body.set(part, offset);
      offset += part.length;
    }

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
    text: `💎 ${caption}`,
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

      const text = (msg.text || '').trim();
      const chatId = msg.chat.id;

      if (text === '/start' || text.startsWith('/start ')) {
        console.log(`[/start] chatId=${chatId} user=${msg.from?.username || msg.from?.first_name}`);
        await sendWelcomePhoto(chatId);
      }
    }
  } catch (e) {
    console.warn('[poll error]', e.message);
  }

  setTimeout(poll, 500);
}

console.log('🚀  Gem Wallet Bot started — polling for updates...');
poll();
