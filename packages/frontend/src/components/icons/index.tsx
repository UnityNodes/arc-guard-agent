// Custom branded SVG icons for GuardAgent

export function GuardShieldIcon({ size = 24, className = '' }: { size?: number; className?: string }) {
  const id = 'sg';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
      <defs>
        <linearGradient id={`${id}a`} x1="4" y1="2" x2="28" y2="31" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a78bfa" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      {/* Shield body filled */}
      <path d="M16 2L4 7v9c0 7.18 5.16 13.89 12 15.5C22.84 29.89 28 23.18 28 16V7L16 2z"
        fill={`url(#${id}a)`} opacity="0.25" />
      {/* Shield outline */}
      <path d="M16 2L4 7v9c0 7.18 5.16 13.89 12 15.5C22.84 29.89 28 23.18 28 16V7L16 2z"
        stroke={`url(#${id}a)`} strokeWidth="1.8" strokeLinejoin="round" fill="none" />
      {/* Vertical line */}
      <line x1="16" y1="9" x2="16" y2="15" stroke={`url(#${id}a)`} strokeWidth="1.6" strokeLinecap="round" />
      {/* Horizontal line */}
      <line x1="12.5" y1="12" x2="19.5" y2="12" stroke={`url(#${id}a)`} strokeWidth="1.6" strokeLinecap="round" />
      {/* Center dot */}
      <circle cx="16" cy="19" r="2.5" fill={`url(#${id}a)`} />
      {/* Corner dots */}
      <circle cx="12.5" cy="12" r="1" fill={`url(#${id}a)`} />
      <circle cx="19.5" cy="12" r="1" fill={`url(#${id}a)`} />
    </svg>
  );
}

let aiBotCounter = 0;
export function AIBotIcon({ size = 24, className = '' }: { size?: number; className?: string }) {
  const id = `ab${++aiBotCounter}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
      <defs>
        <linearGradient id={`${id}g`} x1="3" y1="4" x2="29" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a78bfa" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      {/* Body */}
      <rect x="6" y="10" width="20" height="16" rx="4" fill={`url(#${id}g)`} opacity="0.3" stroke={`url(#${id}g)`} strokeWidth="1.8" />
      {/* Eyes */}
      <circle cx="11.5" cy="18" r="2.2" fill={`url(#${id}g)`} />
      <circle cx="20.5" cy="18" r="2.2" fill={`url(#${id}g)`} />
      {/* Eye shine */}
      <circle cx="12.3" cy="17.2" r="0.7" fill="white" opacity="0.8" />
      <circle cx="21.3" cy="17.2" r="0.7" fill="white" opacity="0.8" />
      {/* Mouth */}
      <path d="M12.5 23.5h7" stroke={`url(#${id}g)`} strokeWidth="1.8" strokeLinecap="round" />
      {/* Antenna */}
      <line x1="16" y1="10" x2="16" y2="6" stroke={`url(#${id}g)`} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="4.5" r="1.8" fill={`url(#${id}g)`} />
      {/* Ears */}
      <line x1="6" y1="17" x2="3.5" y2="17" stroke={`url(#${id}g)`} strokeWidth="1.8" strokeLinecap="round" />
      <line x1="26" y1="17" x2="28.5" y2="17" stroke={`url(#${id}g)`} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function WalletPortfolioIcon({ size = 24, className = '' }: { size?: number; className?: string }) {
  const id = 'wp';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
      <defs>
        <linearGradient id={`${id}a`} x1="3" y1="5" x2="29" y2="27" gradientUnits="userSpaceOnUse">
          <stop stopColor="#67e8f9" />
          <stop offset="1" stopColor="#60a5fa" />
        </linearGradient>
      </defs>
      {/* Main body */}
      <rect x="3" y="9" width="26" height="17" rx="3.5" fill={`url(#${id}a)`} opacity="0.2" stroke={`url(#${id}a)`} strokeWidth="1.8" />
      {/* Divider line */}
      <line x1="3" y1="14.5" x2="29" y2="14.5" stroke={`url(#${id}a)`} strokeWidth="1.5" />
      {/* Inner card/chip */}
      <rect x="20" y="17.5" width="7" height="5.5" rx="1.5" fill={`url(#${id}a)`} opacity="0.5" />
      <circle cx="23.5" cy="20.2" r="1.1" fill="white" opacity="0.9" />
      {/* Top flap */}
      <path d="M8 6h12a2.5 2.5 0 012.5 2.5V9H5.5V8.5A2.5 2.5 0 018 6z" fill={`url(#${id}a)`} opacity="0.4" />
    </svg>
  );
}

export function ZapCircleIcon({ size = 24, className = '' }: { size?: number; className?: string }) {
  const id = 'zc';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
      <defs>
        <linearGradient id={`${id}a`} x1="3" y1="3" x2="29" y2="29" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fde68a" />
          <stop offset="1" stopColor="#fb923c" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="13" fill={`url(#${id}a)`} opacity="0.15" stroke={`url(#${id}a)`} strokeWidth="1.8" />
      <path d="M18.5 7.5l-6 9.5H17l-1.5 7.5 6.5-10H17.5l1-7z" fill={`url(#${id}a)`} />
    </svg>
  );
}

export function NetworkNodeIcon({ size = 24, className = '' }: { size?: number; className?: string }) {
  const id = 'nn';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className}>
      <defs>
        <linearGradient id={`${id}a`} x1="3" y1="3" x2="29" y2="29" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f9a8d4" />
          <stop offset="1" stopColor="#c084fc" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="4" fill={`url(#${id}a)`} />
      <circle cx="6" cy="8" r="3" fill={`url(#${id}a)`} opacity="0.7" />
      <circle cx="26" cy="8" r="3" fill={`url(#${id}a)`} opacity="0.7" />
      <circle cx="6" cy="24" r="3" fill={`url(#${id}a)`} opacity="0.7" />
      <circle cx="26" cy="24" r="3" fill={`url(#${id}a)`} opacity="0.7" />
      <line x1="8.5" y1="9.8" x2="13.5" y2="13.5" stroke={`url(#${id}a)`} strokeWidth="1.4" opacity="0.8" />
      <line x1="23.5" y1="9.8" x2="18.5" y2="13.5" stroke={`url(#${id}a)`} strokeWidth="1.4" opacity="0.8" />
      <line x1="8.5" y1="22.2" x2="13.5" y2="18.5" stroke={`url(#${id}a)`} strokeWidth="1.4" opacity="0.8" />
      <line x1="23.5" y1="22.2" x2="18.5" y2="18.5" stroke={`url(#${id}a)`} strokeWidth="1.4" opacity="0.8" />
    </svg>
  );
}
