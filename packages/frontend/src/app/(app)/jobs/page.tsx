'use client';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useBackendAuth } from '@/hooks/useBackendAuth';
import { useToast } from '@/components/ui/toast';
import {
  IconExternal, IconPlus, IconCheck, IconShield, IconClose,
  IconUser, IconBuilding, IconZap,
} from '@/components/Icons';
import { Term } from '@/components/Term';

const ARC_EXPLORER = 'https://testnet.arcscan.app';

type JobStatus = 'DRAFT' | 'OPEN' | 'FUNDED' | 'SUBMITTED' | 'COMPLETED' | 'REJECTED' | 'EXPIRED';

type JobRow = {
  id: string;
  userId: string;
  jobId: string | null;
  role: string;
  status: JobStatus;
  clientAddress: string;
  providerAddress: string;
  evaluatorAddress: string;
  hookAddress: string;
  description: string;
  expiredAt: string;
  budgetUsdc: string | null;
  deliverableHash: string | null;
  reasonHash: string | null;
  createTxHash: string | null;
  budgetTxHash: string | null;
  fundTxHash: string | null;
  submitTxHash: string | null;
  completeTxHash: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type ListResponse = { jobs: JobRow[]; myAddress: string };

const LIFECYCLE: { key: JobStatus; label: string; tense: string }[] = [
  { key: 'DRAFT',     label: 'Drafted',   tense: 'off-chain' },
  { key: 'OPEN',      label: 'Posted',    tense: 'on-chain' },
  { key: 'FUNDED',    label: 'Funded',    tense: 'USDC escrowed' },
  { key: 'SUBMITTED', label: 'Delivered', tense: 'hash on-chain' },
  { key: 'COMPLETED', label: 'Settled',   tense: 'paid' },
];

function statusIndex(s: JobStatus): number {
  const i = LIFECYCLE.findIndex(l => l.key === s);
  return i === -1 ? 0 : i;
}

function isMe(addr: string, me: string): boolean {
  return !!addr && !!me && addr.toLowerCase() === me.toLowerCase();
}

function truncate(s: string, head = 6, tail = 4) {
  if (!s) return '-';
  if (s.length <= head + tail + 2) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function JobsPage() {
  const { ready } = useBackendAuth();
  const toast = useToast();
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<'all' | 'live' | 'done'>('all');

  const load = useCallback(async () => {
    try {
      const d = await api.get<ListResponse>('/jobs');
      setData(d);
    } catch (err) {
      toast.error('Failed to load jobs', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  const counts = useMemo(() => {
    const jobs = data?.jobs ?? [];
    let live = 0, done = 0, settledUsdc = 0;
    for (const j of jobs) {
      if (j.status === 'COMPLETED') {
        done += 1;
        settledUsdc += parseFloat(j.budgetUsdc ?? '0') || 0;
      } else if (j.status === 'REJECTED' || j.status === 'EXPIRED') {
        done += 1;
      } else {
        live += 1;
      }
    }
    return { total: jobs.length, live, done, settledUsdc };
  }, [data]);

  const filteredJobs = useMemo(() => {
    const jobs = data?.jobs ?? [];
    if (filter === 'all') return jobs;
    if (filter === 'live') return jobs.filter(j => !['COMPLETED', 'REJECTED', 'EXPIRED'].includes(j.status));
    return jobs.filter(j => ['COMPLETED', 'REJECTED', 'EXPIRED'].includes(j.status));
  }, [data, filter]);

  const callAction = async (id: string, path: string, body: unknown, pendingMsg: string, successMsg: string) => {
    setBusyId(id);
    const t = toast.pending(pendingMsg, `Job ${id.slice(0, 8)}…`);
    try {
      const res = await api.post<{ txHash?: string }>(`/jobs/${id}${path}`, body);
      await load();
      t.success(successMsg, undefined, res?.txHash ?? null);
    } catch (err) {
      t.error('Action failed', err instanceof Error ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="arc-page">
      <div className="arc-kpi-row">
        <button
          className={`arc-kpi${filter === 'all' ? ' is-active' : ''}`}
          style={{ cursor: 'pointer', border: 'none', textAlign: 'left' }}
          onClick={() => setFilter('all')}
        >
          <div className="arc-kpi-label">All jobs</div>
          <div className="arc-kpi-val">{counts.total}</div>
        </button>
        <button
          className={`arc-kpi${filter === 'live' ? ' is-active' : ''}`}
          style={{ cursor: 'pointer', border: 'none', textAlign: 'left' }}
          onClick={() => setFilter('live')}
        >
          <div className="arc-kpi-label"><IconZap size={10}/> In flight</div>
          <div className="arc-kpi-val">{counts.live}</div>
        </button>
        <button
          className={`arc-kpi${filter === 'done' ? ' is-active' : ''}`}
          style={{ cursor: 'pointer', border: 'none', textAlign: 'left' }}
          onClick={() => setFilter('done')}
        >
          <div className="arc-kpi-label"><IconCheck size={10}/> Done</div>
          <div className="arc-kpi-val">{counts.done}</div>
        </button>
        <div className="arc-kpi">
          <div className="arc-kpi-label">Settled to providers</div>
          <div className="arc-kpi-val">${counts.settledUsdc.toFixed(2)} <small style={{ fontWeight: 400, fontSize: 11, opacity: 0.6 }}>USDC</small></div>
        </div>
      </div>

      <div className="arc-card">
        <div className="arc-card-head">
          <span className="arc-card-title"><IconBuilding size={13}/> Jobs <span style={{ opacity: 0.4, fontWeight: 400, fontSize: 11, marginLeft: 4 }}><Term>ERC-8183</Term> escrow</span></span>
          <button
            className="arc-btn arc-btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}
            onClick={() => setCreating(c => !c)}
          >
            {creating ? <><IconClose size={12}/> Close</> : <><IconPlus size={12}/> New job</>}
          </button>
        </div>

        {creating && (
          <div style={{ padding: '0 18px 14px' }}>
            <CreateJobCard
              myAddress={data?.myAddress ?? ''}
              onClose={() => setCreating(false)}
              onCreated={() => { setCreating(false); load(); }}
            />
          </div>
        )}

        {loading ? (
          <div className="arc-empty">Loading jobs…</div>
        ) : filteredJobs.length === 0 ? (
          data?.jobs.length === 0 ? (
            <div className="arc-empty" style={{ flexDirection: 'column', gap: 8, padding: '32px 18px' }}>
              <div style={{ fontSize: 28 }}><IconBuilding size={28}/></div>
              <div style={{ fontWeight: 600 }}>No jobs yet</div>
              <div style={{ opacity: 0.55, fontSize: 13, maxWidth: 480, textAlign: 'center', lineHeight: 1.6 }}>
                A job is an <Term>ERC-8183</Term> escrow contract. A client puts USDC in,
                a provider delivers work, an evaluator approves, the contract releases
                the funds. Three roles, on-chain, no middleman.
                <br/><br/>
                You can be client, provider, evaluator, or all three for testing. Tap{' '}
                <strong>New job</strong> above to create the first one.
              </div>
            </div>
          ) : (
            <div className="arc-empty">
              {filter === 'live' ? 'No jobs in flight right now.' : 'No completed jobs yet.'}
            </div>
          )
        ) : (
          <div className="arc-table-wrap">
            <table className="arc-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Role</th>
                  <th>Description</th>
                  <th>Budget</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map(j => (
                  <JobTableRow
                    key={j.id}
                    job={j}
                    myAddress={data!.myAddress}
                    busy={busyId === j.id}
                    onCreateOnchain={() => callAction(j.id, '/create-onchain', {}, 'Posting job on-chain…', 'Job posted on-chain')}
                    onSetBudget={(amt) => callAction(j.id, '/set-budget', { amountUsdc: amt }, 'Setting budget…', 'Budget set')}
                    onFund={() => callAction(j.id, '/fund', {}, 'Funding escrow…', 'Job funded. USDC in escrow')}
                    onSubmit={(text) => callAction(j.id, '/submit', { deliverableText: text }, 'Submitting deliverable…', 'Deliverable submitted')}
                    onComplete={(text) => callAction(j.id, '/complete', { reasonText: text }, 'Settling…', 'Job completed. USDC settled')}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail panel per job - shown below the table as arc-cards */}
      {!loading && filteredJobs.map(j => (
        <JobDetailCard
          key={`detail-${j.id}`}
          job={j}
          myAddress={data!.myAddress}
          busy={busyId === j.id}
          onCreateOnchain={() => callAction(j.id, '/create-onchain', {}, 'Posting job on-chain…', 'Job posted on-chain')}
          onSetBudget={(amt) => callAction(j.id, '/set-budget', { amountUsdc: amt }, 'Setting budget…', 'Budget set')}
          onFund={() => callAction(j.id, '/fund', {}, 'Funding escrow…', 'Job funded. USDC in escrow')}
          onSubmit={(text) => callAction(j.id, '/submit', { deliverableText: text }, 'Submitting deliverable…', 'Deliverable submitted')}
          onComplete={(text) => callAction(j.id, '/complete', { reasonText: text }, 'Settling…', 'Job completed. USDC settled')}
        />
      ))}
    </div>
  );
}

function JobTableRow({
  job, myAddress, busy,
  onCreateOnchain, onSetBudget, onFund, onSubmit, onComplete,
}: {
  job: JobRow;
  myAddress: string;
  busy: boolean;
  onCreateOnchain: () => void;
  onSetBudget: (amt: number) => void;
  onFund: () => void;
  onSubmit: (text: string) => void;
  onComplete: (text: string) => void;
}) {
  const iAmClient = isMe(job.clientAddress, myAddress);
  const iAmProvider = isMe(job.providerAddress, myAddress);
  const iAmEvaluator = isMe(job.evaluatorAddress, myAddress);

  const myRoleLabel =
    iAmClient && iAmProvider && iAmEvaluator ? 'client · provider · evaluator' :
    iAmClient ? 'client' :
    iAmProvider ? 'provider' :
    iAmEvaluator ? 'evaluator' : 'observer';

  const pillClass =
    job.status === 'COMPLETED' ? 'ga-pill ga-pill-ok' :
    job.status === 'REJECTED' || job.status === 'EXPIRED' ? 'ga-pill ga-pill-err' :
    job.status === 'FUNDED' || job.status === 'SUBMITTED' ? 'ga-pill ga-pill-warn' :
    'ga-pill';

  return (
    <tr style={{ opacity: job.status === 'REJECTED' || job.status === 'EXPIRED' ? 0.55 : 1 }}>
      <td className="font-mono" style={{ fontSize: 11 }}>
        {job.jobId ? (
          <a
            href={`${ARC_EXPLORER}/tx/${job.createTxHash}`}
            target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 3 }}
          >
            #{job.jobId}<IconExternal size={9}/>
          </a>
        ) : (
          <em style={{ opacity: 0.5 }}>draft</em>
        )}
      </td>
      <td style={{ fontSize: 12 }}>{myRoleLabel}</td>
      <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
        {job.description}
      </td>
      <td className="font-mono" style={{ fontSize: 12 }}>
        {job.budgetUsdc ? `${job.budgetUsdc} USDC` : '-'}
      </td>
      <td><span className={pillClass}>{job.status}</span></td>
      <td style={{ fontSize: 11, opacity: 0.6 }}>{timeLabel(job.createdAt)}</td>
      <td>
        <InlineActions
          job={job}
          iAmClient={iAmClient}
          iAmProvider={iAmProvider}
          iAmEvaluator={iAmEvaluator}
          busy={busy}
          onCreateOnchain={onCreateOnchain}
          onSetBudget={onSetBudget}
          onFund={onFund}
          onSubmit={onSubmit}
          onComplete={onComplete}
        />
      </td>
    </tr>
  );
}

function InlineActions({
  job, iAmClient, iAmProvider, iAmEvaluator, busy,
  onCreateOnchain, onSetBudget, onFund, onSubmit, onComplete,
}: {
  job: JobRow;
  iAmClient: boolean;
  iAmProvider: boolean;
  iAmEvaluator: boolean;
  busy: boolean;
  onCreateOnchain: () => void;
  onSetBudget: (amt: number) => void;
  onFund: () => void;
  onSubmit: (text: string) => void;
  onComplete: (text: string) => void;
}) {
  const [budgetInput, setBudgetInput] = useState('5');
  const [submitInput, setSubmitInput] = useState('');
  const [completeInput, setCompleteInput] = useState('approved');

  if (job.status === 'COMPLETED') {
    return <span style={{ fontSize: 11, color: 'var(--green)', display: 'flex', alignItems: 'center', gap: 4 }}><IconCheck size={11}/> Settled</span>;
  }
  if (job.status === 'REJECTED' || job.status === 'EXPIRED') {
    return <span style={{ fontSize: 11, opacity: 0.4 }}>{job.status.toLowerCase()}</span>;
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {job.status === 'DRAFT' && iAmClient && (
        <button className="arc-btn arc-btn-primary" onClick={onCreateOnchain} disabled={busy} style={{ fontSize: 11, padding: '3px 10px' }}>
          <IconShield size={11}/> {busy ? 'Posting…' : 'Post on-chain'}
        </button>
      )}
      {job.status === 'OPEN' && iAmProvider && !job.budgetUsdc && (
        <>
          <input
            className="ga-input ga-input-mono"
            type="number" min="0.01" step="0.01"
            value={budgetInput}
            onChange={e => setBudgetInput(e.target.value)}
            style={{ width: 72, fontSize: 12, padding: '3px 8px' }}
          />
          <button className="arc-btn arc-btn-secondary" onClick={() => onSetBudget(parseFloat(budgetInput))} disabled={busy} style={{ fontSize: 11, padding: '3px 10px' }}>
            {busy ? 'Setting…' : 'Set budget'}
          </button>
        </>
      )}
      {job.status === 'OPEN' && iAmClient && job.budgetUsdc && (
        <button className="arc-btn arc-btn-primary" onClick={onFund} disabled={busy} style={{ fontSize: 11, padding: '3px 10px' }}>
          <IconZap size={11}/> {busy ? 'Funding…' : `Fund ${job.budgetUsdc} USDC`}
        </button>
      )}
      {job.status === 'FUNDED' && iAmProvider && (
        <>
          <input
            className="ga-input"
            placeholder="deliverable"
            value={submitInput}
            onChange={e => setSubmitInput(e.target.value)}
            style={{ width: 120, fontSize: 12, padding: '3px 8px' }}
          />
          <button className="arc-btn arc-btn-secondary" onClick={() => onSubmit(submitInput || 'delivery')} disabled={busy} style={{ fontSize: 11, padding: '3px 10px' }}>
            {busy ? 'Submitting…' : 'Submit'}
          </button>
        </>
      )}
      {job.status === 'SUBMITTED' && iAmEvaluator && (
        <>
          <input
            className="ga-input"
            placeholder="reason"
            value={completeInput}
            onChange={e => setCompleteInput(e.target.value)}
            style={{ width: 100, fontSize: 12, padding: '3px 8px' }}
          />
          <button className="arc-btn arc-btn-primary" onClick={() => onComplete(completeInput || 'approved')} disabled={busy} style={{ fontSize: 11, padding: '3px 10px' }}>
            <IconCheck size={11}/> {busy ? 'Settling…' : 'Complete'}
          </button>
        </>
      )}
    </div>
  );
}

function JobDetailCard({
  job, myAddress, busy,
  onCreateOnchain, onSetBudget, onFund, onSubmit, onComplete,
}: {
  job: JobRow;
  myAddress: string;
  busy: boolean;
  onCreateOnchain: () => void;
  onSetBudget: (amt: number) => void;
  onFund: () => void;
  onSubmit: (text: string) => void;
  onComplete: (text: string) => void;
}) {
  const iAmClient = isMe(job.clientAddress, myAddress);
  const iAmProvider = isMe(job.providerAddress, myAddress);
  const iAmEvaluator = isMe(job.evaluatorAddress, myAddress);
  const failed = job.status === 'REJECTED' || job.status === 'EXPIRED';
  const stepIdx = failed ? -1 : statusIndex(job.status);

  const txs: { label: string; hash: string | null }[] = [
    { label: 'post',   hash: job.createTxHash },
    { label: 'budget', hash: job.budgetTxHash },
    { label: 'fund',   hash: job.fundTxHash },
    { label: 'submit', hash: job.submitTxHash },
    { label: 'settle', hash: job.completeTxHash },
  ];

  const titleId = job.jobId ? `#${job.jobId}` : `draft ${job.id.slice(0, 8)}`;

  return (
    <div className="arc-card">
      <div className="arc-card-head">
        <span className="arc-card-title" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          {titleId}
          <span style={{ marginLeft: 8, fontFamily: 'var(--font-sans)', fontSize: 11, opacity: 0.5, fontWeight: 400 }}>
            {timeLabel(job.createdAt)}
          </span>
        </span>
        {txs.some(t => t.hash) && (
          <div style={{ display: 'flex', gap: 6 }}>
            {txs.map(t => t.hash && (
              <a
                key={t.label}
                className="arc-link-btn"
                href={`${ARC_EXPLORER}/tx/${t.hash}`}
                target="_blank" rel="noopener noreferrer"
                title={t.hash}
              >
                {t.label} <IconExternal size={9}/>
              </a>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, opacity: 0.8 }}>{job.description}</p>

        {/* Lifecycle stepper */}
        <div className="ga-job-stepper" data-failed={failed}>
          {LIFECYCLE.map((stage, i) => {
            const state = failed ? (i === 0 ? 'done' : 'failed') :
                          i < stepIdx ? 'done' :
                          i === stepIdx ? 'active' : 'pending';
            return (
              <React.Fragment key={stage.key}>
                <div className="ga-job-step" data-state={state}>
                  <div className="ga-job-step-dot">
                    {state === 'done' && <IconCheck size={10}/>}
                    {state === 'failed' && <IconClose size={10}/>}
                    {state === 'active' && <span className="ga-job-step-pulse"/>}
                  </div>
                  <div className="ga-job-step-label">{stage.label}</div>
                  <div className="ga-job-step-tense">{stage.tense}</div>
                </div>
                {i < LIFECYCLE.length - 1 && (
                  <div className="ga-job-step-line" data-state={state === 'done' ? 'done' : 'pending'}/>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Roles */}
        <div className="ga-job-roles">
          <RoleCell label="Client"    addr={job.clientAddress}    me={iAmClient}/>
          <RoleCell label="Provider"  addr={job.providerAddress}  me={iAmProvider}/>
          <RoleCell label="Evaluator" addr={job.evaluatorAddress} me={iAmEvaluator}/>
        </div>

        {job.error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--red)', fontSize: 12 }}>
            <IconClose size={11}/> {job.error}
          </div>
        )}

        {job.status === 'COMPLETED' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--green)', fontSize: 13 }}>
            <IconCheck size={14}/>
            Settled. <span className="ga-mono-num">{job.budgetUsdc}</span> USDC transferred to provider on Arc Testnet.
          </div>
        )}
      </div>
    </div>
  );
}

function CreateJobCard({ myAddress, onClose, onCreated }: { myAddress: string; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [providerAddr, setProviderAddr] = useState('');
  const [evaluatorAddr, setEvaluatorAddr] = useState('');
  const [description, setDescription] = useState('');
  const [expiredAtHours, setExpiredAtHours] = useState('24');
  const [submitting, setSubmitting] = useState(false);

  const useMine = (setter: (v: string) => void) => () => { if (myAddress) setter(myAddress); };

  async function handleSubmit() {
    if (!/^0x[a-fA-F0-9]{40}$/.test(providerAddr)) { toast.error('Invalid provider address'); return; }
    if (!/^0x[a-fA-F0-9]{40}$/.test(evaluatorAddr)) { toast.error('Invalid evaluator address'); return; }
    if (!description.trim()) { toast.error('Description required'); return; }
    const hours = parseInt(expiredAtHours, 10);
    if (!isFinite(hours) || hours <= 0) { toast.error('Hours must be positive'); return; }

    setSubmitting(true);
    try {
      await api.post('/jobs', {
        providerAddress: providerAddr,
        evaluatorAddress: evaluatorAddr,
        description: description.trim(),
        expiredAtSec: Math.floor(Date.now() / 1000) + hours * 3600,
      });
      toast.success('Draft saved', 'Now click "Post on-chain" on the card to publish');
      onCreated();
    } catch (err) {
      toast.error('Create failed', err instanceof Error ? err.message : undefined);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <IconShield size={13}/> Draft a new job
        </span>
        <button className="arc-link-btn" onClick={onClose}><IconClose size={13}/></button>
      </div>

      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 10, lineHeight: 1.5 }}>
        Demoing solo? Tap <strong>use mine</strong> on both fields to play all three roles
        (client, provider, evaluator) and walk the full escrow yourself.
      </div>

      <div className="ga-job-create-grid">
        <label className="ga-guardian-field">
          <span className="ga-section-label">
            Provider address
            <button className="ga-job-mineref" onClick={useMine(setProviderAddr)}>use mine</button>
          </span>
          <input
            className="ga-input ga-input-mono"
            placeholder="0x…"
            value={providerAddr}
            onChange={e => setProviderAddr(e.target.value)}
          />
        </label>
        <label className="ga-guardian-field">
          <span className="ga-section-label">
            Evaluator address
            <button className="ga-job-mineref" onClick={useMine(setEvaluatorAddr)}>use mine</button>
          </span>
          <input
            className="ga-input ga-input-mono"
            placeholder="0x…"
            value={evaluatorAddr}
            onChange={e => setEvaluatorAddr(e.target.value)}
          />
        </label>
      </div>

      <label className="ga-guardian-field">
        <span className="ga-section-label">Deliverable description (1-500 chars)</span>
        <textarea
          className="ga-input"
          rows={2}
          placeholder="e.g. Rebalance USDC across Arc and Base, return a tx report"
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </label>

      <div className="ga-job-create-grid">
        <label className="ga-guardian-field">
          <span className="ga-section-label">Expires in (hours)</span>
          <input
            className="ga-input ga-input-mono"
            type="number" min={1}
            value={expiredAtHours}
            onChange={e => setExpiredAtHours(e.target.value)}
          />
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="ga-section-label">Lifecycle</span>
          <span className="ga-meta">draft → post → fund → submit → settle</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          className="arc-btn arc-btn-primary"
          onClick={handleSubmit}
          disabled={submitting}
        >
          <IconShield size={13}/> {submitting ? 'Saving…' : 'Save draft'}
        </button>
        <button className="arc-btn arc-btn-secondary" onClick={onClose}>Cancel</button>
        <span className="ga-meta" style={{ marginLeft: 'auto' }}>Saves off-chain. Posting to Arc happens on the card.</span>
      </div>
    </div>
  );
}

function RoleCell({ label, addr, me }: { label: string; addr: string; me: boolean }) {
  return (
    <div className={`ga-job-role${me ? ' is-me' : ''}`}>
      <div className="ga-job-role-head">
        <IconUser size={11}/>
        <span>{label}</span>
        {me && <span className="ga-job-role-you">you</span>}
      </div>
      <a
        className="ga-job-role-addr"
        href={`${ARC_EXPLORER}/address/${addr}`}
        target="_blank" rel="noopener noreferrer"
      >
        {truncate(addr, 6, 4)}
        <IconExternal size={9}/>
      </a>
    </div>
  );
}
