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
  eth: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // Mainnet USDT
  bnb: '0x55d398326f99059fF775485246999027B3197955', // BSC Mainnet USDT
  arb: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // Arbitrum One USDT
};
// ─── RPC resolver ─────────────────────────────────────────────────────────────
function rpc(key, fallback) {
  return (typeof import.meta !== 'undefined' && import.meta.env?.[key]) || fallback;
}
const CHAIN_RPC = {
  eth: () => rpc('VITE_ETH_RPC', 'https://eth.llamarpc.com'),
  bnb: () => rpc('VITE_BNB_RPC', 'https://bsc-dataseed.binance.org'),
  arb: () => rpc('VITE_ARB_RPC', 'https://arb1.arbitrum.io/rpc'),
  sol: () => rpc('VITE_SOL_RPC', 'https://api.mainnet-beta.solana.com'),
  ton: () => rpc('VITE_TON_RPC', 'https://toncenter.com/api/v2'),
};
// ─── Safe amount string — prevents NUMERIC_FAULT from JS float precision ────
// Uses toFixed(8) so we never pass scientific notation or >18 decimals to ethers
function safeAmtStr(n, decimals = 8) {
  return parseFloat(n).toFixed(decimals);
}
// ─── Safe TON amount string — prevents scientific notation in toNano() ───────
function safeTonStr(n) {
  const num = parseFloat(n);
  if (!isFinite(num) || num <= 0) throw new Error('Invalid TON amount: ' + n);
  // toNano() requires a decimal string, never scientific notation
  return num.toFixed(9);
}
// ─── Normalize EVM private key — ensure 0x prefix ────────────────────────────
function normalizeEvmKey(key) {
  if (!key) throw new Error('EVM private key is missing');
  const s = String(key).trim();
  return s.startsWith('0x') ? s : '0x' + s;
}
// ─── EVM native send ──────────────────────────────────────────────────────────
async function sendEvmNative({ privateKey, to, amount, chainId, rpcUrl, fee }) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(normalizeEvmKey(privateKey), provider);
  const txData = {
    to,
    value: ethers.parseEther(safeAmtStr(amount)),
    chainId,
  };
  // fee is in gwei, convert to wei
  if (fee && fee > 0) {
    txData.gasPrice = ethers.parseUnits(safeAmtStr(fee, 2), 'gwei');
  }
  const tx = await wallet.sendTransaction(txData);
  await tx.wait(1);
  return tx.hash;
}
// ─── ERC-20 token send ────────────────────────────────────────────────────────
async function sendErc20({ privateKey, contractAddress, to, amount, rpcUrl, fee }) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(normalizeEvmKey(privateKey), provider);
  const contract = new ethers.Contract(contractAddress, ERC20_TRANSFER_ABI, wallet);
  const decimals = await contract.decimals();
  // Use the token's own decimal precision (USDT=6, most ERC-20=18) but cap at 8 for input
  const parsed = ethers.parseUnits(safeAmtStr(amount, Math.min(Number(decimals), 8)), decimals);
  const txOptions = {};
  // fee is in gwei, convert to wei
  if (fee && fee > 0) {
    txOptions.gasPrice = ethers.parseUnits(safeAmtStr(fee, 2), 'gwei');
  }
  const tx = await contract.transfer(to, parsed, txOptions);
  await tx.wait(1);
  return tx.hash;
}
// ─── Solana native send ───────────────────────────────────────────────────────
async function sendSolNative({ privateKeyHex, to, amount, rpcUrl, fee }) {
  const {
    Connection, PublicKey, SystemProgram, Transaction, Keypair, ComputeBudgetProgram,
  } = await import('@solana/web3.js');

  const conn = new Connection(rpcUrl, 'confirmed');

  // Normalize key: strip 0x if present, then decode 64-byte secret key
  const keyHex = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  const secretKey = Uint8Array.from(Buffer.from(keyHex, 'hex'));
  const keypair = Keypair.fromSecretKey(secretKey);

  const lamports = Math.round(parseFloat(amount) * 1e9);

  const tx = new Transaction();

  // Priority fee (must be added BEFORE other instructions)
  if (fee && fee > 0) {
    tx.add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.round(fee) })
    );
  }

  tx.add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new PublicKey(to),
      lamports,
    })
  );

  // Required: set recentBlockhash and feePayer before sending
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = keypair.publicKey;

  const sig = await conn.sendTransaction(tx, [keypair], { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}
// ─── Solana SPL (USDT) send ───────────────────────────────────────────────────
async function sendSolSpl({ privateKeyHex, to, amount, mintAddress, rpcUrl, fee }) {
  const {
    Connection, PublicKey, Transaction, Keypair, ComputeBudgetProgram,
  } = await import('@solana/web3.js');
  const {
    getOrCreateAssociatedTokenAccount,
    createTransferInstruction,
    getMint,
  } = await import('@solana/spl-token');

  const conn = new Connection(rpcUrl, 'confirmed');

  // Normalize key
  const keyHex = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  const secretKey = Uint8Array.from(Buffer.from(keyHex, 'hex'));
  const payer = Keypair.fromSecretKey(secretKey);

  const mint = new PublicKey(mintAddress);
  const toPublicKey = new PublicKey(to);
  const mintInfo = await getMint(conn, mint);
  const amountRaw = BigInt(Math.round(parseFloat(amount) * 10 ** mintInfo.decimals));

  const fromAta = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
  const toAta = await getOrCreateAssociatedTokenAccount(conn, payer, mint, toPublicKey);

  const tx = new Transaction();

  // Priority fee (must be added first)
  if (fee && fee > 0) {
    tx.add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.round(fee) })
    );
  }

  tx.add(createTransferInstruction(fromAta.address, toAta.address, payer.publicKey, amountRaw));

  // Required: set recentBlockhash and feePayer
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;

  const sig = await conn.sendTransaction(tx, [payer], { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}

// ─── TON endpoint lists ───────────────────────────────────────────────────────
// TonClient4 endpoints (v4 protocol — no API key required, most reliable)
const TON_V4_ENDPOINTS = [
  'https://mainnet-v4.tonhubapi.com',
  'https://mainnet.tonhubapi.com',
];
// TonClient v2 endpoints (fallback)
const TON_V2_ENDPOINTS = [
  'https://toncenter.com/api/v2/jsonRPC',
  'https://ton-mainnet.core.chainstack.com/jsonRPC',
];
function isTonNetworkError(msg) {
  return (
    msg.includes('401') || msg.includes('402') || msg.includes('404') ||
    msg.includes('429') || msg.includes('500') || msg.includes('502') ||
    msg.includes('503') || msg.includes('504') ||
    msg.includes('fetch') || msg.includes('network') || msg.includes('Network') ||
    msg.includes('ECONNREFUSED') || msg.includes('timeout') || msg.includes('Failed to fetch') ||
    msg.includes('Request failed') || msg.includes('socket') || msg.includes('CORS')
  );
}
// ─── TON native send ──────────────────────────────────────────────────────────
async function sendTonNative({ privateKeyHex, to, amount }) {
  const { TonClient, TonClient4, WalletContractV4, internal, toNano } = await import('@ton/ton');
  const apiKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TON_API_KEY) || '';

  const keyHex = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  const secretKey = Buffer.from(keyHex, 'hex');
  const publicKey = secretKey.slice(32);

  const tonValue = safeTonStr(amount);
  let lastError;

  // ── Try TonClient4 first (v4 API, no API key needed, most reliable) ────────
  for (const endpoint of TON_V4_ENDPOINTS) {
    try {
      const client = new TonClient4({ endpoint });
      const wallet = WalletContractV4.create({ workchain: 0, publicKey });
      const contract = client.open(wallet);
      const seqno = await contract.getSeqno();
      await contract.sendTransfer({
        secretKey,
        seqno,
        messages: [internal({ to, value: toNano(tonValue), bounce: false })],
      });
      return `ton-tx-${Date.now()}`;
    } catch (e) {
      lastError = e;
      const msg = String(e?.message || e?.toString() || '');
      if (!isTonNetworkError(msg)) break;
    }
  }

  // ── Fallback: TonClient v2 ────────────────────────────────────────────────
  for (const endpoint of TON_V2_ENDPOINTS) {
    try {
      const client = new TonClient({ endpoint, apiKey: apiKey || undefined });
      const wallet = WalletContractV4.create({ workchain: 0, publicKey });
      const contract = client.open(wallet);
      const rawSeqno = await contract.getSeqno();
      const seqno = typeof rawSeqno === 'number' ? rawSeqno : 0;
      await contract.sendTransfer({
        secretKey,
        seqno,
        messages: [internal({ to, value: toNano(tonValue), bounce: false })],
      });
      return `ton-tx-${Date.now()}`;
    } catch (e) {
      lastError = e;
      const msg = String(e?.message || e?.toString() || '');
      if (!isTonNetworkError(msg)) break;
    }
  }

  throw lastError;
}
// ─── TON Jetton (USDT) send ───────────────────────────────────────────────────
async function sendTonJetton({ privateKeyHex, to, amount, jettonMasterAddress }) {
  const { TonClient, TonClient4, WalletContractV4, internal, toNano, Address, beginCell } =
    await import('@ton/ton');
  const apiKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TON_API_KEY) || '';

  const keyHex = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  const secretKey = Buffer.from(keyHex, 'hex');
  const publicKey = secretKey.slice(32);

  const amountNano = BigInt(Math.round(parseFloat(amount) * 1e6)); // USDT 6 decimals
  const gasValue = '0.1'; // TON gas for jetton transfer

  let lastError;

  async function tryJettonSend(client) {
    const wallet = WalletContractV4.create({ workchain: 0, publicKey });
    const contract = client.open(wallet);
    const rawSeqno = await contract.getSeqno();
    const seqno = typeof rawSeqno === 'number' ? rawSeqno : 0;
    const body = beginCell()
      .storeUint(0xf8a7ea5, 32)
      .storeUint(0, 64)
      .storeCoins(amountNano)
      .storeAddress(Address.parse(to))
      .storeAddress(Address.parse(wallet.address.toString()))
      .storeBit(false)
      .storeCoins(toNano('0.01'))
      .storeBit(false)
      .endCell();
    const jettonMaster = Address.parse(jettonMasterAddress);
    const result = await client.runMethod(jettonMaster, 'get_wallet_address', [
      { type: 'slice', cell: beginCell().storeAddress(wallet.address).endCell() },
    ]);
    const jettonWalletAddr = result.stack.readAddress();
    await contract.sendTransfer({
      secretKey,
      seqno,
      messages: [internal({ to: jettonWalletAddr, value: toNano(gasValue), bounce: true, body })],
    });
    return `ton-jetton-tx-${Date.now()}`;
  }

  // Try TonClient4 first
  for (const endpoint of TON_V4_ENDPOINTS) {
    try {
      return await tryJettonSend(new TonClient4({ endpoint }));
    } catch (e) {
      lastError = e;
      const msg = String(e?.message || e?.toString() || '');
      if (!isTonNetworkError(msg)) break;
    }
  }

  // Fallback to v2
  for (const endpoint of TON_V2_ENDPOINTS) {
    try {
      return await tryJettonSend(new TonClient({ endpoint, apiKey: apiKey || undefined }));
    } catch (e) {
      lastError = e;
      const msg = String(e?.message || e?.toString() || '');
      if (!isTonNetworkError(msg)) break;
    }
  }

  throw lastError;
}
// ─── LTC send via BlockCypher ─────────────────────────────────────────────────
async function sendLtc({ privateKeyHex, fromAddress, to, amount, fee }) {
  const token = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BLOCKCYPHER_TOKEN) || '';
  const tokenParam = token ? `?token=${token}` : '';
  const satoshis = Math.round(parseFloat(amount) * 1e8);
  // fee is in satoshis - will be used if > 0, otherwise auto-calculated by BlockCypher
  // 1. Create unsigned transaction skeleton
  const newTxBody = {
    inputs: [{ addresses: [fromAddress] }],
    outputs: [{ addresses: [to], value: satoshis }],
  };
  if (fee && fee > 0) newTxBody.fees = Math.round(fee);
  const newTxRes = await fetch(`https://api.blockcypher.com/v1/ltc/main/txs/new${tokenParam}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newTxBody),
  });
  if (!newTxRes.ok) {
    const errText = await newTxRes.text();
    throw new Error(`BlockCypher new tx error: ${errText}`);
  }
  const newTx = await newTxRes.json();
  if (newTx.errors && newTx.errors.length > 0) throw new Error(newTx.errors[0].error);
  if (!newTx.tosign || newTx.tosign.length === 0) throw new Error('BlockCypher returned no tosign hashes');
  // 2. Sign each input hash with secp256k1 via ethers SigningKey
  const sk = new ethers.SigningKey(
    privateKeyHex.startsWith('0x') ? privateKeyHex : '0x' + privateKeyHex
  );
  const signatures = newTx.tosign.map((hashHex) => {
    const sig = sk.sign('0x' + hashHex);
    // Manually DER-encode the signature for BlockCypher
    const r = sig.r.slice(2).padStart(64, '0');
    const s = sig.s.slice(2).padStart(64, '0');
    // Prepend 0x00 if high bit set (to avoid negative interpretation)
    const rPad = parseInt(r.slice(0, 2), 16) >= 0x80 ? '00' + r : r;
    const sPad = parseInt(s.slice(0, 2), 16) >= 0x80 ? '00' + s : s;
    const rLen = (rPad.length / 2).toString(16).padStart(2, '0');
    const sLen = (sPad.length / 2).toString(16).padStart(2, '0');
    const inner = `02${rLen}${rPad}02${sLen}${sPad}`;
    const totalLen = (inner.length / 2).toString(16).padStart(2, '0');
    return `30${totalLen}${inner}`;
  });
  // Compressed public key (remove 0x prefix)
  const pubKeyHex = sk.compressedPublicKey.slice(2);
  // 3. Send signed transaction
  const sendRes = await fetch(`https://api.blockcypher.com/v1/ltc/main/txs/send${tokenParam}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...newTx,
      signatures,
      pubkeys: newTx.tosign.map(() => pubKeyHex),
    }),
  });
  if (!sendRes.ok) {
    const errText = await sendRes.text();
    throw new Error(`BlockCypher send error: ${errText}`);
  }
  const sent = await sendRes.json();
  if (sent.errors && sent.errors.length > 0) throw new Error(sent.errors[0].error);
  return sent.tx?.hash || `ltc-tx-${Date.now()}`;
}
function hexToBytes(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return b;
}
// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Send a transaction on any supported chain.
 *
 * @param {Object} params
 * @param {string} params.sym        Asset symbol: 'ETH','BNB','ARB','SOL','TON','LTC','USDT'
 * @param {string} params.networkId  For USDT: 'eth','bnb','arb','sol','ton'
 * @param {string} params.from       Sender address
 * @param {string} params.to         Recipient address
 * @param {number} params.amount     Amount in human units (e.g. 0.5 ETH)
 * @param {string} params.privateKey Private key hex (EVM/LTC) or 64-byte hex (SOL/TON)
 * @param {number} params.fee        Fee in small units (gwei for EVM, micro-lamports for SOL, nanoton for TON, sat for LTC)
 * @returns {Promise<string>} Transaction hash / signature
 */
