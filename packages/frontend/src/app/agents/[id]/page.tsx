import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

interface ReputationSummary {
  agentId: string;
  count: number;
  averageScore: number | null;
  minScore: number | null;
  maxScore: number | null;
  lastFeedbackAt: string | null;
  tagCounts: Record<string, number>;
}

interface FeedbackRecord {
  txHash: string;
  blockNumber: string;
  agentId: string;
  validator: string;
  score: number;
  feedbackType: number;
  tag: string;
  metadataURI: string;
  evidenceURI: string;
  comment: string;
  feedbackHash: string;
  decoded: boolean;
}

interface AgentProfile {
  agentId: string;
  registries: {
    identity: string;
    reputation: string;
    validation: string;
    chainId: number;
  };
  identity: { owner: string | null; tokenURI: string | null };
  reputation: ReputationSummary;
  feedback: FeedbackRecord[];
  errors: { identity: string | null; reputation: string | null; feedback: string | null };
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.guardagent.org';
const ARC_EXPLORER = 'https://testnet.arcscan.app';

async function getAgent(id: string): Promise<AgentProfile | null> {
  try {
    const res = await fetch(`${API_URL}/api/agents/${id}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed: ${res.status}`);
    return (await res.json()) as AgentProfile;
  } catch {
    return null;
  }
}

function truncate(addr: string, head = 6, tail = 4): string {
  if (!addr) return '-';
  if (addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

function scoreClass(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 40) return 'text-amber-400';
  if (score >= 0) return 'text-gray-400';
  return 'text-red-400';
}

function formatScore(s: number | null): string {
  if (s === null) return '-';
  return s.toFixed(1);
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Agent #${id} · ERC-8004 profile · GuardAgent`,
    description: `On-chain identity, reputation score, and validator feedback for ERC-8004 agent #${id} on Arc.`,
  };
}

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getAgent(id);
  if (!profile) return notFound();

  const { identity, reputation, feedback, registries } = profile;
  const owner = identity.owner ?? '';
  const tokenURI = identity.tokenURI ?? null;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-300 font-sans">
      <div className="max-w-5xl mx-auto px-6 py-12 pb-20">

        {/* Header */}
        <div className="mb-10 flex justify-between items-center">
          <Link href="/" className="text-blue-400 font-bold text-lg hover:text-blue-300 transition">
            🛡️ GuardAgent
          </Link>
          <div className="text-xs text-gray-500">ERC-8004 · Arc Testnet</div>
        </div>

        {/* Hero */}
        <div className="bg-gradient-to-br from-blue-950/30 to-emerald-950/20 border border-blue-500/20 rounded-lg p-8 mb-10">
          <div className="text-sm text-blue-400 uppercase tracking-wider mb-2">Agent</div>
          <h1 className="text-5xl font-extrabold text-white mb-6">#{profile.agentId}</h1>

