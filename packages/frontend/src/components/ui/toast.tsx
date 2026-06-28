'use client';

import { createContext, useContext, useState, useCallback, useMemo, ReactNode, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, AlertTriangle, Info, X, Loader2, ExternalLink, Copy, Check } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info' | 'pending';

const ARC_EXPLORER = 'https://testnet.arcscan.app';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  txHash?: string | null;
  persistent?: boolean;
}

export interface ToastHandle {
  success: (title: string, description?: string, txHash?: string | null) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  update: (patch: Partial<Omit<Toast, 'id'>>) => void;
  dismiss: () => void;
}

interface ToastContextValue {
  toast: (opts: Omit<Toast, 'id'>) => void;
  success: (title: string, description?: string, txHash?: string | null) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  pending: (title: string, description?: string) => ToastHandle;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS: Record<ToastType, number> = {
  success: 5000,
  // Errors stay until the user explicitly closes them. A 6 second
  // auto-dismiss caused users to miss the message if they were not
  // looking at the toast tray, leaving them stuck wondering whether
  // their action went through.
  error:   0,
  warning: 8000,
  info:    4500,
  pending: 0,
};

function TxRow({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);
  const short = `${hash.slice(0, 8)}…${hash.slice(-6)}`;
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(hash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <div className="ga-toast-tx">
      <span className="ga-toast-tx-label">tx</span>
      <code className="ga-toast-tx-hash">{short}</code>
      <button onClick={copy} className="ga-toast-tx-btn" title="Copy hash">
        {copied ? <Check size={11} className="ga-toast-ok" /> : <Copy size={11} />}
      </button>
      <a
        href={`${ARC_EXPLORER}/tx/${hash}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="ga-toast-tx-btn"
        title="View on Arcscan"
      >
        <ExternalLink size={11} />
      </a>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const patch = useCallback((id: string, p: Partial<Omit<Toast, 'id'>>) => {
    setToasts(prev => prev.map(t => (t.id === id ? { ...t, ...p } : t)));
  }, []);

  const toast = useCallback((opts: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, ...opts }]);
    // ttl 0 means stay forever (until user clicks X)
    const ttl = opts.persistent ? 0 : AUTO_DISMISS_MS[opts.type];
    if (ttl > 0) setTimeout(() => dismiss(id), ttl);
  }, [dismiss]);

  const success = useCallback((title: string, description?: string, txHash?: string | null) =>
    toast({ type: 'success', title, description, txHash }), [toast]);
  const error   = useCallback((title: string, description?: string) =>
    toast({ type: 'error',   title, description }), [toast]);
  const warning = useCallback((title: string, description?: string) =>
    toast({ type: 'warning', title, description }), [toast]);
  const info    = useCallback((title: string, description?: string) =>
    toast({ type: 'info',    title, description }), [toast]);

  const pending = useCallback((title: string, description?: string): ToastHandle => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, type: 'pending', title, description, persistent: true }]);
    const schedule = (type: ToastType) => {
      const ttl = AUTO_DISMISS_MS[type];
      if (ttl > 0) setTimeout(() => dismiss(id), ttl);
    };
    return {
      success: (t, d, hash) => {
        patch(id, { type: 'success', title: t, description: d, txHash: hash ?? null, persistent: false });
        schedule('success');
      },
      error: (t, d) => {
        // persistent: true so the error sticks until the user dismisses it,
        // matching the global toast() behaviour for type='error'.
        patch(id, { type: 'error', title: t, description: d, persistent: true });
      },
      info: (t, d) => {
        patch(id, { type: 'info', title: t, description: d, persistent: false });
        schedule('info');
      },
      update: (p) => patch(id, p),
      dismiss: () => dismiss(id),
    };
  }, [dismiss, patch]);

  // Memoize so toast state changes (e.g. a bridge tracker patching its toast
  // every few seconds) do not re-render every useToast() consumer in the app.
  const ctxValue = useMemo(
    () => ({ toast, success, error, warning, info, pending }),
    [toast, success, error, warning, info, pending],
  );

  return (
    <ToastContext.Provider value={ctxValue}>
      {children}
      <div className="ga-toast-tray">
        <AnimatePresence>
          {toasts.map(t => (
            <ToastCard key={t.id} t={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ t, onDismiss }: { t: Toast; onDismiss: () => void }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (t.type !== 'pending') return;
    let cancelled = false;
    let p = 0;
    const tick = () => {
      if (cancelled) return;
      p = p + (95 - p) * 0.025;
      setProgress(p);
      setTimeout(tick, 220);
    };
    tick();
    return () => { cancelled = true; };
  }, [t.type]);

  const Icon = {
    success: CheckCircle2,
    error:   XCircle,
    warning: AlertTriangle,
    info:    Info,
    pending: Loader2,
  }[t.type];

  return (
    <motion.div
      initial={{ opacity: 0, x: 60, scale: 0.92 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.92, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', bounce: 0.28, duration: 0.45 }}
      layout
      className={`ga-toast ga-toast-${t.type}`}
    >
      <div className="ga-toast-scan"/>
      <div className="ga-toast-row">
        <div className={`ga-toast-icon${t.type === 'pending' ? ' ga-toast-icon-spin' : ''}`}>
          <Icon size={16}/>
        </div>
        <div className="ga-toast-body">
          <div className="ga-toast-title">{t.title}</div>
          {t.description && <div className="ga-toast-desc">{t.description}</div>}
          {t.txHash && <TxRow hash={t.txHash} />}
        </div>
        {t.type !== 'pending' && (
          <button onClick={onDismiss} className="ga-toast-close" aria-label="Dismiss">
            <X size={14}/>
          </button>
        )}
      </div>
      {t.type === 'pending' && (
        <div className="ga-toast-progress">
          <motion.div
            className="ga-toast-progress-fill"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.22, ease: 'linear' }}
          />
        </div>
      )}
    </motion.div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
