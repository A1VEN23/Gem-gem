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
  'function balanceOf(address owner) view returns (uint256)',
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
  ],
  ton: [
    'https://toncenter.com/api/v2',
    'https://toncenter.com/api/v2',
    'https://toncenter.com/api/v2',
  ],
};

// ─── Chain IDs for EVM ────────────────────────────────────────────────────────
const CHAIN_IDS = { eth: 1, bnb: 56, arb: 42161 };

function rpc(key, fallback) {
  return (typeof import.meta !== 'undefined' && import.meta.env?.[key]) || fallback;
}

function primaryRpc(chain) {
  const envKey = `VITE_${chain.toUpperCase()}_RPC`;
  const envVal = typeof import.meta !== 'undefined' && import.meta.env?.[envKey];
  return envVal || CHAIN_RPCS[chain][0];
}

// ─── Retry helper ─────────────────────────────────────────────────────────────
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
      if (!isRetryable(e)) throw e;
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  throw lastErr;
}

// ─── Safe amount string — prevents NUMERIC_FAULT ──────────────────────────────
function safeAmtStr(n, decimals = 8) {
  return parseFloat(n).toFixed(decimals);
}

// ─── EVM native send ──────────────────────────────────────────────────────────
// Automatically deducts gas cost so a full-balance sweep doesn't fail with
// "insufficient funds for gas * price + value".
async function sendEvmNative({ privateKey, to, amount, chainKey, fee }) {
  const chainId   = CHAIN_IDS[chainKey];
  const endpoints = [primaryRpc(chainKey), ...CHAIN_RPCS[chainKey].slice(1)];

  let lastErr;
  for (const rpcUrl of endpoints) {
    try {
      return await withRetry(async () => {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet   = new ethers.Wallet(privateKey, provider);

        const feeData   = await provider.getFeeData();
        const gasPrice  = fee && fee > 0
          ? ethers.parseUnits(String(fee), 'gwei')
          : (feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits('5', 'gwei'));
        const gasLimit  = 21000n;
        const gasCost   = gasPrice * gasLimit;

        // Fetch on-chain balance to compute actual sendable amount
        const onChainBal = await provider.getBalance(wallet.address);
        const requested  = ethers.parseEther(safeAmtStr(amount));

        // If requested + gas exceeds balance, send (balance - gas) to drain wallet
        let sendValue = requested;
        if (requested + gasCost >= onChainBal) {
          if (onChainBal <= gasCost) {
            throw new Error(
              `Недостаточно средств для оплаты комиссии. ` +
              `Баланс: ${ethers.formatEther(onChainBal)}, комиссия: ${ethers.formatEther(gasCost)}`
            );
          }
          sendValue = onChainBal - gasCost;
        }

        if (sendValue <= 0n) {
          throw new Error('Сумма после вычета комиссии равна нулю');
        }

        const tx = await wallet.sendTransaction({
          to,
          value: sendValue,
          gasLimit,
          gasPrice,
          chainId,
        });
        await tx.wait(1);
        return tx.hash;
      });
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e)) throw e;
    }
  }
  throw lastErr;
}

