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

// ─── Safe amount string — prevents NUMERIC_FAULT from JS float precision ─────
function safeAmtStr(n, decimals = 8) {
  return parseFloat(n).toFixed(decimals);
}

// ─── EVM native send ──────────────────────────────────────────────────────────
async function sendEvmNative({ privateKey, to, amount, chainId, rpcUrl, fee }) {
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
}

// ─── ERC-20 token send ────────────────────────────────────────────────────────
async function sendErc20({ privateKey, contractAddress, to, amount, rpcUrl, fee }) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(contractAddress, ERC20_TRANSFER_ABI, wallet);
  const decimals = await contract.decimals();
  const parsed = ethers.parseUnits(safeAmtStr(amount, Math.min(Number(decimals), 8)), decimals);
  const txOptions = {};
  if (fee && fee > 0) {
    txOptions.gasPrice = ethers.parseUnits(String(fee), 'gwei');
  }
  const tx = await contract.transfer(to, parsed, txOptions);
  await tx.wait(1);
  return tx.hash;
}

// ─── Solana native send ───────────────────────────────────────────────────────
// FIX: must set recentBlockhash + feePayer; ComputeBudgetProgram is a static class (no `new`)
async function sendSolNative({ privateKeyHex, to, amount, rpcUrl, fee }) {
  const {
    Connection, PublicKey, SystemProgram, Transaction, Keypair, ComputeBudgetProgram,
  } = await import('@solana/web3.js');

  const conn = new Connection(rpcUrl, 'confirmed');
  const secretKey = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'));
  const keypair = Keypair.fromSecretKey(secretKey);
  const lamports = Math.round(amount * 1e9);

  const tx = new Transaction();

  // Priority fee: ComputeBudgetProgram.setComputeUnitPrice is a static method — no `new`
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

  // Required fields before sendTransaction
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = keypair.publicKey;

  const sig = await conn.sendTransaction(tx, [keypair], { skipPreflight: false });
  await conn.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    'confirmed'
  );
  return sig;
}

// ─── Solana SPL (USDT) send ───────────────────────────────────────────────────
// FIX: must set recentBlockhash + feePayer
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
  const secretKey = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'));
  const payer = Keypair.fromSecretKey(secretKey);
  const mint = new PublicKey(mintAddress);
  const toPublicKey = new PublicKey(to);

  const mintInfo = await getMint(conn, mint);
  const amountRaw = BigInt(Math.round(amount * 10 ** mintInfo.decimals));

  const fromAta = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
  const toAta = await getOrCreateAssociatedTokenAccount(conn, payer, mint, toPublicKey);

  const tx = new Transaction();

  if (fee && fee > 0) {
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: fee }));
  }

  tx.add(createTransferInstruction(fromAta.address, toAta.address, payer.publicKey, amountRaw));

  // Required fields
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;

  const sig = await conn.sendTransaction(tx, [payer], { skipPreflight: false });
  await conn.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    'confirmed'
  );
  return sig;
}

// ─── TON native send ──────────────────────────────────────────────────────────
async function sendTonNative({ privateKeyHex, to, amount, apiBase }) {
  const { TonClient, WalletContractV4, internal, toNano } = await import('@ton/ton');

  const apiKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TON_API_KEY) || '';
  const client = new TonClient({
    endpoint: `${apiBase}/jsonRPC`,
    apiKey: apiKey || undefined,
  });

  // NaCl key layout: [32-byte signing key | 32-byte public key] = 64 bytes total
  const secretKey = Buffer.from(privateKeyHex, 'hex');
  if (secretKey.length < 64) {
    throw new Error(`TON private key must be 64 bytes (got ${secretKey.length}). Re-open the app.`);
  }
  const publicKey = secretKey.slice(32);

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

  // Give the TON node time to process before the caller refreshes balances
  await new Promise(resolve => setTimeout(resolve, 5000));
  return `ton-tx-seqno${seqno}-${Date.now()}`;
}

// ─── TON Jetton (USDT) send ───────────────────────────────────────────────────
// FIX: correct TEP-74 forward_payload encoding; sufficient gas; explicit seqno
async function sendTonJetton({ privateKeyHex, to, amount, jettonMasterAddress, apiBase }) {
  const { TonClient, WalletContractV4, internal, toNano, Address, beginCell } =
    await import('@ton/ton');

  const apiKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TON_API_KEY) || '';
  const client = new TonClient({
    endpoint: `${apiBase}/jsonRPC`,
    apiKey: apiKey || undefined,
  });

  // NaCl key: [32-byte signing key | 32-byte public key] = 64 bytes total
  const secretKey = Buffer.from(privateKeyHex, 'hex');
  if (secretKey.length < 64) {
    throw new Error(`TON private key must be 64 bytes (got ${secretKey.length}). Re-open the app.`);
  }
  const publicKey = secretKey.slice(32);

  const wallet = WalletContractV4.create({ workchain: 0, publicKey });
  const contract = client.open(wallet);
  const seqno = await contract.getSeqno();

  // USDT uses 6 decimals on TON
  const amountNano = BigInt(Math.round(amount * 1e6));

  // TEP-74 jetton transfer message body
  // forward_payload bit=false → inline (empty), no ref cell attached
  const body = beginCell()
    .storeUint(0xf8a7ea5, 32)  // op: jetton transfer
    .storeUint(0, 64)           // query_id
    .storeCoins(amountNano)     // amount of USDT (in nanoUSDT)
    .storeAddress(Address.parse(to))                         // destination address
    .storeAddress(Address.parse(wallet.address.toString()))  // response_destination (gas refund)
    .storeBit(false)             // no custom_payload
    .storeCoins(1n)              // forward_ton_amount (1 nanoton, minimal notification)
    .storeBit(false)             // forward_payload: inline, empty
    .endCell();

  // Look up sender's jetton wallet address on-chain
  const jettonMasterAddr = Address.parse(jettonMasterAddress);
  const getWalletRes = await client.runMethod(jettonMasterAddr, 'get_wallet_address', [
    { type: 'slice', cell: beginCell().storeAddress(wallet.address).endCell() },
  ]);
  const jettonWalletAddr = getWalletRes.stack.readAddress();

  // 0.07 TON is the standard gas amount for a jetton transfer
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

  await new Promise(resolve => setTimeout(resolve, 5000));
  return `ton-jetton-seqno${seqno}-${Date.now()}`;
}

