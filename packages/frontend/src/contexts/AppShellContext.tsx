'use client';
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface AppShellContextValue {
  chatOpen: boolean;
  setChatOpen: (v: boolean) => void;
  theme: 'dark' | 'light';
  setTheme: (t: 'dark' | 'light') => void;
}

const AppShellContext = createContext<AppShellContextValue | null>(null);

export function AppShellProvider({ children }: { children: ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'light';
    try {
      const stored = localStorage.getItem('ga-theme-v2');
      if (stored === 'dark' || stored === 'light') return stored;
    } catch { /* private browsing */ }
    return 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('ga-theme-v2', theme); } catch { /* */ }
  }, [theme]);

  return (
    <AppShellContext.Provider value={{ chatOpen, setChatOpen, theme, setTheme }}>
      {children}
    </AppShellContext.Provider>
  );
}

export function useAppShell() {
  const ctx = useContext(AppShellContext);
  if (!ctx) throw new Error('useAppShell must be used within AppShellProvider');
  return ctx;
}
