/**
 * swapAggregator.js
 * Get quotes and execute token swaps across chains.
 *
 * SOL / SOL↔USDT  — Jupiter Aggregator v6 API (no key required)
 * ETH / BNB / ARB — KyberSwap Aggregator API (no key required)
 * TON / TON↔USDT  — Ston.fi v1 REST API (no key required)
 *
 * All amounts are in human-readable units (e.g. "1.5" SOL, "100" USDT).
 * Returns { txHash } on success, throws on failure.
 */

import { ethers } from 'ethers';

// ─── env helpers ─────────────────────────────────────────────────────────────
function env(key, fallback = '') {
  return (typeof import.meta !== 'undefined' && import.meta.env?.[key]) || fallback;
}

// ─── RPC URLs ─────────────────────────────────────────────────────────────────
const RPC = {
  eth: () => env('VITE_ETH_RPC', 'https://eth.llamarpc.com'),
  bnb: () => env('VITE_BNB_RPC', 'https://bsc-dataseed.binance.org'),
  arb: () => env('VITE_ARB_RPC', 'https://arb1.arbitrum.io/rpc'),
  sol: () => env('VITE_SOL_RPC', 'https://api.mainnet-beta.solana.com'),
};

// ─── KyberSwap chain slugs ────────────────────────────────────────────────────
const KYBER_CHAIN = { eth: 'ethereum', bnb: 'bsc', arb: 'arbitrum' };

// ─── Well-known token addresses ───────────────────────────────────────────────
const NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const USDT_EVM = {
  eth: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  bnb: '0x55d398326f99059fF775485246999027B3197955',
  arb: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
};

// SOL mint addresses
const SOL_NATIVE_MINT = 'So11111111111111111111111111111111111111112';
const USDT_SOL_MINT   = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// TON addresses
const TON_USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const STONFI_ROUTER   = 'EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt';
const PROXY_TON       = 'EQCM3B12QK1e4yZSf8GtBRT0aLMNyEsBc_9Qsof7cs3o63nT';

// ─── Jupiter (SOL) ────────────────────────────────────────────────────────────