          <div className="grid md:grid-cols-2 gap-6 text-sm">
            <div>
              <div className="text-gray-500 mb-1">Owner</div>
              <a
                href={`${ARC_EXPLORER}/address/${owner}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-200 font-mono hover:text-blue-300 transition"
              >
                {truncate(owner, 10, 8)}
              </a>
            </div>
            <div>
              <div className="text-gray-500 mb-1">Metadata URI</div>
              {tokenURI ? (
                <a
                  href={tokenURI.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${tokenURI.slice(7)}` : tokenURI}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-200 font-mono hover:text-blue-300 transition break-all"
                >
                  {truncate(tokenURI, 16, 12)}
                </a>
              ) : (
                <span className="text-gray-500">-</span>
              )}
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          <StatCard label="Feedback events" value={String(reputation.count)} />
          <StatCard label="Average score" value={formatScore(reputation.averageScore)} valueClass={reputation.averageScore !== null ? scoreClass(reputation.averageScore) : ''} />
          <StatCard label="Min score" value={formatScore(reputation.minScore)} />
          <StatCard label="Max score" value={formatScore(reputation.maxScore)} />
        </div>

        {/* Tag breakdown */}
        {Object.keys(reputation.tagCounts).length > 0 && (
          <div className="mb-10">
            <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-3">Tag breakdown</h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(reputation.tagCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([tag, count]) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs bg-gray-900 border border-gray-800 text-gray-300"
                  >
                    <span className="font-mono">{tag}</span>
                    <span className="text-gray-500">×{count}</span>
                  </span>
                ))}
            </div>
          </div>
        )}

        {/* Feedback feed */}
        <div className="mb-10">
          <div className="flex justify-between items-baseline mb-3">
            <h2 className="text-sm uppercase tracking-wider text-gray-500">Recent feedback</h2>
            <span className="text-xs text-gray-600">{feedback.length} event{feedback.length === 1 ? '' : 's'}</span>
          </div>

          {feedback.length === 0 ? (
            <div className="bg-gray-950 border border-gray-900 rounded-lg p-8 text-center text-gray-500 text-sm">
              No feedback recorded yet. Validators can submit feedback via the
              <a href="https://docs.arc.io/build/agentic-economy" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 ml-1">
                ERC-8004 ReputationRegistry
              </a>.
            </div>
          ) : (
            <div className="overflow-x-auto bg-gray-950 border border-gray-900 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 font-normal">Score</th>
                    <th className="px-4 py-3 font-normal">Tag</th>
                    <th className="px-4 py-3 font-normal">Validator</th>
                    <th className="px-4 py-3 font-normal">Comment</th>
                    <th className="px-4 py-3 font-normal">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {feedback.map((f) => (
                    <tr key={f.txHash + f.feedbackHash} className="border-t border-gray-900 hover:bg-gray-900/30">
                      <td className={`px-4 py-3 font-mono font-semibold ${scoreClass(f.score)}`}>{f.score}</td>
                      <td className="px-4 py-3 font-mono text-gray-300">{f.tag || '-'}</td>
                      <td className="px-4 py-3">
                        <a
                          href={`${ARC_EXPLORER}/address/${f.validator}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-gray-400 hover:text-blue-300 transition"
                        >
                          {truncate(f.validator)}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs max-w-xs truncate" title={f.comment}>
                        {f.comment || <span className="text-gray-600">-</span>}
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href={`${ARC_EXPLORER}/tx/${f.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-gray-500 hover:text-blue-300 transition text-xs"
                        >
                          {truncate(f.txHash, 6, 4)} ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Registries footer */}
        <div className="mt-12 pt-6 border-t border-gray-900">
          <h2 className="text-sm uppercase tracking-wider text-gray-500 mb-4">ERC-8004 registries</h2>
          <div className="grid md:grid-cols-3 gap-4 text-xs">
            <RegistryLink label="Identity" addr={registries.identity} />
            <RegistryLink label="Reputation" addr={registries.reputation} />
            <RegistryLink label="Validation" addr={registries.validation} />
          </div>
          <div className="mt-6 text-xs text-gray-600">
            Last feedback: {formatDate(reputation.lastFeedbackAt)} · Chain ID {registries.chainId}
          </div>
        </div>

        <div className="mt-12 text-center text-xs text-gray-600">
          Powered by <Link href="/" className="text-blue-400 hover:text-blue-300">GuardAgent</Link>. Guardian policy engine for autonomous USDC actions on Arc.
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-gray-950 border border-gray-900 rounded-lg px-4 py-5">
      <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">{label}</div>
      <div className={`text-2xl font-bold font-mono ${valueClass || 'text-gray-200'}`}>{value}</div>
    </div>
  );
}

function RegistryLink({ label, addr }: { label: string; addr: string }) {
  return (
    <div>
      <div className="text-gray-500 mb-1">{label}Registry</div>
      <a
        href={`${ARC_EXPLORER}/address/${addr}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-gray-400 hover:text-blue-300 transition break-all"
      >
        {truncate(addr, 10, 8)}
      </a>
    </div>
  );
}
