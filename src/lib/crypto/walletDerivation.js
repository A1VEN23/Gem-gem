/**
 * walletDerivation.js
 * Real BIP39 mnemonic generation + HD key derivation for all supported chains.
 * Chains: ETH, BNB, ARB (EVM m/44'/60'/0'/0/0), SOL (ed25519 m/44'/501'/0'/0'),
 *         TON (@ton/crypto mnemonicToPrivateKey), LTC (m/44'/2'/0'/0/0 P2PKH),
 *         BTC (m/84'/0'/0'/0/0 native SegWit P2WPKH, bc1q...).
 *
 * Private keys are NEVER persisted — callers must hold them in memory only.
 */

import * as bip39 from 'bip39';
import { HDNodeWallet, ethers } from 'ethers';
import bs58 from 'bs58';
import RIPEMD160 from 'ripemd160';

// ─── TON: lazy-loaded to avoid SSR issues ────────────────────────────────────
let _tonCrypto = null;
async function getTonCrypto() {
  if (!_tonCrypto) _tonCrypto = await import('@ton/crypto');
  return _tonCrypto;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hexToBytes(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function sha256Bytes(data) {
  const hex = ethers.sha256(data instanceof Uint8Array ? data : new Uint8Array(data));
  return hexToBytes(hex);
}

// ─── RIPEMD-160 via npm package (pure JS, browser-compatible) ─────────────────
function ripemd160(data) {
  const buf = Buffer.from(data);
  const result = new RIPEMD160().update(buf).digest();
  return new Uint8Array(result);
}

// ─── LTC P2PKH address encoder ────────────────────────────────────────────────
function ltcP2PKH(pubKeyBytes) {
  const hash160 = ripemd160(sha256Bytes(pubKeyBytes));
  const versioned = new Uint8Array(21);
  versioned[0] = 0x30;
  versioned.set(hash160, 1);
  const checksum = sha256Bytes(sha256Bytes(versioned)).slice(0, 4);
  const full = new Uint8Array(25);
  full.set(versioned);
  full.set(checksum, 21);
  return bs58.encode(full);
}

// ─── BTC native SegWit P2WPKH (bech32) ───────────────────────────────────────
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values) {
  let c = 1;
  for (const v of values) {
    const c0 = c >>> 25;
    c = ((c & 0x1ffffff) << 5) ^ v;
    if (c0 & 1)  c ^= 0x3b6a57b2;
    if (c0 & 2)  c ^= 0x26508e6d;
    if (c0 & 4)  c ^= 0x1ea119fa;
    if (c0 & 8)  c ^= 0x3d4233dd;
    if (c0 & 16) c ^= 0x2a1462b3;
  }
  return c;
}

function bech32HrpExpand(hrp) {
  const ret = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

function bech32CreateChecksum(hrp, data) {
  const values = bech32HrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const polymod = bech32Polymod(values) ^ 1;
  const ret = [];
  for (let i = 0; i < 6; i++) ret.push((polymod >>> (5 * (5 - i))) & 31);
  return ret;
}

function bech32Encode(hrp, data) {
  const checksum = bech32CreateChecksum(hrp, data);
  const combined = data.concat(checksum);
  return hrp + '1' + combined.map(d => BECH32_CHARSET[d]).join('');
}

function convertBits(data, fromBits, toBits, pad = true) {
  let acc = 0, bits = 0;
  const result = [];
  const maxv = (1 << toBits) - 1;
  for (const v of data) {
    acc = (acc << fromBits) | v;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) result.push((acc << (toBits - bits)) & maxv);
  return result;
}

function btcP2WPKHAddress(pubKeyBytes) {
  const hash160 = ripemd160(sha256Bytes(pubKeyBytes));
  const words = convertBits(Array.from(hash160), 8, 5);
  return bech32Encode('bc', [0].concat(words));
}

// ─── Compressed secp256k1 public key from private key hex ────────────────────
// ethers v6: SigningKey.compressedPublicKey returns 33-byte compressed key as hex
function compressedPubKey(privKeyHex) {
  const sk = new ethers.SigningKey(privKeyHex);
  return hexToBytes(sk.compressedPublicKey);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function generateMnemonic() {
  return bip39.generateMnemonic(128);
}

export function validateMnemonic(phrase) {
  return bip39.validateMnemonic(phrase.trim().toLowerCase());
}

export async function deriveWallet(mnemonicOrWords) {
  const phrase = Array.isArray(mnemonicOrWords)
    ? mnemonicOrWords.join(' ')
    : mnemonicOrWords;

  const seed = await bip39.mnemonicToSeed(phrase.trim());
  const seedBytes = seed instanceof Uint8Array ? seed : new Uint8Array(seed);

  const root = HDNodeWallet.fromSeed(seedBytes);
  const addresses = {};
  const privateKeys = {};

  // ── EVM chains (ETH, BNB, ARB share same derivation path) ──────────────────
  const evmPath = "m/44'/60'/0'/0/0";
  const evmChild = root.derivePath(evmPath);
  const evmAddress = evmChild.address;
  const evmPrivKey = evmChild.privateKey;

  addresses.ETH = evmAddress;
  addresses.BNB = evmAddress;
  addresses.ARB = evmAddress;
  privateKeys.ETH = evmPrivKey;
  privateKeys.BNB = evmPrivKey;
  privateKeys.ARB = evmPrivKey;

  // ── Bitcoin (m/84'/0'/0'/0/0 native SegWit P2WPKH, bc1q...) ────────────────
  try {
    const btcPath = "m/84'/0'/0'/0/0";
    const btcChild = root.derivePath(btcPath);
    const btcPrivHex = btcChild.privateKey;
    const pubKey = compressedPubKey(btcPrivHex);
    addresses.BTC = btcP2WPKHAddress(pubKey);
    privateKeys.BTC = btcPrivHex;
  } catch (e) {
    console.warn('BTC derivation failed:', e.message);
    addresses.BTC = null;
    privateKeys.BTC = null;
  }

  // ── Solana (ed25519, m/44'/501'/0'/0') ─────────────────────────────────────
  try {
    const { Keypair } = await import('@solana/web3.js');
    const { HDKey } = await import('@scure/bip32');
    const hdKey = HDKey.fromMasterSeed(seedBytes);
    const solChild = hdKey.derive("m/44'/501'/0'/0'");
    const solKeypair = Keypair.fromSeed(solChild.privateKey.slice(0, 32));
    addresses.SOL = solKeypair.publicKey.toBase58();
    privateKeys.SOL = Buffer.from(solKeypair.secretKey).toString('hex');
  } catch (e) {
    console.warn('SOL derivation failed:', e.message);
    addresses.SOL = null;
    privateKeys.SOL = null;
  }

  // ── TON (mnemonicToPrivateKey from @ton/crypto) ─────────────────────────────
  try {
    const { mnemonicToPrivateKey } = await getTonCrypto();
    const { WalletContractV4 } = await import('@ton/ton');
    const words = phrase.trim().split(/\s+/);
    const tonKeyPair = await mnemonicToPrivateKey(words);
    const tonWallet = WalletContractV4.create({
      workchain: 0,
      publicKey: tonKeyPair.publicKey,
    });
    addresses.TON = tonWallet.address.toString({ bounceable: false, urlSafe: true });
    privateKeys.TON = Buffer.from(tonKeyPair.secretKey).toString('hex');
  } catch (e) {
    console.warn('TON derivation failed:', e.message);
    addresses.TON = null;
    privateKeys.TON = null;
  }

  // ── LTC (m/44'/2'/0'/0/0, P2PKH with version byte 0x30) ───────────────────
  try {
    const ltcPath = "m/44'/2'/0'/0/0";
    const ltcChild = root.derivePath(ltcPath);
    const ltcPrivHex = ltcChild.privateKey;
    const pubKey = compressedPubKey(ltcPrivHex);
    addresses.LTC = ltcP2PKH(pubKey);
    privateKeys.LTC = ltcPrivHex;
  } catch (e) {
    console.warn('LTC derivation failed:', e.message);
    addresses.LTC = null;
    privateKeys.LTC = null;
  }

  // ── TRX / Tron (m/44'/195'/0'/0/0, Base58Check with 0x41 prefix) ───────────
  // ethers v6 computes ETH-style address (last 20 bytes of keccak256) internally.
  // TRX address = same 20 bytes but with 0x41 prefix + Base58Check instead of hex.
  try {
    const trxPath = "m/44'/195'/0'/0/0";
    const trxChild = root.derivePath(trxPath);
    const trxPrivHex = trxChild.privateKey;
    // trxChild.address → "0x" + 40 hex chars (20 bytes, ethers-computed correctly)
    const ethAddr = trxChild.address; // e.g. "0xAbCd..."
    const raw20 = hexToBytes(ethAddr); // 20 bytes
    const versioned = new Uint8Array(21);
    versioned[0] = 0x41;
    versioned.set(raw20, 1);
    const checksum = sha256Bytes(sha256Bytes(versioned)).slice(0, 4);
    const full = new Uint8Array(25);
    full.set(versioned);
    full.set(checksum, 21);
    addresses.TRX = bs58.encode(full);
    privateKeys.TRX = trxPrivHex;
  } catch (e) {
    console.warn('TRX derivation failed:', e.message);
    addresses.TRX = null;
    privateKeys.TRX = null;
  }

  return { addresses, privateKeys };
}

export async function getPrivateKey(mnemonicOrWords, chain) {
  const { privateKeys } = await deriveWallet(mnemonicOrWords);
  return privateKeys[chain] || null;
}
