'use client';
import React, { useState, useRef, useEffect } from 'react';

// Glossary of Arc/Circle/agentic-commerce jargon used across the app.
// First-time readers hover any term to see a short plain-English definition
// without having to leave the page.
const GLOSSARY: Record<string, string> = {
  'CCTP':
    "Circle's Cross-Chain Transfer Protocol. Moves real USDC between chains by burning on the source chain and minting on the destination. No wrapped tokens, no bridges in the middle.",
  'UCW':
    "User-Controlled Wallet. A Circle wallet where YOU hold the keys. Used here for your personal identity wallet.",
  'DCW':
    "Developer-Controlled Wallet. A Circle wallet where the app holds the keys on your behalf. Used here for the agent wallet so the agent can sign transactions inside policy bounds.",
  'Privy':
    "The auth provider. Sign in by email, get a non-custodial wallet automatically. No password, no seed phrase.",
  'Aegis':
    "The AI agent. It uses 37 tools (swap, bridge, alerts, jobs, reputation…) under Guardian's policy. Talk to it in /chat.",
  'Guardian':
    "The policy layer that pre-checks every action before it goes on-chain. Per-tx limits, daily caps, token allow/block-lists. Aegis cannot bypass it.",
  'ERC-8004':
    "Agent reputation standard on Arc. Lets agents have identity, get feedback after each job, and prove they're trustworthy before counterparties hire them.",
  'ERC-8183':
    "Agentic commerce escrow standard. A smart contract holds USDC while a provider agent does a job, released only after the evaluator approves.",
  'Swap Kit':
    "Circle's on-chain swap SDK. USDC↔EURC at oracle rates with slippage bounds. Used here as the swap engine inside the agent wallet.",
  'eth_getLogs':
    "The raw RPC method for pulling on-chain events. /Activity is the unfiltered ground truth of every transfer touching your address.",
  'Arc':
    "Circle's blockchain. Purpose-built for stablecoin payments, programmable money, and agentic commerce.",
};

export function Term({ children }: { children: string }) {
  const def = GLOSSARY[children];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!def) return <>{children}</>;

  return (
    <span
      ref={ref}
      className="ga-term"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen(o => !o)}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
      aria-label={`Definition of ${children}`}
    >
      {children}
      {open && (
        <span className="ga-term-tip" role="tooltip">
          <span className="ga-term-tip-key">{children}</span>
          <span className="ga-term-tip-def">{def}</span>
        </span>
      )}
    </span>
  );
}
