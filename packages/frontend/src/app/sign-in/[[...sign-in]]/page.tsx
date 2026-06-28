'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLoginWithEmail, usePrivy } from '@privy-io/react-auth';
import { BrandMark } from '@/components/Icons';
import { exchangePrivyToken, getApiToken } from '@/lib/api';

type Step = 'email' | 'code' | 'exchanging';

export default function SignInPage() {
  const router = useRouter();
  const { ready, authenticated, getAccessToken } = usePrivy();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { sendCode, loginWithCode, state } = useLoginWithEmail({
    onComplete: async ({ user: privyUser }) => {
      setStep('exchanging');
      try {
        const token = await getAccessToken();
        if (!token) throw new Error('No access token from Privy');
        const userEmail = (privyUser as { email?: { address?: string } })?.email?.address ?? email;
        await exchangePrivyToken(token, userEmail || undefined);
        router.push('/dashboard');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Exchange failed');
        setStep('email');
      }
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : typeof err === 'string' ? err : 'Auth failed');
      setLoading(false);
    },
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', localStorage.getItem('ga-theme') ?? 'dark');
  }, []);

  useEffect(() => {
    if (ready && authenticated && getApiToken()) {
      router.push('/dashboard');
    }
  }, [ready, authenticated, router]);

  const handleSendCode = async () => {
    if (loading) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Enter a valid email'); return; }
    setLoading(true); setError(null);
    try {
      await sendCode({ email });
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (loading || code.length < 6) return;
    setLoading(true); setError(null);
    try {
      await loginWithCode({ code });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  const isExchanging = step === 'exchanging' || state.status === 'done';

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg-0)', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <BrandMark size={48} />
          <div style={{ fontSize: 22, fontWeight: 600 }}>Sign in to GuardAgent</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', textAlign: 'center' }}>
            Email one-time code · no password · no seed phrase
          </div>
        </div>

        {isExchanging ? (
          <div style={{ textAlign: 'center', color: 'var(--ink-3)', fontSize: 14 }}>
            Signing you in…
          </div>
        ) : step === 'email' ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                placeholder="you@example.com"
                autoFocus
              />
            </div>
            <button className="btn btn-agent btn-lg" disabled={loading || !ready} onClick={handleSendCode}>
              {loading ? 'Sending code…' : 'Continue with email'}
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', textAlign: 'center' }}>
              We sent a 6-digit code to <strong>{email}</strong>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label className="label">One-time code</label>
              <input
                className="input"
                type="text"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyCode()}
                placeholder="123456"
                autoFocus
              />
            </div>
            <button className="btn btn-agent btn-lg" disabled={loading || code.length < 6} onClick={handleVerifyCode}>
              {loading ? 'Verifying…' : 'Verify code'}
            </button>
            <button
              className="btn"
              style={{ background: 'transparent', color: 'var(--ink-3)', border: 'none', cursor: 'pointer', fontSize: 12 }}
              onClick={() => { setStep('email'); setCode(''); setError(null); }}
            >
              ← Use a different email
            </button>
          </>
        )}

        {error && <div style={{ fontSize: 12, color: 'var(--err)' }}>{error}</div>}

        <div style={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'center', marginTop: 8 }}>
          We email you a one-time code. No password or seed phrase needed.
        </div>
      </div>
    </div>
  );
}
