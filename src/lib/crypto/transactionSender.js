/**
 * transactionSender.js
 * Sign and broadcast real transactions for all supported chains.
 *
 * Chains: ETH, BNB, ARB (EVM via ethers.js)
 *         SOL (@solana/web3.js)
 *         TON (@ton/ton WalletContractV4)
 *         LTC (BlockCypher push API — build + sign + broadcast)
 *         USDT (ERC-20/BEP-20/ARB transfer, SPL transfer, TON Jetton transfer)
 */

import { ethers } from 'ethers';

// ─── ERC-20 transfer ABI ──────────────────────────────────────────────────────
const ERC20_TRANSFER_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

// ─── USDT contract addresses (MAINNET) ───────────────────────────────────────
const USDT_CONTRACTS = {
  eth: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  bnb: '0x55d398326f99059fF775485246999027B3197955',
  arb: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
};

const USDT_SOL_MINT   = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const USDT_TON_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

// ─── Fallback RPC lists ────────────────────────────────────────────────────────
// Multiple endpoints per chain; we try them in order until one works.
const CHAIN_RPCS = {
  eth: [
    'https://eth.llamarpc.com',
    'https://rpc.ankr.com/eth',
    'https://cloudflare-eth.com',
    'https://ethereum.publicnode.com',
  ],
  bnb: [
    'https://bsc-dataseed.binance.org',
    'https://bsc-dataseed1.defibit.io',
    'https://bsc-dataseed2.defibit.io',
    'https://rpc.ankr.com/bsc',
  ],
  arb: [
    'https://arb1.arbitrum.io/rpc',
    'https://rpc.ankr.com/arbitrum',
    'https://arbitrum.llamarpc.com',
  ],
  sol: [
    'https://api.mainnet-beta.solana.com',
    'https://rpc.ankr.com/solana',
    'https://solana-mainnet.g.alchemy.com/v2/demo',
  ],
  ton: [
    'https://toncenter.com/api/v2',
    'https://toncenter.com/api/v2',   // retry same endpoint on transient 500
    'https://toncenter.com/api/v2',
  ],
};

function rpc(key, fallback) {
  return (typeof import.meta !== 'undefined' && import.meta.env?.[key]) || fallback;
}

// Primary RPC (may be overridden by env var)
function primaryRpc(chain) {
  const envKey = `VITE_${chain.toUpperCase()}_RPC`;
  const envVal = typeof import.meta !== 'undefined' && import.meta.env?.[envKey];
  return envVal || CHAIN_RPCS[chain][0];
}

// ─── Retry helper ─────────────────────────────────────────────────────────────
// Retries fn up to `attempts` times. On 5xx / network errors waits `delayMs` before
// next attempt. Non-transient errors (bad key, insufficient funds, etc.) are rethrown immediately.
const RETRYABLE = [
  '500', '502', '503', '504',
  'failed with status code 5',
  'network error', 'timeout', 'ETIMEDOUT', 'ECONNRESET',
  'fetch failed', 'socket hang up', 'getaddrinfo',
];

function isRetryable(err) {
  const msg = (err?.message || '').toLowerCase();
  return RETRYABLE.some(s => msg.includes(s.toLowerCase()));
}

async function withRetry(fn, attempts = 3, delayMs = 2000) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e)) throw e;              // give up immediately
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, delayMs * (i + 1))); // 2s, 4s, ...
      }
    }
  }
  throw lastErr;
}

// ─── Safe amount string — prevents NUMERIC_FAULT from JS float precision ─────
function safeAmtStr(n, decimals = 8) {
  return parseFloat(n).toFixed(decimals);
}

