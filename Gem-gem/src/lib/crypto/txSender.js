import { ethers } from 'ethers';

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
