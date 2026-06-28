'use client';

import { useState, useEffect } from 'react';

const ETH_FEED = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace';
const PYTH_URL = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${ETH_FEED}`;

// Shared in-memory cache (singleton across all hook instances)
let cachedPrice: number | null = null;
let cachedAt = 0;
const CACHE_TTL = 60_000; // 60s, avoid duplicate fetches across components
let inflightPromise: Promise<number | null> | null = null;

async function fetchEthPrice(): Promise<number | null> {
  // Return cache if fresh
  if (cachedPrice && Date.now() - cachedAt < CACHE_TTL) return cachedPrice;

  // Deduplicate concurrent requests
  if (inflightPromise) return inflightPromise;

  inflightPromise = (async () => {
    try {
      const res = await fetch(PYTH_URL, { signal: AbortSignal.timeout(6_000) });
      if (!res.ok) return cachedPrice;
      const data = await res.json() as { parsed: Array<{ price: { price: string; expo: number } }> };
      const p = data?.parsed?.[0]?.price;
      if (p) {
        cachedPrice = Math.abs(Number(p.price)) * Math.pow(10, p.expo);
        cachedAt = Date.now();
      }
      return cachedPrice;
    } catch {
      return cachedPrice;
    } finally {
      inflightPromise = null;
    }
  })();

  return inflightPromise;
}

/**
 * Shared ETH price hook, deduplicates fetches across all components.
 * Returns cached price instantly, refreshes in background every 60s.
 */
export function useEthPrice() {
  const [price, setPrice] = useState<number | null>(cachedPrice);

  useEffect(() => {
    fetchEthPrice().then(p => { if (p) setPrice(p); });

    const interval = setInterval(() => {
      if (document.hidden) return;
      fetchEthPrice().then(p => { if (p) setPrice(p); });
    }, CACHE_TTL);

    return () => clearInterval(interval);
  }, []);

  return price;
}
