import { ethers } from 'ethers';
import { fetchBtcUtxos } from './balanceFetcher.js';

const EVM_RPCS = {
  ETH: 'https://eth.llamarpc.com',
  BNB: 'https://bsc-dataseed.binance.org',
  ARB: 'https://arb1.arbitrum.io/rpc',
};

const CHAIN_IDS = {
  ETH: 1,
  BNB: 56,
  ARB: 42161,
};

const USDT_CONTRACTS = {
  ETH: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  BNB: '0x55d398326f99059fF775485246999027B3197955',
  ARB: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
};

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

export async function sendEvmTx(privateKey, chainSymbol, to, amountStr, feeMultiplier = 1.0) {
  const rpc = EVM_RPCS[chainSymbol];
  if (!rpc) throw new Error(`Сеть ${chainSymbol} не поддерживается`);

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(privateKey, provider);
  const amount = ethers.parseEther(String(amountStr));
  const feeData = await provider.getFeeData();

  const gasPrice = BigInt(Math.floor(Number(feeData.gasPrice) * feeMultiplier));

  const tx = {
    to,
    value: amount,
    gasLimit: 21000n,
    gasPrice,
    chainId: CHAIN_IDS[chainSymbol],
  };

  const txResponse = await wallet.sendTransaction(tx);
  return txResponse.hash;
}

export async function sendUsdtErc20Tx(privateKey, chainSymbol, to, amountStr, feeMultiplier = 1.0) {
  const rpc = EVM_RPCS[chainSymbol];
  const contractAddr = USDT_CONTRACTS[chainSymbol];
  if (!rpc || !contractAddr) throw new Error(`USDT на ${chainSymbol} не поддерживается`);

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(contractAddr, ERC20_ABI, wallet);

  const decimals = await contract.decimals();
  const amount = ethers.parseUnits(String(amountStr), decimals);
  const feeData = await provider.getFeeData();
  const gasPrice = BigInt(Math.floor(Number(feeData.gasPrice) * feeMultiplier));

  const txResponse = await contract.transfer(to, amount, { gasPrice });
  return txResponse.hash;
}

export async function getEvmFeeEstimate(chainSymbol) {
  try {
    const rpc = EVM_RPCS[chainSymbol];
    if (!rpc) return null;
    const provider = new ethers.JsonRpcProvider(rpc);
    const feeData = await provider.getFeeData();
    const baseGwei = Number(feeData.gasPrice) / 1e9;
    const gasLimit = 21000;
    const baseFeeNative = (baseGwei * gasLimit) / 1e9;
    return {
      slow:   { native: (baseFeeNative * 0.8).toFixed(8),   usd: (baseFeeNative * 0.8 * 2200).toFixed(4)   },
      normal: { native: (baseFeeNative * 1.0).toFixed(8),   usd: (baseFeeNative * 1.0 * 2200).toFixed(4)   },
      fast:   { native: (baseFeeNative * 1.3).toFixed(8),   usd: (baseFeeNative * 1.3 * 2200).toFixed(4)   },
      gasPrice: feeData.gasPrice,
    };
  } catch {
    return {
      slow:   { native: '0.00005', usd: '0.10' },
      normal: { native: '0.00010', usd: '0.22' },
      fast:   { native: '0.00013', usd: '0.29' },
      gasPrice: 0n,
    };
  }
}

export async function sendSolTx(privateKey, to, amountStr) {
  const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, Keypair } =
    await import('@solana/web3.js');

  const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

  let secretKey;
  if (typeof privateKey === 'string') {
    const hex = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
    secretKey = Uint8Array.from(Buffer.from(hex, 'hex'));
  } else {
    secretKey = privateKey;
  }

  const keypair = Keypair.fromSecretKey(secretKey);
  const toPublicKey = new PublicKey(to);
  const lamports = Math.floor(parseFloat(amountStr) * LAMPORTS_PER_SOL);

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: toPublicKey,
      lamports,
    })
  );

  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = keypair.publicKey;

  const signature = await connection.sendTransaction(transaction, [keypair]);
  return signature;
}

export async function sendTonTx(mnemonic, to, amountStr) {
  const { TonClient, WalletContractV4, internal, toNano } = await import('@ton/ton');
  const { mnemonicToPrivateKey } = await import('@ton/crypto');

  const client = new TonClient({
    endpoint: 'https://toncenter.com/api/v2/jsonRPC',
  });

  const words = typeof mnemonic === 'string' ? mnemonic.split(' ') : mnemonic;
  const keyPair = await mnemonicToPrivateKey(words);
  const wallet = WalletContractV4.create({ publicKey: keyPair.publicKey, workchain: 0 });
  const contract = client.open(wallet);
  const seqno = await contract.getSeqno();

  await contract.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [
      internal({
        to,
        value: toNano(String(amountStr)),
        bounce: false,
      }),
    ],
  });

  return `ton-tx-${Date.now()}`;
}

// ─── Bitcoin send via @scure/btc-signer ──────────────────────────────────────

/**
 * Estimate BTC fee for a simple P2WPKH → P2WPKH transaction.
 * Typical segwit tx: ~141 vBytes for 1-in-2-out.
 * @param {number} feeRateSatVb  sat/vByte
 * @returns {number}  fee in satoshis
 */
