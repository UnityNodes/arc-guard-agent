import { initiateUserControlledWalletsClient } from '@circle-fin/user-controlled-wallets';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY || '';
const ARC_BLOCKCHAIN  = 'ARC-TESTNET' as const;

export function isUcwConfigured(): boolean {
  return !!CIRCLE_API_KEY;
}

function getClient() {
  return initiateUserControlledWalletsClient({ apiKey: CIRCLE_API_KEY });
}

function ucwUserIdFor(userId: string): string {
  return `ga-${userId}`.slice(0, 64);
}

export interface UcwInitResult {
  ucwUserId: string;
  userToken: string;
  encryptionKey: string;
}

export async function initUcwSession(userId: string): Promise<UcwInitResult> {
  if (!isUcwConfigured()) throw new Error('Circle UCW not configured');
  const client = getClient();
  const ucwUserId = ucwUserIdFor(userId);

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { circleUcwUserId: true } });
  if (!user) throw new Error('User not found');

  if (!user.circleUcwUserId) {
    try {
      await client.createUser({ userId: ucwUserId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/already exists/i.test(msg)) {
        logger.warn('ucw', `createUser non-conflict error: ${msg}`);
        throw err;
      }
    }
    await prisma.user.update({ where: { id: userId }, data: { circleUcwUserId: ucwUserId } });
  }

  const tokenRes = await client.createUserToken({ userId: ucwUserId });
  const userToken = tokenRes.data?.userToken;
  const encryptionKey = tokenRes.data?.encryptionKey;
  if (!userToken || !encryptionKey) throw new Error('createUserToken returned no token/encryptionKey');

  return { ucwUserId, userToken, encryptionKey };
}

export interface UcwChallengeResult {
  challengeId: string;
}

export async function createUcwWalletChallenge(userToken: string): Promise<UcwChallengeResult> {
  if (!isUcwConfigured()) throw new Error('Circle UCW not configured');
  const client = getClient();
  const r = await client.createWallet({
    userToken,
    blockchains: [ARC_BLOCKCHAIN],
    accountType: 'SCA',
  });
  const data = r.data as { challengeId?: string } | undefined;
  const challengeId = data?.challengeId;
  if (!challengeId) throw new Error('createWallet did not return a challengeId');
  return { challengeId };
}

export interface UcwWalletInfo {
  address: string;
  blockchain: string;
  accountType: string;
  state: string;
}

export async function listUcwWallets(userToken: string): Promise<UcwWalletInfo[]> {
  const client = getClient();
  const r = await client.listWallets({ userToken });
  const wallets = (r.data?.wallets ?? []) as Array<{
    address: string;
    blockchain: string;
    accountType?: string;
    state?: string;
  }>;
  return wallets
    .filter((w) => w.blockchain === ARC_BLOCKCHAIN)
    .map((w) => ({
      address: w.address,
      blockchain: w.blockchain,
      accountType: w.accountType ?? 'SCA',
      state: w.state ?? 'UNKNOWN',
    }));
}

export async function syncUcwAddress(userId: string, userToken: string): Promise<string | null> {
  const wallets = await listUcwWallets(userToken);
  const live = wallets.find((w) => w.state === 'LIVE') ?? wallets[0];
  if (!live?.address) return null;
  const lower = live.address.toLowerCase();
  await prisma.user.update({
    where: { id: userId },
    data: { circleUcwAddress: lower, walletAddress: lower },
  });
  return lower;
}

export async function getEffectiveEvmAddress(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { circleUcwAddress: true, walletAddress: true },
  });
  if (!u) return null;
  if (u.circleUcwAddress && /^0x[a-f0-9]{40}$/i.test(u.circleUcwAddress)) return u.circleUcwAddress;
  if (u.walletAddress && /^0x[a-f0-9]{40}$/i.test(u.walletAddress)) return u.walletAddress;
  return null;
}
