/**
 * Gem Wallet — Telegram Bot
 * Handles /start command and sends a premium welcome message.
 *
 * Setup:
 *   1. Set BOT_TOKEN and WEBAPP_URL in your .env (or environment)
 *   2. Run: node bot.js
 */

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.VITE_BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://t.me/GemWalletBot/app';
const BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Premium banner hosted on GitHub (always up-to-date, no local file needed)
const BANNER_URL = 'https://raw.githubusercontent.com/A1VEN23/Gem-gem/main/gem-gem/src/assets/welcome-banner.png';

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

async function sendWelcome(chatId, firstName = '') {
  const greeting = firstName ? `Привет, <b>${firstName}</b>!` : 'Добро пожаловать!';

  const caption =
    `💎 <b>Gem Wallet</b> — криптокошелёк в Telegram\n\n` +
    `${greeting}\n\n` +
    `🔐 <b>Только вы контролируете свои активы</b>\n` +
    `Приватные ключи хранятся исключительно на вашем устройстве — без серверов и посредников.\n\n` +
    `<b>Поддерживаемые сети:</b>\n` +
    `Bitcoin · Ethereum · TON · BNB Chain · Solana · Arbitrum · Litecoin · USDT\n\n` +
    `<b>Возможности:</b>\n` +
    `• Отправка и получение криптовалют\n` +
    `• Портфель с ценами в реальном времени\n` +
    `• Обмен токенов внутри приложения\n` +
    `• Без KYC · Без ограничений\n\n` +
    `Нажмите кнопку ниже, чтобы открыть кошелёк 👇`;

  const replyMarkup = {
    inline_keyboard: [[
      { text: '💎  Открыть Gem Wallet', web_app: { url: WEBAPP_URL } },
    ]],
  };

  // Send photo via public URL — no local files required
  const result = await apiCall('sendPhoto', {
    chat_id: chatId,
    photo: BANNER_URL,
    caption,
    parse_mode: 'HTML',
    reply_markup: replyMarkup,
  });

  if (!result.ok) {
    console.warn('[sendPhoto] failed:', result.description, '— falling back to sendMessage');
    await apiCall('sendMessage', {
      chat_id: chatId,
      text: `💎 ${caption}`,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });
  }
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

      const text      = (msg.text || '').trim();
      const chatId    = msg.chat.id;
      const firstName = msg.from?.first_name || '';

      if (text === '/start' || text.startsWith('/start ')) {
        console.log(`[/start] chatId=${chatId} user=${msg.from?.username || firstName}`);
        await sendWelcome(chatId, firstName);
      }
    }
  } catch (e) {
    console.warn('[poll error]', e.message);
  }

  setTimeout(poll, 500);
}

console.log('🚀  Gem Wallet Bot started — polling for updates...');
poll();
