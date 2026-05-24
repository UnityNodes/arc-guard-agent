import { logger } from '../lib/logger';
import { randomUUID } from 'node:crypto';

const COMPLIANCE_KEY = process.env.CIRCLE_COMPLIANCE_KEY || '';
const COMPLIANCE_URL = process.env.CIRCLE_COMPLIANCE_URL || 'https://api.circle.com';

export type ScreeningDecision = 'PASS' | 'BLOCK' | 'REVIEW';

export interface ScreeningResult {
  address: string;
  decision: ScreeningDecision;
  riskScore: number;
  flags: string[];
  source: 'circle' | 'mock';
  note?: string;
}

export function isComplianceConfigured(): boolean {
  return !!COMPLIANCE_KEY;
}

async function screenViaCircle(address: string): Promise<ScreeningResult | null> {
  try {
    const r = await fetch(`${COMPLIANCE_URL}/v1/w3s/compliance/screening/addresses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${COMPLIANCE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: randomUUID(), address, chain: 'ARC-TESTNET' }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) {
      const text = await r.text();
      logger.warn('compliance', `Circle compliance API ${r.status}: ${text.slice(0, 200)}`);
      return null;
    }
    const d = (await r.json()) as { data?: { result?: ScreeningDecision; riskScore?: number; flags?: string[] } };
    return {
      address,
      decision: d.data?.result ?? 'PASS',
      riskScore: d.data?.riskScore ?? 0,
      flags: d.data?.flags ?? [],
      source: 'circle',
    };
  } catch (err) {
    logger.warn('compliance', 'Circle compliance request failed', err);
    return null;
  }
}

function screenViaMock(address: string): ScreeningResult {
  const a = address.toLowerCase();
  if (a.endsWith('9999')) return { address, decision: 'BLOCK',  riskScore: 100, flags: ['CIRCLE_SANCTIONS_BLOCKLIST'],          source: 'mock', note: "Circle's Sanctions Blocklist" };
  if (a.endsWith('8888')) return { address, decision: 'BLOCK',  riskScore: 100, flags: ['FROZEN_USER_WALLET'],                  source: 'mock', note: 'Frozen User Wallet' };
  if (a.endsWith('7777')) return { address, decision: 'BLOCK',  riskScore: 95,  flags: ['YOUR_BLOCKLIST'],                      source: 'mock', note: 'Your blocklist' };
  if (a.endsWith('8999')) return { address, decision: 'BLOCK',  riskScore: 100, flags: ['SEVERE_SANCTIONS_RISK_OWNER'],         source: 'mock', note: 'Severe Sanctions Risk (Owner)' };
  if (a.endsWith('8899')) return { address, decision: 'BLOCK',  riskScore: 100, flags: ['SEVERE_TERRORIST_FINANCING_RISK_OWNER'], source: 'mock', note: 'Severe Terrorist Financing Risk (Owner)' };
  if (a.endsWith('8889')) return { address, decision: 'BLOCK',  riskScore: 100, flags: ['SEVERE_CSAM_RISK_OWNER'],              source: 'mock', note: 'Severe CSAM Risk (Owner)' };
  if (a.endsWith('7779')) return { address, decision: 'BLOCK',  riskScore: 100, flags: ['SEVERE_ILLICIT_BEHAVIOR_RISK_OWNER'],  source: 'mock', note: 'Severe Illicit Behavior Risk (Owner)' };
  if (a.endsWith('7666')) return { address, decision: 'REVIEW', riskScore: 75,  flags: ['HIGH_ILLICIT_BEHAVIOR_RISK_OWNER'],    source: 'mock', note: 'High Illicit Behavior Risk (Owner)' };
  if (a.endsWith('7766')) return { address, decision: 'REVIEW', riskScore: 70,  flags: ['HIGH_GAMBLING_RISK_OWNER'],            source: 'mock', note: 'High Gambling Risk (Owner)' };
  return { address, decision: 'PASS', riskScore: 0, flags: [], source: 'mock' };
}

export async function screenAddress(address: string): Promise<ScreeningResult> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return { address, decision: 'BLOCK', riskScore: 100, flags: ['INVALID_ADDRESS'], source: 'mock' };
  }
  if (COMPLIANCE_KEY) {
    const r = await screenViaCircle(address);
    if (r) return r;
  }
  return screenViaMock(address);
}