export function estimateBtcFee(inputCount, feeRateSatVb) {
  // P2WPKH: overhead=10, input=68 vB, output=31 vB (2 outputs: to + change)
  const vsize = 10 + inputCount * 68 + 2 * 31;
  return Math.ceil(vsize * feeRateSatVb);
}

/**
 * Send BTC using @scure/btc-signer.
 * @param {string} privateKeyHex  32-byte hex private key (with or without 0x)
 * @param {string} fromAddress    sender's bc1q... address
 * @param {string} toAddress      recipient address
 * @param {number} amountBtc      amount to send in BTC
 * @param {number} feeRateSatVb   fee rate in sat/vByte
 * @returns {Promise<string>}     txid
 */
export async function sendBtcTx(privateKeyHex, fromAddress, toAddress, amountBtc, feeRateSatVb = 10) {
  const { p2wpkh, Transaction } = await import('@scure/btc-signer');
  const { hex: hexCodec } = await import('@scure/base');

  const privKeyHex = privateKeyHex.startsWith('0x') ? privateKeyHex.slice(2) : privateKeyHex;
  const privKeyBytes = hexCodec.decode(privKeyHex);

  const amountSats = Math.round(amountBtc * 1e8);

  // Fetch UTXOs
  const utxos = await fetchBtcUtxos(fromAddress);
  if (!utxos || utxos.length === 0) {
    throw new Error('Нет доступных UTXO для отправки');
  }

  // Sort UTXOs by value descending
  const sorted = [...utxos].sort((a, b) => b.value - a.value);

  // Coin selection: pick UTXOs until we have enough for amount + fee
  const selectedUtxos = [];
  let totalInput = 0;
  let fee = estimateBtcFee(1, feeRateSatVb);

  for (const utxo of sorted) {
    selectedUtxos.push(utxo);
    totalInput += utxo.value;
    fee = estimateBtcFee(selectedUtxos.length, feeRateSatVb);
    if (totalInput >= amountSats + fee) break;
  }

  if (totalInput < amountSats + fee) {
    const availBtc = (totalInput / 1e8).toFixed(8);
    throw new Error(`Недостаточно средств. Доступно: ${availBtc} BTC (включая комиссию)`);
  }

  const change = totalInput - amountSats - fee;

  // Build P2WPKH payment descriptor for the sender address
  const payment = p2wpkh(privKeyBytes, undefined, { network: 'mainnet' });

  // Build transaction
  const tx = new Transaction({ allowUnknownOutputs: true });

  // Fetch raw transactions for each UTXO input
  for (const utxo of selectedUtxos) {
    const rawRes = await fetch(`https://mempool.space/api/tx/${utxo.txid}/hex`);
    if (!rawRes.ok) throw new Error(`Не удалось получить транзакцию ${utxo.txid}`);
    const rawHex = await rawRes.text();
    const rawBytes = hexCodec.decode(rawHex.trim());

    tx.addInput({
      txid:         utxo.txid,
      index:        utxo.vout,
      witnessUtxo:  { script: payment.script, amount: BigInt(utxo.value) },
      nonWitnessUtxo: rawBytes,
    });
  }

  // Output: recipient
  tx.addOutputAddress(toAddress, BigInt(amountSats));

  // Output: change (if any, above dust ~546 sats)
  if (change > 546) {
    tx.addOutputAddress(fromAddress, BigInt(change));
  }

  // Sign all inputs
  tx.sign(privKeyBytes);
  tx.finalize();

  const txHex = hexCodec.encode(tx.extract());

  // Broadcast via mempool.space
  const broadcastRes = await fetch('https://mempool.space/api/tx', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: txHex,
  });

  if (!broadcastRes.ok) {
    const errText = await broadcastRes.text();
    throw new Error(`Ошибка трансляции: ${errText}`);
  }

  const txid = await broadcastRes.text();
  return txid.trim();
}

/**
 * Get BTC fee estimate in BTC and USD.
 * @returns {Promise<{ slow, normal, fast }>}
 */
export async function getBtcFeeEstimate(btcPriceUsd = 95000) {
  try {
    const res = await fetch('https://mempool.space/api/v1/fees/recommended');
    const data = await res.json();
    const rates = {
      slow:   data.hourFee       || 5,
      normal: data.halfHourFee   || 10,
      fast:   data.fastestFee    || 20,
    };
    const makeFee = (satVb) => {
      const feeSats = estimateBtcFee(1, satVb);
      const feeBtc  = feeSats / 1e8;
      const feeUsd  = (feeBtc * btcPriceUsd).toFixed(2);
      return { native: feeBtc.toFixed(8), usd: feeUsd, satVb };
    };
    return {
      slow:   makeFee(rates.slow),
      normal: makeFee(rates.normal),
      fast:   makeFee(rates.fast),
    };
  } catch {
    return {
      slow:   { native: '0.00001500', usd: '1.43', satVb: 5  },
      normal: { native: '0.00002960', usd: '2.81', satVb: 10 },
      fast:   { native: '0.00005920', usd: '5.62', satVb: 20 },
    };
  }
}
