import React from 'react';
import { TOKEN_ICONS, CHAIN_BADGE } from '../assets/tokenIcons';

interface TokenIconProps {
  tokenId: string;  // e.g. "ETH", "USDT_ETH", "BNB"
  size?: number;    // default 40
}

export function TokenIcon({ tokenId, size = 40 }: TokenIconProps) {
  const badgeSize = Math.round(size * 0.42); // ~16px when size=40
  const MainIcon = TOKEN_ICONS[tokenId];
  const badgeKey = CHAIN_BADGE[tokenId];
  const BadgeIcon = badgeKey ? TOKEN_ICONS[badgeKey] : null;

  // Fallback: grey circle with first letter
  const Fallback = () => (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <circle cx="20" cy="20" r="20" fill="#2C2C2E"/>
      <text x="20" y="26" textAnchor="middle" fill="#8E8E93" 
            fontSize="16" fontWeight="600" fontFamily="-apple-system, sans-serif">
        {tokenId ? tokenId[0] : '?'}
      </text>
    </svg>
  );

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {MainIcon ? <MainIcon size={size} /> : <Fallback />}

      {BadgeIcon && (
        <div style={{
          position: 'absolute',
          bottom: -2,
          right: -2,
          width: badgeSize,
          height: badgeSize,
          borderRadius: '50%',
          border: '2px solid #1C1C1E',
          overflow: 'hidden',
          backgroundColor: '#1C1C1E',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <BadgeIcon size={badgeSize} />
        </div>
      )}
    </div>
  );
}
