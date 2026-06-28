'use client';

import React from 'react';

interface IconProps {
  size?: number;
  stroke?: number;
  style?: React.CSSProperties;
  className?: string;
}

const Icon = ({ size = 16, stroke = 1.6, children, style, className }: IconProps & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth={stroke}
       strokeLinecap="round" strokeLinejoin="round" style={style} className={className}>
    {children}
  </svg>
);

export const IconDashboard = (p: IconProps) => <Icon {...p}><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></Icon>;
export const IconWallet = (p: IconProps) => <Icon {...p}><path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M3 9h14a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H3"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/></Icon>;
export const IconBridge = (p: IconProps) => <Icon {...p}><path d="M3 8c3-4 6-4 9 0s6 4 9 0"/><path d="M3 8v8"/><path d="M21 8v8"/><path d="M3 16h18"/></Icon>;
export const IconFx = (p: IconProps) => <Icon {...p}><path d="M4 7h13l-3-3"/><path d="M20 17H7l3 3"/></Icon>;
export const IconAlert = (p: IconProps) => <Icon {...p}><path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6Z"/><path d="M10 19a2 2 0 0 0 4 0"/></Icon>;
export const IconOrders = (p: IconProps) => <Icon {...p}><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h16"/><circle cx="18" cy="12" r="2"/></Icon>;
export const IconTreasury = (p: IconProps) => <Icon {...p}><path d="M3 9 12 4l9 5"/><path d="M5 9v9"/><path d="M19 9v9"/><path d="M9 18v-6"/><path d="M15 18v-6"/><path d="M3 20h18"/></Icon>;
export const IconChat = (p: IconProps) => <Icon {...p}><path d="M21 12a8 8 0 0 1-12.4 6.7L4 20l1.3-4.6A8 8 0 1 1 21 12Z"/></Icon>;
export const IconSettings = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></Icon>;
export const IconArrowRight = (p: IconProps) => <Icon {...p}><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></Icon>;
export const IconArrowUp = (p: IconProps) => <Icon {...p}><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></Icon>;
export const IconArrowDown = (p: IconProps) => <Icon {...p}><path d="M12 5v14"/><path d="m18 13-6 6-6-6"/></Icon>;
export const IconPlus = (p: IconProps) => <Icon {...p}><path d="M12 5v14"/><path d="M5 12h14"/></Icon>;
export const IconClose = (p: IconProps) => <Icon {...p}><path d="M6 6 18 18"/><path d="M18 6 6 18"/></Icon>;
export const IconCheck = (p: IconProps) => <Icon {...p}><path d="m5 12 5 5L20 7"/></Icon>;
export const IconCopy = (p: IconProps) => <Icon {...p}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></Icon>;
export const IconExternal = (p: IconProps) => <Icon {...p}><path d="M7 7h10v10"/><path d="M7 17 17 7"/></Icon>;
export const IconShield = (p: IconProps) => <Icon {...p}><path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4Z"/></Icon>;
export const IconSwap = (p: IconProps) => <Icon {...p}><path d="M7 4v16"/><path d="m3 8 4-4 4 4"/><path d="M17 20V4"/><path d="m21 16-4 4-4-4"/></Icon>;
export const IconZap = (p: IconProps) => <Icon {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/></Icon>;
export const IconPause = (p: IconProps) => <Icon {...p}><rect x="7" y="5" width="3" height="14" rx="1"/><rect x="14" y="5" width="3" height="14" rx="1"/></Icon>;
export const IconChevronRight = (p: IconProps) => <Icon {...p}><path d="m9 6 6 6-6 6"/></Icon>;
export const IconChevronDown = (p: IconProps) => <Icon {...p}><path d="m6 9 6 6 6-6"/></Icon>;
export const IconSearch = (p: IconProps) => <Icon {...p}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></Icon>;
export const IconBell = (p: IconProps) => <Icon {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></Icon>;
export const IconDownload = (p: IconProps) => <Icon {...p}><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 19h16"/></Icon>;
export const IconUser = (p: IconProps) => <Icon {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></Icon>;
export const IconBuilding = (p: IconProps) => <Icon {...p}><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h1"/><path d="M14 7h1"/><path d="M9 11h1"/><path d="M14 11h1"/><path d="M9 15h1"/><path d="M14 15h1"/><path d="M10 21v-4h4v4"/></Icon>;
export const IconSun = (p: IconProps) => <Icon {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/></Icon>;
export const IconMoon = (p: IconProps) => <Icon {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></Icon>;
export const IconSparkle = (p: IconProps) => <Icon {...p}><path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><path d="m5.6 5.6 2.8 2.8"/><path d="m15.6 15.6 2.8 2.8"/><path d="m5.6 18.4 2.8-2.8"/><path d="m15.6 8.4 2.8-2.8"/></Icon>;
export const IconSend = (p: IconProps) => <Icon {...p}><path d="m4 12 16-8-5 16-3-7-8-1Z"/></Icon>;
export const IconTelegram = (p: IconProps) => <Icon {...p}><path d="M21 4 2 11l6 2 2 6 4-4 5 4 2-15Z"/></Icon>;
export const IconPhone = (p: IconProps) => <Icon {...p}><path d="M5 4h3l2 5-2 1a11 11 0 0 0 6 6l1-2 5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/></Icon>;
export const IconFaucet = (p: IconProps) => <Icon {...p}><path d="M9 4h6v4l3 1v3h-4v-3h-4v3H6V9l3-1V4Z"/><path d="M11 15v5"/><path d="M11 20a2 2 0 0 0 4 0c0-2-2-3-2-3"/></Icon>;
export const IconUpload = (p: IconProps) => <Icon {...p}><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M4 19h16"/></Icon>;
export const IconLogout = (p: IconProps) => <Icon {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></Icon>;

export const BrandMark = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <defs>
      <linearGradient id="gm1" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#FFB070"/>
        <stop offset="1" stopColor="#FF7A26"/>
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="9" fill="url(#gm1)"/>
    <circle cx="16" cy="16" r="7.5" stroke="#1a1006" strokeWidth="1.8" fill="none"/>
    <circle cx="16" cy="16" r="2.4" fill="#1a1006"/>
    <path d="M16 6 v3 M16 23 v3 M6 16 h3 M23 16 h3" stroke="#1a1006" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
);
