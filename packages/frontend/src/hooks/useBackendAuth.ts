'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getApiToken, setApiToken, setUnauthorizedHandler } from '@/lib/api';

export function useBackendAuth() {
  const router = useRouter();
  // Lazy init: synchronously check localStorage on first render so we
  // never flash the ConnectScreen for already-authenticated users.
  // SSR-safe: typeof window check inside getApiToken keeps it null
  // server-side, then hydration picks up the real value.
  const [ready, setReady] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return !!getApiToken();
  });
  // Have we finished the synchronous boot-time auth check?
  // True after the first effect runs (client side only).
  const [checked, setChecked] = useState<boolean>(typeof window !== 'undefined');
  const [error] = useState<string | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setApiToken(null);
      setReady(false);
      router.push('/sign-in');
    });
  }, [router]);

  useEffect(() => {
    setReady(!!getApiToken());
    setChecked(true);
  }, []);

  return { ready, checked, error };
}
