import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';
import { UnityMonitoring } from '@/components/UnityMonitoring';

export const metadata: Metadata = {
  title: 'GuardAgent · autonomous AI agent for stablecoins on Arc',
  description: 'An autonomous AI agent that swaps, bridges, and settles escrow jobs on Arc. Every action runs through a policy you wrote. Above your line it pauses for your tap on Telegram.',
  keywords: ['AI agent', 'USDC', 'Arc', 'Circle', 'spending policy', 'Guardian', 'stablecoins', 'human-in-the-loop'],
  authors: [{ name: 'GuardAgent' }],
  creator: 'GuardAgent',
  metadataBase: new URL('https://guardagent.org'),
  openGraph: {
    type: 'website',
    url: 'https://guardagent.org',
    title: 'GuardAgent · autonomous AI agent for stablecoins on Arc',
    description: 'An autonomous AI agent that swaps, bridges, and settles escrow jobs on Arc. Every action runs through a policy you wrote. Above your line it pauses for your tap on Telegram.',
    siteName: 'GuardAgent',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'GuardAgent · autonomous AI agent for stablecoins on Arc' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GuardAgent · autonomous AI agent for stablecoins on Arc',
    description: 'Policy engine + Telegram approval flow for AI agents managing USDC on Circle Arc.',
    images: ['/og-image.png'],
    creator: '@guardagent',
  },
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icons/icon-192.png',
    shortcut: '/favicon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0d' },
    { media: '(prefers-color-scheme: light)', color: '#f7f5f0' },
  ],
};

// Theme bootstrap - light is the new permanent default for the app.
// We switched from ga-theme to ga-theme-v2 key so all existing dark-mode
// users get a clean reset to light. Only explicit dark choice (via toggle)
// writes ga-theme-v2=dark and preserves dark on reload.
const themeScript = `(function(){try{
  var isLanding=window.location.pathname==='/'||window.location.pathname==='';
  if(isLanding){document.documentElement.setAttribute('data-theme','light');document.body.style.background='#FAF8F4';return;}
  var t=localStorage.getItem('ga-theme-v2');
  document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light');
}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Oxanium:wght@300;400;500;600;700;800&family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>
        <UnityMonitoring />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
