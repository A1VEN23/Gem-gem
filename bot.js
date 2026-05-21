/**
 * Gem Wallet — Telegram Bot
 * Handles /start command and sends a welcome message.
 *
 * Setup:
 *   1. Set BOT_TOKEN and WEBAPP_URL in your .env (or environment)
 *   2. Run: node bot.js
 *
 * Required env vars:
 *   BOT_TOKEN   — your Telegram bot token from @BotFather
 *   WEBAPP_URL  — deployed URL of the Gem Wallet mini-app
 */

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.VITE_BOT_TOKEN || "8834785563:AAGLnLZrAIJNHHfRG0cwk07DcLqiSyBG3UU";
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://gem-gem-seven.vercel.app';
const BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

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

async function sendWelcome(chatId) {
  const text =
    `<b>Что умеет этот бот?</b>\n\n` +
    `💎 Покупайте и храните USDT, TON, ETH, SOL, BNB, LTC и другие криптовалюты.\n` +
    `🌍 Отправляйте мгновенно любому пользователю в Telegram.\n` +
    `📊 Следите за своим портфелем в реальном времени.\n\n` +
    `Ваш кошелёк уже в Telegram.\n` +
    `Никаких KYC — только ваши ключи, только ваши монеты.\n\n` +
    `💬 Поддержка: @meneger_ai_agency`;

  await apiCall('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        {
          text: '💎  Открыть кошелёк',
          web_app: { url: WEBAPP_URL },
        },
      ]],
    },
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
        await sendWelcome(chatId);
      }
    }
  } catch (e) {
    console.warn('[poll error]', e.message);
  }

  setTimeout(poll, 500);
}

console.log('🚀  Gem Wallet Bot started — polling for updates...');
poll();
