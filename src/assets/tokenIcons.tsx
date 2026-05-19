import React from 'react';

import btcPng  from './coins/BTC.png';
import bnbPng  from './coins/BNB.png';
import arbPng  from './coins/ARB.png';
import solPng  from './coins/SOL.png';
import tonPng  from './coins/TON.png';

export type IconComponent = React.FC<{ size?: number }>;

// ─── PNG-based icons ──────────────────────────────────────────────────────────
const makePngIcon = (src: string): IconComponent =>
  ({ size = 40 }) => (
    <img
      src={src}
      width={size}
      height={size}
      style={{ borderRadius: '50%', display: 'block', objectFit: 'cover' }}
      alt=""
    />
  );

export const BtcIcon = makePngIcon(btcPng);
export const BnbIcon = makePngIcon(bnbPng);
export const ArbIcon = makePngIcon(arbPng);
export const SolIcon = makePngIcon(solPng);
export const TonIcon = makePngIcon(tonPng);

// ─── SVG-based icons ──────────────────────────────────────────────────────────

export const EthIcon: IconComponent = ({ size = 40 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="20" fill="#627EEA"/>
    <path d="M20 7 L20 16.5 L27.5 20 Z" fill="white" fillOpacity="0.6"/>
    <path d="M20 7 L12.5 20 L20 16.5 Z" fill="white"/>
    <path d="M20 16.5 L27.5 20 L20 24 Z" fill="white" fillOpacity="0.6"/>
    <path d="M20 24 L12.5 20 L20 16.5 Z" fill="white"/>
    <path d="M20 25.5 L27.5 21.5 L20 33 Z" fill="white" fillOpacity="0.6"/>
    <path d="M20 33 L12.5 21.5 L20 25.5 Z" fill="white"/>
  </svg>
);

export const LtcIcon: IconComponent = ({ size = 40 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="20" fill="#345D9D"/>
    <text x="20" y="28" textAnchor="middle" fill="white" fontSize="22" fontWeight="bold" fontFamily="Arial">Ł</text>
  </svg>
);

export const UsdtIcon: IconComponent = ({ size = 40 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="20" fill="#26A17B"/>
    <rect x="13" y="11" width="14" height="3.5" rx="1.75" fill="white"/>
    <rect x="18.5" y="14" width="3" height="15" fill="white"/>
    <rect x="13" y="20" width="14" height="3" rx="1.5" fill="white" fillOpacity="0.9"/>
  </svg>
);

// ─── Icon map ─────────────────────────────────────────────────────────────────
export const TOKEN_ICONS: Record<string, IconComponent> = {
  BTC:      BtcIcon,
  ETH:      EthIcon,
  LTC:      LtcIcon,
  TON:      TonIcon,
  BNB:      BnbIcon,
  SOL:      SolIcon,
  ARB:      ArbIcon,
  USDT:     UsdtIcon,
  USDT_ETH: UsdtIcon,
  USDT_BNB: UsdtIcon,
  USDT_SOL: UsdtIcon,
  USDT_TON: UsdtIcon,
  USDT_ARB: UsdtIcon,
};

// Which chain badge to show on token
export const CHAIN_BADGE: Record<string, string> = {
  ARB:      'ETH',
  USDT_ETH: 'ETH',
  USDT_BNB: 'BNB',
  USDT_SOL: 'SOL',
  USDT_TON: 'TON',
  USDT_ARB: 'ARB',
};