// ─── EVM native send (with RPC fallover) ─────────────────────────────────────
async function sendEvmNative({ privateKey, to, amount, chainId, chainKey, fee }) {
  const endpoints = privateKey && CHAIN_RPCS[chainKey]
    ? [primaryRpc(chainKey), ...CHAIN_RPCS[chainKey].slice(1)]
    : [primaryRpc(chainKey)];

  let lastErr;
  for (const rpcUrl of endpoints) {
    try {
      return await withRetry(async () => {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet = new ethers.Wallet(privateKey, provider);
        const txData = {
          to,
          value: ethers.parseEther(safeAmtStr(amount)),
          chainId,
        };
        if (fee && fee > 0) {
          txData.gasPrice = ethers.parseUnits(String(fee), 'gwei');
        }
        const tx = await wallet.sendTransaction(txData);
        await tx.wait(1);
        return tx.hash;
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ─── ERC-20 token send (with RPC fallover) ───────────────────────────────────
async function sendErc20({ privateKey, contractAddress, to, amount, chainKey, fee }) {
  const endpoints = [primaryRpc(chainKey), ...CHAIN_RPCS[chainKey].slice(1)];

  let lastErr;
  for (const rpcUrl of endpoints) {
    try {
      return await withRetry(async () => {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet = new ethers.Wallet(privateKey, provider);
        const contract = new ethers.Contract(contractAddress, ERC20_TRANSFER_ABI, wallet);
        const decimals = await contract.decimals();
        const parsed = ethers.parseUnits(
          safeAmtStr(amount, Math.min(Number(decimals), 8)),
          decimals
        );
        const txOptions = {};
        if (fee && fee > 0) {
          txOptions.gasPrice = ethers.parseUnits(String(fee), 'gwei');
        }
        const tx = await contract.transfer(to, parsed, txOptions);
        await tx.wait(1);
        return tx.hash;
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ─── Solana native send (with RPC fallover + required blockhash/feePayer) ────
async function sendSolNative({ privateKeyHex, to, amount, fee }) {
  const endpoints = [primaryRpc('sol'), ...CHAIN_RPCS.sol.slice(1)];

  let lastErr;
  for (const rpcUrl of endpoints) {
    try {
      return await withRetry(async () => {
        const {
          Connection, PublicKey, SystemProgram, Transaction, Keypair, ComputeBudgetProgram,
        } = await import('@solana/web3.js');

        const conn = new Connection(rpcUrl, 'confirmed');
        const secretKey = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'));
        const keypair = Keypair.fromSecretKey(secretKey);
        const lamports = Math.round(amount * 1e9);

        const tx = new Transaction();
        if (fee && fee > 0) {
          tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: fee }));
        }
        tx.add(
          SystemProgram.transfer({
            fromPubkey: keypair.publicKey,
            toPubkey: new PublicKey(to),
            lamports,
          })
        );

        const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
        tx.recentBlockhash = blockhash;
        tx.feePayer = keypair.publicKey;

        const sig = await conn.sendTransaction(tx, [keypair], { skipPreflight: false });
        await conn.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          'confirmed'
        );
        return sig;
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ─── Solana SPL / USDT send (with RPC fallover + required blockhash/feePayer) ─
async function sendSolSpl({ privateKeyHex, to, amount, mintAddress, fee }) {
  const endpoints = [primaryRpc('sol'), ...CHAIN_RPCS.sol.slice(1)];

  let lastErr;
  for (const rpcUrl of endpoints) {
    try {
      return await withRetry(async () => {
        const {
          Connection, PublicKey, Transaction, Keypair, ComputeBudgetProgram,
        } = await import('@solana/web3.js');
        const {
          getOrCreateAssociatedTokenAccount,
          createTransferInstruction,
          getMint,
        } = await import('@solana/spl-token');

        const conn = new Connection(rpcUrl, 'confirmed');
        const secretKey = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'));
        const payer = Keypair.fromSecretKey(secretKey);
        const mint = new PublicKey(mintAddress);
        const toPublicKey = new PublicKey(to);

        const mintInfo = await getMint(conn, mint);
        const amountRaw = BigInt(Math.round(amount * 10 ** mintInfo.decimals));

        const fromAta = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
        const toAta   = await getOrCreateAssociatedTokenAccount(conn, payer, mint, toPublicKey);

        const tx = new Transaction();
        if (fee && fee > 0) {
          tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: fee }));
        }
        tx.add(createTransferInstruction(
          fromAta.address, toAta.address, payer.publicKey, amountRaw
        ));

        const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
        tx.recentBlockhash = blockhash;
        tx.feePayer = payer.publicKey;

        const sig = await conn.sendTransaction(tx, [payer], { skipPreflight: false });
        await conn.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          'confirmed'
        );
        return sig;
      });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ─── Build TonClient with API key (if available) ─────────────────────────────
async function makeTonClient(endpoint) {
  const { TonClient } = await import('@ton/ton');
  const apiKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TON_API_KEY) || '';
  return new TonClient({
    endpoint: `${endpoint}/jsonRPC`,
    apiKey: apiKey || undefined,
  });
}

// ─── Decode TON key (NaCl layout: 32-byte sign key | 32-byte pub key) ─────────
function decodeTonKey(privateKeyHex) {
  const secretKey = Buffer.from(privateKeyHex, 'hex');
  if (secretKey.length < 64) {
    throw new Error(
      `TON: неверная длина ключа (${secretKey.length} байт, ожидается 64). Переоткройте приложение.`
    );
  }
  const publicKey = secretKey.slice(32);
  return { secretKey, publicKey };
}

// ─── TON native send (with retry on 500) ─────────────────────────────────────
async function sendTonNative({ privateKeyHex, to, amount, apiBase }) {
  const { WalletContractV4, internal, toNano } = await import('@ton/ton');
  const { secretKey, publicKey } = decodeTonKey(privateKeyHex);

  return withRetry(async () => {
    const client = await makeTonClient(apiBase);
    const wallet = WalletContractV4.create({ workchain: 0, publicKey });
    const contract = client.open(wallet);
    const seqno = await contract.getSeqno();

    await contract.sendTransfer({
      secretKey,
      seqno,
      messages: [
        internal({
          to,
          value: toNano(parseFloat(amount).toFixed(9)),
          bounce: false,
        }),
      ],
    });

    // Give the TON node time to process
    await new Promise(r => setTimeout(r, 5000));
    return `ton-tx-seqno${seqno}-${Date.now()}`;
  }, 4, 3000); // 4 attempts, 3s / 6s / 9s delays
}

// ─── TON Jetton / USDT send (with retry on 500) ───────────────────────────────
async function sendTonJetton({ privateKeyHex, to, amount, jettonMasterAddress, apiBase }) {
  const { WalletContractV4, internal, toNano, Address, beginCell } = await import('@ton/ton');
  const { secretKey, publicKey } = decodeTonKey(privateKeyHex);

  return withRetry(async () => {
    const client = await makeTonClient(apiBase);
    const wallet = WalletContractV4.create({ workchain: 0, publicKey });
    const contract = client.open(wallet);
    const seqno = await contract.getSeqno();

    // USDT on TON uses 6 decimals
    const amountNano = BigInt(Math.round(amount * 1e6));

    // TEP-74 jetton transfer body
    // forward_payload bit=0 → inline empty, no ref cell
    const body = beginCell()
      .storeUint(0xf8a7ea5, 32)  // op: jetton transfer
      .storeUint(0, 64)           // query_id
      .storeCoins(amountNano)     // USDT amount
      .storeAddress(Address.parse(to))                         // destination
      .storeAddress(Address.parse(wallet.address.toString()))  // response_destination
      .storeBit(false)             // no custom_payload
      .storeCoins(1n)              // forward_ton_amount (1 nanoton = minimal)
      .storeBit(false)             // forward_payload inline, empty
      .endCell();

    // Resolve sender's jetton wallet on-chain
    const jettonMasterAddr = Address.parse(jettonMasterAddress);
    const res = await client.runMethod(jettonMasterAddr, 'get_wallet_address', [
      { type: 'slice', cell: beginCell().storeAddress(wallet.address).endCell() },
    ]);
    const jettonWalletAddr = res.stack.readAddress();

    // 0.07 TON is the standard gas for a jetton transfer
    await contract.sendTransfer({
      secretKey,
      seqno,
      messages: [
        internal({
          to: jettonWalletAddr,
          value: toNano('0.07'),
          bounce: true,
          body,
        }),
      ],
    });

    await new Promise(r => setTimeout(r, 5000));
    return `ton-jetton-seqno${seqno}-${Date.now()}`;
  }, 4, 3000);
}

// ─── LTC send via BlockCypher (auto fee) ─────────────────────────────────────
async function sendLtc({ privateKeyHex, fromAddress, to, amount }) {
  const token = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BLOCKCYPHER_TOKEN) || '';
  const tokenParam = token ? `?token=${token}` : '';
  const satoshis = Math.round(amount * 1e8);

  // Do not override fees — let BlockCypher auto-calculate
  const newTxBody = {
    inputs:  [{ addresses: [fromAddress] }],
    outputs: [{ addresses: [to], value: satoshis }],
  };

  const newTxRes = await withRetry(() =>
    fetch(`https://api.blockcypher.com/v1/ltc/main/txs/new${tokenParam}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTxBody),
    }).then(async r => {
      if (!r.ok) throw new Error(`BlockCypher new tx: ${r.status} — ${await r.text()}`);
      return r.json();
    })
  );

  if (newTxRes.errors?.length > 0) throw new Error(newTxRes.errors[0].error);
  if (!newTxRes.tosign?.length)    throw new Error('BlockCypher вернул пустой список хешей для подписи');

  // DER-encode signature for each input
  const privHex = privateKeyHex.startsWith('0x') ? privateKeyHex : '0x' + privateKeyHex;
  const sk = new ethers.SigningKey(privHex);

  const signatures = newTxRes.tosign.map((hashHex) => {
    const sig = sk.sign('0x' + hashHex);
    const r = sig.r.slice(2).padStart(64, '0');
    const s = sig.s.slice(2).padStart(64, '0');
    const rPad = parseInt(r.slice(0, 2), 16) >= 0x80 ? '00' + r : r;
    const sPad = parseInt(s.slice(0, 2), 16) >= 0x80 ? '00' + s : s;
    const rLen = (rPad.length / 2).toString(16).padStart(2, '0');
    const sLen = (sPad.length / 2).toString(16).padStart(2, '0');
    const inner = `02${rLen}${rPad}02${sLen}${sPad}`;
    const totalLen = (inner.length / 2).toString(16).padStart(2, '0');
    return `30${totalLen}${inner}`;
  });

  const pubKeyHex = sk.compressedPublicKey.slice(2);

  const sent = await withRetry(() =>
    fetch(`https://api.blockcypher.com/v1/ltc/main/txs/send${tokenParam}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...newTxRes,
        signatures,
        pubkeys: newTxRes.tosign.map(() => pubKeyHex),
      }),
    }).then(async r => {
      if (!r.ok) throw new Error(`BlockCypher send: ${r.status} — ${await r.text()}`);
      return r.json();
    })
  );

  if (sent.errors?.length > 0) throw new Error(sent.errors[0].error);
  return sent.tx?.hash || `ltc-tx-${Date.now()}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a transaction on any supported chain.
 *
 * @param {Object} params
 * @param {string} params.sym        Asset symbol: 'ETH','BNB','ARB','SOL','TON','LTC','USDT'
 * @param {string} params.networkId  For USDT: 'eth','bnb','arb','sol','ton'
 * @param {string} params.from       Sender address (required for LTC)
 * @param {string} params.to         Recipient address
 * @param {number} params.amount     Amount in human units (e.g. 0.5 ETH)
 * @param {string} params.privateKey Private key hex
 * @param {number} params.fee        Fee hint (gwei for EVM, micro-lamports for SOL, 0 = auto)
 * @returns {Promise<string>} Transaction hash / signature
 */
export async function sendTransaction({ sym, networkId, from, to, amount, privateKey, fee }) {
  if (!privateKey) throw new Error('Приватный ключ не найден — переоткройте приложение');
  if (!to)         throw new Error('Адрес получателя не указан');
  if (!amount || parseFloat(amount) <= 0) throw new Error('Сумма должна быть больше нуля');

  const tonApiBase = rpc('VITE_TON_RPC', CHAIN_RPCS.ton[0]);

  // ── USDT routing ────────────────────────────────────────────────────────────
  if (sym === 'USDT') {
    const net = (networkId || 'eth').toLowerCase();
    switch (net) {
      case 'eth': return sendErc20({ privateKey, contractAddress: USDT_CONTRACTS.eth, to, amount, chainKey: 'eth', fee });
      case 'bnb': return sendErc20({ privateKey, contractAddress: USDT_CONTRACTS.bnb, to, amount, chainKey: 'bnb', fee });
      case 'arb': return sendErc20({ privateKey, contractAddress: USDT_CONTRACTS.arb, to, amount, chainKey: 'arb', fee });
      case 'sol': return sendSolSpl({ privateKeyHex: privateKey, to, amount, mintAddress: USDT_SOL_MINT, fee });
      case 'ton': return sendTonJetton({ privateKeyHex: privateKey, to, amount, jettonMasterAddress: USDT_TON_MASTER, apiBase: tonApiBase });
      default: throw new Error(`Неизвестная сеть для USDT: ${net}`);
    }
  }

  // ── Native asset routing ─────────────────────────────────────────────────────
  switch (sym) {
    case 'ETH': return sendEvmNative({ privateKey, to, amount, chainId: 1,     chainKey: 'eth', fee });
    case 'BNB': return sendEvmNative({ privateKey, to, amount, chainId: 56,    chainKey: 'bnb', fee });
    case 'ARB': return sendEvmNative({ privateKey, to, amount, chainId: 42161, chainKey: 'arb', fee });
    case 'SOL': return sendSolNative({ privateKeyHex: privateKey, to, amount, fee });
    case 'TON': return sendTonNative({ privateKeyHex: privateKey, to, amount, apiBase: tonApiBase });
    case 'LTC': return sendLtc({ privateKeyHex: privateKey, fromAddress: from, to, amount });
    default: throw new Error(`Неподдерживаемый актив: ${sym}`);
  }
}