async function jupiterQuote(inputMint, outputMint, amountLamports) {
  const url = new URL('https://quote-api.jup.ag/v6/quote');
  url.searchParams.set('inputMint', inputMint);
  url.searchParams.set('outputMint', outputMint);
  url.searchParams.set('amount', amountLamports.toString());
  url.searchParams.set('slippageBps', '50');
  url.searchParams.set('onlyDirectRoutes', 'false');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Jupiter quote failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function jupiterSwap({ fromSym, toSym, fromAmount, walletAddress, privateKeyHex }) {
  const { Connection, Keypair, VersionedTransaction } = await import('@solana/web3.js');

  const inputMint  = fromSym === 'SOL' ? SOL_NATIVE_MINT : USDT_SOL_MINT;
  const outputMint = toSym  === 'SOL' ? SOL_NATIVE_MINT : USDT_SOL_MINT;

  const inputDecimals = fromSym === 'SOL' ? 9 : 6;
  const amountSmallest = BigInt(Math.round(parseFloat(fromAmount) * 10 ** inputDecimals));

  const quote = await jupiterQuote(inputMint, outputMint, amountSmallest);

  const swapRes = await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: walletAddress,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  });
  if (!swapRes.ok) throw new Error(`Jupiter swap failed: ${swapRes.status} ${await swapRes.text()}`);
  const { swapTransaction } = await swapRes.json();

  const connection = new Connection(RPC.sol(), 'confirmed');
  const pkBytes = Buffer.from(privateKeyHex, 'hex');
  const keypair = Keypair.fromSecretKey(pkBytes);

  const txBuf = Buffer.from(swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([keypair]);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

// ─── KyberSwap (EVM) ─────────────────────────────────────────────────────────

async function kyberQuote({ chainSlug, fromToken, toToken, amountWei, walletAddress }) {
  const url = new URL(`https://aggregator-api.kyberswap.com/${chainSlug}/api/v1/routes`);
  url.searchParams.set('tokenIn', fromToken);
  url.searchParams.set('tokenOut', toToken);
  url.searchParams.set('amountIn', amountWei.toString());
  if (walletAddress) url.searchParams.set('to', walletAddress);

  const res = await fetch(url.toString(), {
    headers: { 'x-client-id': 'gemwallet-tma' },
  });
  if (!res.ok) throw new Error(`KyberSwap route failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`KyberSwap route error: ${data.message}`);
  return data.data;
}

async function kyberBuildSwap({ chainSlug, route, walletAddress, slippageBps = 50 }) {
  const res = await fetch(
    `https://aggregator-api.kyberswap.com/${chainSlug}/api/v1/route/build`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': 'gemwallet-tma',
      },
      body: JSON.stringify({
        routeSummary: route.routeSummary,
        sender: walletAddress,
        recipient: walletAddress,
        slippageTolerance: slippageBps,
        deadline: Math.floor(Date.now() / 1000) + 1200,
      }),
    }
  );
  if (!res.ok) throw new Error(`KyberSwap build failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`KyberSwap build error: ${data.message}`);
  return data.data;
}

async function kyberSwap({ network, fromSym, toSym, fromAmount, walletAddress, privateKeyHex }) {
  const chainSlug  = KYBER_CHAIN[network];
  const rpcUrl     = RPC[network]();

  const fromToken  = fromSym === 'USDT' ? USDT_EVM[network] : NATIVE_TOKEN;
  const toToken    = toSym   === 'USDT' ? USDT_EVM[network] : NATIVE_TOKEN;

  const fromDecimals = fromSym === 'USDT' ? 6 : 18;
  const amountWei = BigInt(Math.round(parseFloat(fromAmount) * 10 ** fromDecimals));

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet   = new ethers.Wallet(privateKeyHex, provider);

  // Get the route first
  const route = await kyberQuote({ chainSlug, fromToken, toToken, amountWei, walletAddress });

  // If swapping ERC-20 (USDT), approve KyberSwap router first
  if (fromSym === 'USDT') {
    const routerAddress = route.routerAddress;
    const erc20 = new ethers.Contract(fromToken, [
      'function approve(address spender, uint256 amount) returns (bool)',
      'function allowance(address owner, address spender) view returns (uint256)',
    ], wallet);

    const allowance = await erc20.allowance(walletAddress, routerAddress);
    if (allowance < amountWei) {
      const approveTx = await erc20.approve(routerAddress, ethers.MaxUint256);
      await approveTx.wait(1);
    }
  }

  // Build calldata
  const built = await kyberBuildSwap({ chainSlug, route, walletAddress });

  const tx = await wallet.sendTransaction({
    to:       built.routerAddress,
    data:     built.data,
    value:    BigInt(built.value || '0'),
    gasLimit: BigInt(Math.ceil(Number(built.gas) * 1.2)),
  });
  await tx.wait(1);
  return tx.hash;
}

// ─── Ston.fi v1 (TON) ────────────────────────────────────────────────────────
// Correctly builds swap messages following the Ston.fi v1 contract spec.
// TON→USDT: send ton_transfer to pTON proxy → router performs swap
// USDT→TON: send jetton transfer from user wallet to router with swap payload

async function getTonJettonWallet(tonRpc, tonApiKey, ownerAddress, jettonMasterAddress) {
  const headers = tonApiKey ? { 'X-API-Key': tonApiKey } : {};
  const res = await fetch(
    `${tonRpc}/getWalletAddress?owner_address=${encodeURIComponent(ownerAddress)}&jetton_master_address=${encodeURIComponent(jettonMasterAddress)}`,
    { headers }
  );
  if (!res.ok) throw new Error(`getWalletAddress failed: ${res.status}`);
  const json = await res.json();
  if (!json.result) throw new Error(`No wallet address returned for owner=${ownerAddress}`);
  return json.result;
}

async function stonfiSwap({ fromSym, toSym, fromAmount, walletAddress, privateKeyHex }) {
  const { TonClient, WalletContractV4, internal, beginCell, Address, toNano } = await import('@ton/ton');

  const tonRpc    = env('VITE_TON_RPC', 'https://toncenter.com/api/v2');
  const tonApiKey = env('VITE_TON_API_KEY', '');

  const client = new TonClient({
    endpoint: `${tonRpc}/jsonRPC`,
    apiKey: tonApiKey || undefined,
  });

  // NaCl secret key format: [32-byte private key | 32-byte public key] = 64 bytes total
  const secretKeyBytes = Buffer.from(privateKeyHex, 'hex');
  if (secretKeyBytes.length < 64) {
    throw new Error('TON private key must be 64 bytes (NaCl format). Re-open the app to reload your keys.');
  }
  const publicKey = secretKeyBytes.slice(32); // public key is the second 32 bytes

  const walletContract = WalletContractV4.create({ workchain: 0, publicKey });
  const contract = client.open(walletContract);
  const seqno    = await contract.getSeqno();

  const offerDecimals = fromSym === 'TON' ? 9 : 6;
  const offerAmount   = BigInt(Math.round(parseFloat(fromAmount) * 10 ** offerDecimals));
  // 5% slippage tolerance for safety
  const minAskAmount  = (offerAmount * 95n) / 100n;

  let transferMsg;

  if (fromSym === 'TON') {
    // ── TON → USDT ──────────────────────────────────────────────────────────
    // Correct flow: ton_transfer → pTON proxy → router.swap → USDT to user
    //
    // The swap forward payload tells the router:
    //   - which jetton wallet to send ask tokens FROM (router's USDT wallet)
    //   - minimum amount accepted
    //   - who receives the output

    // 1. Get the Ston.fi router's USDT jetton wallet address
    const routerUsdtWallet = await getTonJettonWallet(tonRpc, tonApiKey, STONFI_ROUTER, TON_USDT_MASTER);

    // 2. Build the swap payload (forwarded to router by pTON proxy)
    const swapPayload = beginCell()
      .storeUint(0x25938561, 32)                      // op: swap
      .storeUint(0, 64)                                // query_id
      .storeAddress(Address.parse(routerUsdtWallet))  // router's USDT wallet (ask token destination)
      .storeCoins(minAskAmount)                        // min_out
      .storeAddress(Address.parse(walletAddress))     // receiver address (user)
      .storeBit(0)                                     // no referral address
      .endCell();

    // 3. Build ton_transfer message body for pTON proxy
    const body = beginCell()
      .storeUint(0x01f3835d, 32)                   // op: ton_transfer
      .storeUint(0, 64)                             // query_id
      .storeCoins(offerAmount)                      // ton_amount (the actual swap amount, excl. gas)
      .storeAddress(Address.parse(walletAddress))  // refund_address (if swap fails, return here)
      .storeBit(1)                                  // forward_payload present (as ref cell)
      .storeRef(swapPayload)
      .endCell();

    // 4. Send to pTON proxy (NOT to the router directly!)
    // Total value = swap amount + gas for TON wrapping + router execution (~0.3 TON)
    transferMsg = internal({
      to:     PROXY_TON,
      value:  toNano(String(parseFloat(fromAmount) + 0.3)),
      bounce: true,
      body,
    });

  } else {
    // ── USDT → TON ──────────────────────────────────────────────────────────
    // Correct flow: jetton transfer from user USDT wallet → router.swap → TON to user
    //
    // The swap payload's "to_address" must be the router's pTON wallet address.

    // 1. Get user's USDT jetton wallet address
    const userUsdtWallet = await getTonJettonWallet(tonRpc, tonApiKey, walletAddress, TON_USDT_MASTER);

    // 2. Get the Ston.fi router's pTON jetton wallet address
    //    (required as the "ask" destination in the swap payload)
    let routerPtonWallet;
    try {
      routerPtonWallet = await getTonJettonWallet(tonRpc, tonApiKey, STONFI_ROUTER, PROXY_TON);
    } catch (_) {
      // Fallback: use known Ston.fi v1 router pTON wallet on mainnet
      routerPtonWallet = PROXY_TON;
    }

    // 3. Build the swap forward payload
    const swapPayload = beginCell()
      .storeUint(0x25938561, 32)                       // op: swap
      .storeUint(0, 64)                                 // query_id
      .storeAddress(Address.parse(routerPtonWallet))   // router's pTON wallet (ask token)
      .storeCoins(minAskAmount)                         // min_out
      .storeAddress(Address.parse(walletAddress))      // receiver address (user)
      .storeBit(0)                                      // no referral
      .endCell();

    // 4. Build jetton transfer message body
    const body = beginCell()
      .storeUint(0xf8a7ea5, 32)                      // op: jetton transfer
      .storeUint(0, 64)                               // query_id
      .storeCoins(offerAmount)                        // amount to transfer (USDT)
      .storeAddress(Address.parse(STONFI_ROUTER))    // destination: router
      .storeAddress(Address.parse(walletAddress))    // response_destination: user (for excess gas return)
      .storeBit(0)                                    // no custom_payload
      .storeCoins(toNano('0.25'))                     // forward_ton_amount (gas for router execution)
      .storeBit(1)                                    // forward_payload present (as ref cell)
      .storeRef(swapPayload)
      .endCell();

    // 5. Send from user's USDT jetton wallet to the router
    transferMsg = internal({
      to:     userUsdtWallet,  // ← user's USDT jetton wallet (not the master contract!)
      value:  toNano('0.35'),  // gas: 0.25 forwarded to router + 0.1 for jetton transfer
      bounce: true,
      body,
    });
  }

  // Submit the transaction
  await contract.sendTransfer({
    seqno,
    secretKey: secretKeyBytes,
    messages: [transferMsg],
  });

  // TON SDK doesn't return a tx hash synchronously.
  // Return a trackable identifier: user can check their wallet on tonviewer.com
  return `ton-seqno-${seqno}-${Date.now()}`;
}

// ─── Ston.fi quote via simulation API ────────────────────────────────────────

async function stonfiQuote(fromSym, fromAmount) {
  try {
    const offerAddr = fromSym === 'TON' ? PROXY_TON      : TON_USDT_MASTER;
    const askAddr   = fromSym === 'TON' ? TON_USDT_MASTER : PROXY_TON;
    const decimals  = fromSym === 'TON' ? 9 : 6;
    const units     = Math.round(parseFloat(fromAmount) * 10 ** decimals);

    const res = await fetch(
      `https://api.ston.fi/v1/swap/simulate?offer_address=${encodeURIComponent(offerAddr)}&ask_address=${encodeURIComponent(askAddr)}&units=${units}&slippage_tolerance=0.01`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return null;
    const data = await res.json();

    if (data.ask_units) {
      const askDecimals  = fromSym === 'TON' ? 6 : 9;
      const toAmount     = (Number(data.ask_units) / 10 ** askDecimals).toFixed(6);
      const rate         = (parseFloat(toAmount) / parseFloat(fromAmount)).toFixed(4);
      return { toAmount, rate };
    }
  } catch (e) {
    console.warn('[stonfiQuote]', e.message);
  }
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get a swap quote (output amount estimate).
 */
