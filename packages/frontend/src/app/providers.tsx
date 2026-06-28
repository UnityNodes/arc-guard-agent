'use client';

import dynamic from 'next/dynamic';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { arcTestnet } from 'viem/chains';
import { injected } from 'wagmi/connectors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { ToastProvider } from '@/components/ui/toast';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [injected()],
  transports: { [arcTestnet.id]: http() },
  ssr: true,
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000 } },
});

const PrivyClientWrapper = dynamic(
  () => import('./PrivyClientWrapper').then((m) => m.PrivyClientWrapper),
  { ssr: false }
);

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyClientWrapper>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <LanguageProvider>
              <ToastProvider>
                <ErrorBoundary>
                  {children}
                </ErrorBoundary>
              </ToastProvider>
            </LanguageProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </PrivyClientWrapper>
  );
}