export async function sendTransaction({ sym, networkId, from, to, amount, privateKey, fee }) {
  if (!privateKey) throw new Error('Private key not available — re-derive wallet first');
  if (!to || !to.trim()) throw new Error('Recipient address is required');
  if (!amount || parseFloat(amount) <= 0) throw new Error('Amount must be greater than 0');

  // ── USDT routing ────────────────────────────────────────────────────────────
  if (sym === 'USDT') {
    const net = (networkId || 'eth').toLowerCase();
    if (net === 'eth') return sendErc20({ privateKey, contractAddress: USDT_CONTRACTS.eth, to, amount, rpcUrl: CHAIN_RPC.eth(), fee });
    if (net === 'bnb') return sendErc20({ privateKey, contractAddress: USDT_CONTRACTS.bnb, to, amount, rpcUrl: CHAIN_RPC.bnb(), fee });
    if (net === 'arb') return sendErc20({ privateKey, contractAddress: USDT_CONTRACTS.arb, to, amount, rpcUrl: CHAIN_RPC.arb(), fee });
    if (net === 'sol') return sendSolSpl({ privateKeyHex: privateKey, to, amount, mintAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', rpcUrl: CHAIN_RPC.sol(), fee });
    if (net === 'ton') return sendTonJetton({ privateKeyHex: privateKey, to, amount, jettonMasterAddress: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', apiBase: CHAIN_RPC.ton(), fee });
    throw new Error(`Unknown USDT network: ${net}`);
  }
  // ── Native asset routing ─────────────────────────────────────────────────────
  if (sym === 'ETH') return sendEvmNative({ privateKey, to, amount, chainId: 1, rpcUrl: CHAIN_RPC.eth(), fee });
  if (sym === 'BNB') return sendEvmNative({ privateKey, to, amount, chainId: 56, rpcUrl: CHAIN_RPC.bnb(), fee });
  if (sym === 'ARB') return sendEvmNative({ privateKey, to, amount, chainId: 42161, rpcUrl: CHAIN_RPC.arb(), fee });
  if (sym === 'SOL') return sendSolNative({ privateKeyHex: privateKey, to, amount, rpcUrl: CHAIN_RPC.sol(), fee });
  if (sym === 'TON') return sendTonNative({ privateKeyHex: privateKey, to, amount, apiBase: CHAIN_RPC.ton(), fee });
  if (sym === 'LTC') return sendLtc({ privateKeyHex: privateKey, fromAddress: from, to, amount, fee });
  throw new Error(`Unsupported asset: ${sym}`);
}