// ─── LTC send via BlockCypher ─────────────────────────────────────────────────
async function sendLtc({ privateKeyHex, fromAddress, to, amount }) {
  const token = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BLOCKCYPHER_TOKEN) || '';
  const tokenParam = token ? `?token=${token}` : '';
  const satoshis = Math.round(amount * 1e8);

  // Let BlockCypher auto-calculate fees (do not override)
  const newTxBody = {
    inputs:  [{ addresses: [fromAddress] }],
    outputs: [{ addresses: [to], value: satoshis }],
  };

  const newTxRes = await fetch(
    `https://api.blockcypher.com/v1/ltc/main/txs/new${tokenParam}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTxBody),
    }
  );
  if (!newTxRes.ok) {
    const errText = await newTxRes.text();
    throw new Error(`BlockCypher new tx: ${newTxRes.status} — ${errText}`);
  }
  const newTx = await newTxRes.json();
  if (newTx.errors && newTx.errors.length > 0) throw new Error(newTx.errors[0].error);
  if (!newTx.tosign || newTx.tosign.length === 0) {
    throw new Error('BlockCypher вернул пустой список хешей для подписи');
  }

  // Sign each input hash with secp256k1 — DER-encode for BlockCypher
  const privHex = privateKeyHex.startsWith('0x') ? privateKeyHex : '0x' + privateKeyHex;
  const sk = new ethers.SigningKey(privHex);

  const signatures = newTx.tosign.map((hashHex) => {
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

  const sendRes = await fetch(
    `https://api.blockcypher.com/v1/ltc/main/txs/send${tokenParam}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...newTx,
        signatures,
        pubkeys: newTx.tosign.map(() => pubKeyHex),
      }),
    }
  );
  if (!sendRes.ok) {
    const errText = await sendRes.text();
    throw new Error(`BlockCypher send: ${sendRes.status} — ${errText}`);
  }
  const sent = await sendRes.json();
  if (sent.errors && sent.errors.length > 0) throw new Error(sent.errors[0].error);
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

  // ── USDT routing ────────────────────────────────────────────────────────────
  if (sym === 'USDT') {
    const net = (networkId || 'eth').toLowerCase();
    switch (net) {
      case 'eth': return sendErc20({ privateKey, contractAddress: USDT_CONTRACTS.eth, to, amount, rpcUrl: CHAIN_RPC.eth(), fee });
      case 'bnb': return sendErc20({ privateKey, contractAddress: USDT_CONTRACTS.bnb, to, amount, rpcUrl: CHAIN_RPC.bnb(), fee });
      case 'arb': return sendErc20({ privateKey, contractAddress: USDT_CONTRACTS.arb, to, amount, rpcUrl: CHAIN_RPC.arb(), fee });
      case 'sol': return sendSolSpl({ privateKeyHex: privateKey, to, amount, mintAddress: USDT_SOL_MINT,   rpcUrl: CHAIN_RPC.sol(), fee });
      case 'ton': return sendTonJetton({ privateKeyHex: privateKey, to, amount, jettonMasterAddress: USDT_TON_MASTER, apiBase: CHAIN_RPC.ton() });
      default: throw new Error(`Неизвестная сеть для USDT: ${net}`);
    }
  }

  // ── Native asset routing ─────────────────────────────────────────────────────
  switch (sym) {
    case 'ETH': return sendEvmNative({ privateKey, to, amount, chainId: 1,     rpcUrl: CHAIN_RPC.eth(), fee });
    case 'BNB': return sendEvmNative({ privateKey, to, amount, chainId: 56,    rpcUrl: CHAIN_RPC.bnb(), fee });
    case 'ARB': return sendEvmNative({ privateKey, to, amount, chainId: 42161, rpcUrl: CHAIN_RPC.arb(), fee });
    case 'SOL': return sendSolNative({ privateKeyHex: privateKey, to, amount, rpcUrl: CHAIN_RPC.sol(), fee });
    case 'TON': return sendTonNative({ privateKeyHex: privateKey, to, amount, apiBase: CHAIN_RPC.ton() });
    case 'LTC': return sendLtc({ privateKeyHex: privateKey, fromAddress: from, to, amount });
    default: throw new Error(`Неподдерживаемый актив: ${sym}`);
  }
}
