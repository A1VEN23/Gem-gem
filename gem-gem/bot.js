/**
 * Gem Wallet — Telegram Bot
 * Handles /start command and sends a welcome photo with caption.
 * Sets a persistent menu button "💎 Кошелёк" that opens the web app.
 */

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.VITE_BOT_TOKEN || "8834785563:AAGLnLZrAIJNHHfRG0cwk07DcLqiSyBG3UU";
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://1396e4b3-a553-4ca2-b218-135ab89415a1-00-3rb407o4nb7a2.picard.replit.dev';
const BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;
const BANNER_URL = 'https://raw.githubusercontent.com/A1VEN23/Gem-gem/main/src/assets/welcome-banner.jpg';

if (!BOT_TOKEN) {
  console.error('❌  BOT_TOKEN is not set.');
  process.exit(1);
}

async function apiCall(method, params = {}) {
  const res = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return res.json();
}

// ─── Set persistent menu button for all chats ─────────────────────────────────

async function setupMenuButton() {
  const res = await apiCall('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: '💎 Кошелёк',
      web_app: { url: WEBAPP_URL },
    },
  });
  if (res.ok) {
    console.log('✅  Menu button set: 💎 Кошелёк');
  } else {
    console.warn('⚠️  Could not set menu button:', res.description);
  }
}

// ─── Welcome message ──────────────────────────────────────────────────────────

async function sendWelcome(chatId) {
  const caption =
    `Приветствуем в Gem Wallet💎\n\n` +
    `Присоединяйтесь к миллионам единомышленников, которые уже управляют, обменивают и приумножают свои цифровые активы в удобном приложении.\n\n` +
    `⚡️ Совершайте сделки в один тап по лучшему курсу\n\n` +
    `🔒 Храните сбережения под абсолютной защитой нового поколения\n\n` +
    `🌍 Переводите средства в любую точку планеты мгновенно\n\n` +
    `Открыть мир крипты можно всего с пары долларов — без скрытых платежей и ограничений.`;

  const replyMarkup = {
    inline_keyboard: [[
      {
        text: '💎  Открыть Gem Wallet',
        web_app: { url: WEBAPP_URL },
      },
    ]],
  };

  const photoRes = await apiCall('sendPhoto', {
    chat_id: chatId,
    photo: BANNER_URL,
    caption,
    parse_mode: 'HTML',
    reply_markup: replyMarkup,
  });

  if (!photoRes.ok) {
    console.warn('[sendPhoto] failed:', photoRes.description, '— fallback to sendMessage');
    await apiCall('sendMessage', {
      chat_id: chatId,
      text: caption,
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

console.log('🚀  Gem Wallet Bot starting...');
setupMenuButton().then(() => poll());
