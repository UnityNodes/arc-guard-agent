import { initiateSmartContractPlatformClient } from '@circle-fin/smart-contract-platform';
import { logger } from '../lib/logger';

const CIRCLE_API_KEY       = process.env.CIRCLE_API_KEY || '';
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET || '';

const ARC_BLOCKCHAIN = 'ARC-TESTNET';

export function isScpConfigured(): boolean {
  return !!(CIRCLE_API_KEY && CIRCLE_ENTITY_SECRET);
}

function scpClient() {
  if (!isScpConfigured()) throw new Error('Circle SCP not configured (need CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET)');
  return initiateSmartContractPlatformClient({ apiKey: CIRCLE_API_KEY, entitySecret: CIRCLE_ENTITY_SECRET });
}

export interface EventMonitorView {
  id: string;
  blockchain: string;
  contractAddress: string;
  eventSignature: string;
  isEnabled: boolean;
  updateDate: string | null;
}

function toView(m: {
  id: string; blockchain: string; contractAddress: string; eventSignature: string;
  isEnabled: boolean; updateDate?: string;
}): EventMonitorView {
  return {
    id: m.id,
    blockchain: m.blockchain,
    contractAddress: m.contractAddress,
    eventSignature: m.eventSignature,
    isEnabled: m.isEnabled,
    updateDate: m.updateDate ?? null,
  };
}

export async function listEventMonitors(filter?: { contractAddress?: string; eventSignature?: string }): Promise<EventMonitorView[]> {
  const client = scpClient();
  try {
    const r = await client.listEventMonitors({ blockchain: ARC_BLOCKCHAIN as never, ...(filter ?? {}) } as never);
    const list = (r.data ?? []) as { id: string; blockchain: string; contractAddress: string; eventSignature: string; isEnabled: boolean; updateDate?: string }[];
    return list.map(toView);
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 403 || status === 404) {
      logger.warn('eventMonitor', `SCP API returned ${status} for ARC-TESTNET - event monitors not available on this network`);
      return [];
    }
    throw err;
  }
}

export async function createEventMonitor(contractAddress: string, eventSignature: string): Promise<EventMonitorView> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) throw new Error('Invalid contract address');
  if (!eventSignature || /\s/.test(eventSignature)) throw new Error('Event signature must be non-empty and contain no spaces');
  const client = scpClient();
  const r = await client.createEventMonitor({
    blockchain: ARC_BLOCKCHAIN as never,
    contractAddress,
    eventSignature,
  } as never);
  const m = r.data as { id: string; blockchain: string; contractAddress: string; eventSignature: string; isEnabled: boolean; updateDate?: string } | undefined;
  if (!m) throw new Error('SCP did not return event monitor');
  logger.info('eventMonitor', `Created monitor ${m.id} for ${contractAddress} ${eventSignature}`);
  return toView(m);
}

export async function updateEventMonitor(id: string, isEnabled: boolean): Promise<EventMonitorView> {
  const client = scpClient();
  const r = await client.updateEventMonitor({ id, isEnabled } as never);
  const m = r.data as { id: string; blockchain: string; contractAddress: string; eventSignature: string; isEnabled: boolean; updateDate?: string } | undefined;
  if (!m) throw new Error('SCP did not return updated monitor');
  logger.info('eventMonitor', `Updated monitor ${m.id} isEnabled=${isEnabled}`);
  return toView(m);
}

export async function deleteEventMonitor(id: string): Promise<void> {
  const client = scpClient();
  await client.deleteEventMonitor({ id } as never);
  logger.info('eventMonitor', `Deleted monitor ${id}`);
}

import { USDC_ADDRESS, EURC_ADDRESS, MEMO_CONTRACT } from './arcEvents';

export interface DefaultMonitorSpec { contractAddress: string; eventSignature: string; label: string }

export function defaultArcMonitors(): DefaultMonitorSpec[] {
  return [
    { contractAddress: USDC_ADDRESS,    eventSignature: 'Transfer(address,address,uint256)',     label: 'USDC.Transfer' },
    { contractAddress: USDC_ADDRESS,    eventSignature: 'Blocklisted(address)',                  label: 'USDC.Blocklisted' },
    { contractAddress: USDC_ADDRESS,    eventSignature: 'UnBlocklisted(address)',                label: 'USDC.UnBlocklisted' },
    { contractAddress: EURC_ADDRESS,    eventSignature: 'Transfer(address,address,uint256)',     label: 'EURC.Transfer' },
    { contractAddress: MEMO_CONTRACT,   eventSignature: 'Memo(address,address,bytes32,bytes32,bytes,uint256)', label: 'Memo.Memo' },
  ];
}

export async function ensureDefaultMonitors(): Promise<{ created: EventMonitorView[]; reused: EventMonitorView[] }> {
  const existing = await listEventMonitors();
  const lookup = new Map(existing.map((m) => [`${m.contractAddress.toLowerCase()}|${m.eventSignature}`, m]));
  const created: EventMonitorView[] = [];
  const reused: EventMonitorView[] = [];
  for (const spec of defaultArcMonitors()) {
    const key = `${spec.contractAddress.toLowerCase()}|${spec.eventSignature}`;
    const found = lookup.get(key);
    if (found) { reused.push(found); continue; }
    try {
      const m = await createEventMonitor(spec.contractAddress, spec.eventSignature);
      created.push(m);
    } catch (err) {
      logger.warn('eventMonitor', `Failed to create default monitor ${spec.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { created, reused };
}