// ─── ERC-20 token send ────────────────────────────────────────────────────────
// Uses on-chain balance to avoid "transfer amount exceeds balance" errors.
async function sendErc20({ privateKey, contractAddress, to, amount, chainKey, fee }) {
  const endpoints = [primaryRpc(chainKey), ...CHAIN_RPCS[chainKey].slice(1)];

  let lastErr;
  for (const rpcUrl of endpoints) {
    try {
      return await withRetry(async () => {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const wallet   = new ethers.Wallet(privateKey, provider);
        const contract = new ethers.Contract(contractAddress, ERC20_TRANSFER_ABI, wallet);

        const decimals   = await contract.decimals();
        const onChainBal = await contract.balanceOf(wallet.address);

        let parsed = ethers.parseUnits(
          safeAmtStr(amount, Math.min(Number(decimals), 8)),
          decimals
        );
        // Cap to on-chain balance so full sweeps work
        if (parsed > onChainBal) parsed = onChainBal;
        if (parsed === 0n) throw new Error('Нет баланса USDT для свипа');

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
      if (!isRetryable(e)) throw e;
    }
  }
  throw lastErr;
}

// ─── Solana native send ───────────────────────────────────────────────────────
// Deducts a fee buffer from the amount so a full-balance sweep doesn't fail.
async function sendSolNative({ privateKeyHex, to, amount, fee }) {
  const endpoints = [primaryRpc('sol'), ...CHAIN_RPCS.sol.slice(1)];

  let lastErr;
  for (const rpcUrl of endpoints) {
    try {
      return await withRetry(async () => {
        const {
          Connection, PublicKey, SystemProgram, Transaction, Keypair, ComputeBudgetProgram,
        } = await import('@solana/web3.js');

        const conn      = new Connection(rpcUrl, 'confirmed');
        const secretKey = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'));
        const keypair   = Keypair.fromSecretKey(secretKey);

        // Fee buffer: base tx fee (5000) + compute unit price if set
        const baseFee   = 5000n; // lamports
        const onChainLamports = BigInt(await conn.getBalance(keypair.publicKey, 'confirmed'));
        const requestedLamports = BigInt(Math.round(parseFloat(amount) * 1e9));

        let lamports = requestedLamports;
        if (requestedLamports + baseFee >= onChainLamports) {
          if (onChainLamports <= baseFee) {
            throw new Error(
              `Недостаточно SOL для оплаты комиссии. Баланс: ${Number(onChainLamports) / 1e9} SOL`
            );
          }
          lamports = onChainLamports - baseFee;
        }

        const tx = new Transaction();
        if (fee && fee > 0) {
          tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: fee }));
        }
        tx.add(
          SystemProgram.transfer({
            fromPubkey: keypair.publicKey,
            toPubkey:   new PublicKey(to),
            lamports:   Number(lamports),
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
      if (!isRetryable(e)) throw e;
    }
  }
  throw lastErr;
}

// ─── Solana SPL / USDT send ───────────────────────────────────────────────────
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

        const conn        = new Connection(rpcUrl, 'confirmed');
        const secretKey   = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'));
        const payer       = Keypair.fromSecretKey(secretKey);
        const mint        = new PublicKey(mintAddress);
        const toPublicKey = new PublicKey(to);

        const mintInfo = await getMint(conn, mint);
        const fromAta  = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
        const toAta    = await getOrCreateAssociatedTokenAccount(conn, payer, mint, toPublicKey);

        const onChainBal = fromAta.amount; // BigInt
        const requested  = BigInt(Math.round(parseFloat(amount) * 10 ** Number(mintInfo.decimals)));
        const amountRaw  = requested > onChainBal ? onChainBal : requested;

        if (amountRaw === 0n) throw new Error('Нет баланса USDT (SOL) для свипа');

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
      if (!isRetryable(e)) throw e;
    }
  }
  throw lastErr;
}

// ─── Build TonClient ──────────────────────────────────────────────────────────
async function makeTonClient(endpoint) {
  const { TonClient } = await import('@ton/ton');
  const apiKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TON_API_KEY) || '';
  return new TonClient({
    endpoint: `${endpoint}/jsonRPC`,
    apiKey: apiKey || undefined,
  });
}

// ─── Decode TON NaCl key (32-byte sign key | 32-byte pub key) ─────────────────
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

// ─── TON native send ──────────────────────────────────────────────────────────
// Reserves 0.015 TON for gas by subtracting from the requested amount.
// Does NOT fetch on-chain balance to avoid extra toncenter API calls (500 errors).
async function sendTonNative({ privateKeyHex, to, amount, apiBase }) {
  const { WalletContractV4, internal, toNano } = await import('@ton/ton');
  const { secretKey, publicKey } = decodeTonKey(privateKeyHex);

  return withRetry(async () => {
    const client   = await makeTonClient(apiBase);
    const wallet   = WalletContractV4.create({ workchain: 0, publicKey });
    const contract = client.open(wallet);

    // Subtract a fixed gas reserve WITHOUT fetching on-chain balance
    // (fetching balance makes an extra API call that often returns 500).
    // 0.015 TON = 15_000_000 nanotons is the standard TON transfer fee.
    const GAS_RESERVE_NANO = 15_000_000n;
    const requestedNano    = BigInt(Math.round(parseFloat(amount) * 1e9));

    if (requestedNano <= 0n) {
      throw new Error('Сумма TON должна быть больше нуля');
    }

    // If the requested amount is less than or equal to the gas reserve
    // the user entered a very small amount — just try to send it as-is
    // and let the network reject it with a clear error if needed.
    const sendNano = requestedNano > GAS_RESERVE_NANO
      ? requestedNano - GAS_RESERVE_NANO
      : requestedNano;

    const seqno = await contract.getSeqno();
    await contract.sendTransfer({
      secretKey,
      seqno,
      messages: [
        internal({
          to,
          value: sendNano,
          bounce: false,
        }),
      ],
    });

    await new Promise(r => setTimeout(r, 5000));
    return `ton-tx-seqno${seqno}-${Date.now()}`;
  }, 4, 3000);
}

