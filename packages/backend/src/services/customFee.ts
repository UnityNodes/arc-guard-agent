const FEE_RECIPIENT = (process.env.ARC_FEE_RECIPIENT || '').toLowerCase();
const FEE_BPS_RAW = Number(process.env.ARC_FEE_BPS || '0');
export const ARC_FEE_BPS = Number.isFinite(FEE_BPS_RAW) && FEE_BPS_RAW >= 0 && FEE_BPS_RAW <= 10_000 ? Math.floor(FEE_BPS_RAW) : 0;
const RECIPIENT_VALID = /^0x[a-f0-9]{40}$/i.test(FEE_RECIPIENT);
export const ARC_FEE_RECIPIENT: string | null = RECIPIENT_VALID ? FEE_RECIPIENT : null;

export function isCustomFeeEnabled(): boolean {
  return ARC_FEE_BPS > 0 && ARC_FEE_RECIPIENT != null;
}

export interface BpsFee {
  percentageBps: number;
  recipientAddress: string;
}

export interface ValueFee {
  value: string;
  recipientAddress: string;
}

export function bpsFee(): BpsFee | null {
  if (!isCustomFeeEnabled()) return null;
  return { percentageBps: ARC_FEE_BPS, recipientAddress: ARC_FEE_RECIPIENT! };
}

export function valueFeeForAmount(amount: string | number): ValueFee | null {
  if (!isCustomFeeEnabled()) return null;
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n) || n <= 0) return null;
  const fee = (n * ARC_FEE_BPS) / 10_000;
  const fixed = fee.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (Number(fixed) <= 0) return null;
  return { value: fixed, recipientAddress: ARC_FEE_RECIPIENT! };
}

export interface CustomFeeStatus {
  enabled: boolean;
  bps: number;
  recipient: string | null;
  splitDisclosure: string;
}

export function customFeeStatus(): CustomFeeStatus {
  return {
    enabled: isCustomFeeEnabled(),
    bps: ARC_FEE_BPS,
    recipient: ARC_FEE_RECIPIENT,
    splitDisclosure: '90% to the configured recipient, 10% to Arc per App Kit custom-fee policy',
  };
}