export async function getSwapQuote({ fromSym, toSym, networkId, fromAmount }) {
  if (!fromAmount || parseFloat(fromAmount) <= 0) return { toAmount: '0', rate: '0' };

  try {
    if (networkId === 'sol') {
      const inputMint      = fromSym === 'SOL' ? SOL_NATIVE_MINT : USDT_SOL_MINT;
      const outputMint     = toSym   === 'SOL' ? SOL_NATIVE_MINT : USDT_SOL_MINT;
      const inputDecimals  = fromSym === 'SOL' ? 9 : 6;
      const outputDecimals = toSym   === 'SOL' ? 9 : 6;
      const amountSmallest = BigInt(Math.round(parseFloat(fromAmount) * 10 ** inputDecimals));
      const quote = await jupiterQuote(inputMint, outputMint, amountSmallest);
      const toAmount = (Number(quote.outAmount) / 10 ** outputDecimals).toFixed(6);
      const rate = (parseFloat(toAmount) / parseFloat(fromAmount)).toFixed(4);
      return { toAmount, rate };
    }

    if (networkId === 'ton') {
      const result = await stonfiQuote(fromSym, fromAmount);
      if (result) return result;
      return { toAmount: '—', rate: '—' };
    }

    // EVM — KyberSwap
    const chainSlug      = KYBER_CHAIN[networkId];
    const fromToken      = fromSym === 'USDT' ? USDT_EVM[networkId] : NATIVE_TOKEN;
    const toToken        = toSym   === 'USDT' ? USDT_EVM[networkId] : NATIVE_TOKEN;
    const fromDecimals   = fromSym === 'USDT' ? 6 : 18;
    const outputDecimals = toSym   === 'USDT' ? 6 : 18;
    const amountWei      = BigInt(Math.round(parseFloat(fromAmount) * 10 ** fromDecimals));

    const route    = await kyberQuote({ chainSlug, fromToken, toToken, amountWei });
    const toAmount = (Number(route.routeSummary.amountOut) / 10 ** outputDecimals).toFixed(6);
    const rate     = (parseFloat(toAmount) / parseFloat(fromAmount)).toFixed(4);
    return { toAmount, rate };
  } catch (err) {
    console.warn('[swapAggregator] quote error:', err.message);
    return { toAmount: '0', rate: '0' };
  }
}

/**
 * Execute a swap.
 */
export async function executeSwap({ fromSym, toSym, networkId, fromAmount, walletAddress, privateKeyHex }) {
  if (!walletAddress) throw new Error('Адрес кошелька не найден');
  if (!privateKeyHex) throw new Error('Приватный ключ недоступен — разблокируйте кошелёк');
  if (!fromAmount || parseFloat(fromAmount) <= 0) throw new Error('Введите корректную сумму');

  let txHash;

  switch (networkId) {
    case 'sol':
      txHash = await jupiterSwap({ fromSym, toSym, fromAmount, walletAddress, privateKeyHex });
      break;

    case 'ton':
      txHash = await stonfiSwap({ fromSym, toSym, fromAmount, walletAddress, privateKeyHex });
      break;

    case 'eth':
    case 'bnb':
    case 'arb':
      txHash = await kyberSwap({ network: networkId, fromSym, toSym, fromAmount, walletAddress, privateKeyHex });
      break;

    default:
      throw new Error(`Сеть не поддерживается: ${networkId}`);
  }

  return { txHash };
}