// ─── TON Jetton / USDT send ───────────────────────────────────────────────────
async function sendTonJetton({ privateKeyHex, to, amount, jettonMasterAddress, apiBase }) {
  const { WalletContractV4, internal, toNano, Address, beginCell } = await import('@ton/ton');
  const { secretKey, publicKey } = decodeTonKey(privateKeyHex);

  return withRetry(async () => {
    const client   = await makeTonClient(apiBase);
    const wallet   = WalletContractV4.create({ workchain: 0, publicKey });
    const contract = client.open(wallet);

    // Use non-bounceable, URL-safe format for response_destination
    const walletAddrStr = wallet.address.toString({ bounceable: false, urlSafe: true });

    const seqno = await contract.getSeqno();

    // USDT on TON uses 6 decimals
    const amountNano = BigInt(Math.round(parseFloat(amount) * 1e6));
    if (amountNano === 0n) throw new Error('Сумма USDT должна быть больше нуля');

    // Resolve sender's jetton wallet address on-chain
    const jettonMasterAddr = Address.parse(jettonMasterAddress);
    let jettonWalletAddr;
    try {
      const res = await client.runMethod(jettonMasterAddr, 'get_wallet_address', [
        { type: 'slice', cell: beginCell().storeAddress(wallet.address).endCell() },
      ]);
      jettonWalletAddr = res.stack.readAddress();
    } catch (e) {
      throw new Error(`Не удалось получить адрес jetton-кошелька: ${e.message}`);
    }

    // TEP-74 jetton transfer body
    // forward_ton_amount: 0.01 TON — safe minimum for notification forwarding
    const body = beginCell()
      .storeUint(0xf8a7ea5, 32)                       // op: jetton transfer
      .storeUint(0, 64)                                 // query_id
      .storeCoins(amountNano)                           // USDT amount (6 decimals)
      .storeAddress(Address.parse(to))                  // destination
      .storeAddress(Address.parse(walletAddrStr))       // response_destination (excess TON back)
      .storeBit(false)                                  // no custom_payload
      .storeCoins(toNano('0.01'))                       // forward_ton_amount (10M nanoton)
      .storeBit(false)                                  // forward_payload: empty inline
      .endCell();

    // 0.1 TON total gas: 0.01 forwarded + ~0.09 for jetton wallet execution
    await contract.sendTransfer({
      secretKey,
      seqno,
      messages: [
        internal({
          to:     jettonWalletAddr,
          value:  toNano('0.1'),
          bounce: true,
          body,
        }),
      ],
    });

    await new Promise(r => setTimeout(r, 5000));
    return `ton-jetton-seqno${seqno}-${Date.now()}`;
  }, 4, 3000);
}

// ─── LTC send via BlockCypher ─────────────────────────────────────────────────
async function sendLtc({ privateKeyHex, fromAddress, to, amount }) {
  const token      = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BLOCKCYPHER_TOKEN) || '';
  const tokenParam = token ? `?token=${token}` : '';
  const satoshis   = Math.round(parseFloat(amount) * 1e8);

  if (satoshis <= 0) throw new Error('Сумма LTC должна быть больше нуля');

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
    case 'ETH': return sendEvmNative({ privateKey, to, amount, chainKey: 'eth', fee });
    case 'BNB': return sendEvmNative({ privateKey, to, amount, chainKey: 'bnb', fee });
    case 'ARB': return sendEvmNative({ privateKey, to, amount, chainKey: 'arb', fee });
    case 'SOL': return sendSolNative({ privateKeyHex: privateKey, to, amount, fee });
    case 'TON': return sendTonNative({ privateKeyHex: privateKey, to, amount, apiBase: tonApiBase });
    case 'LTC': return sendLtc({ privateKeyHex: privateKey, fromAddress: from, to, amount });
    default: throw new Error(`Неподдерживаемый актив: ${sym}`);
  }
}
