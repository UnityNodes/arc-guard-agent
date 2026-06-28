'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { IconSparkle, IconCheck, IconClose, IconExternal, IconSend } from '@/components/Icons';
import { useAppShell } from '@/contexts/AppShellContext';

type Message = { role: 'agent' | 'you'; kind?: 'text' | 'action'; text?: string; title?: string; summary?: string; meta?: string; confirm?: string };

const suggestions = ['check USDC balance', 'send 50 USDC, ask me first', 'list pending approvals', 'what is my spending limit'];

export function ChatDock() {
  const router = useRouter();
  const pathname = usePathname();
  const { chatOpen, setChatOpen } = useAppShell();
  const [messages, setMessages] = useState<Message[]>([
    { role: 'agent', kind: 'text', text: "GuardAgent here. Tell me what to do. Actions above your Guardian threshold go to Telegram for approval first." },
  ]);
  const [draft, setDraft] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘K (and Ctrl+K on Windows/Linux) jumps to the real chat page,
      // mirroring the launcher click. No-op if we are already on /chat.
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (pathname !== '/chat') router.push('/chat');
      }
      if (e.key === 'Escape' && chatOpen) setChatOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chatOpen, setChatOpen, pathname, router]);

  if (pathname === '/chat') return null;

  const send = (text: string) => {
    if (!text.trim()) return;
    const newMsgs: Message[] = [...messages, { role: 'you', kind: 'text', text }];
    setMessages(newMsgs);
    setDraft('');
    setTimeout(() => {
      const lower = text.toLowerCase();
      let reply: Message;
      if (lower.includes('send') && lower.match(/\d/)) {
        const m = text.match(/(\d+(?:[.,]\d+)?)\s*(usdc|eurc)/i);
        const amt = m?.[1] ?? '50'; const token = m?.[2]?.toUpperCase() ?? 'USDC';
        reply = { role: 'agent', kind: 'action', title: 'Approval required', summary: `Send ${amt} ${token} · Guardian threshold reached`, meta: 'Telegram approval request sent · expires in 10 min', confirm: 'Confirm send' };
      } else if (lower.includes('swap') && lower.match(/\d/)) {
        const m = text.match(/(\d+(?:[.,]\d+)?)\s*(\w{3,5})\s*(?:to|->|→)\s*(\w{3,5})/i);
        const amt = m?.[1] ?? '100'; const from = m?.[2]?.toUpperCase() ?? 'USDC'; const to = m?.[3]?.toUpperCase() ?? 'EURC';
        reply = { role: 'agent', kind: 'action', title: 'Swap quote', summary: `${amt} ${from} → ${to}`, meta: 'Gas paid in USDC · settlement ~1s · Arc Testnet', confirm: 'Execute swap' };
      } else if (lower.includes('alert')) {
        reply = { role: 'agent', kind: 'action', title: 'Alert configured', summary: 'Balance alert armed', meta: 'Channel: Telegram · checks every 30s', confirm: 'Arm alert' };
      } else if (lower.includes('limit') || lower.includes('spending')) {
        reply = { role: 'agent', kind: 'text', text: 'Your Guardian policy: per-tx $100 · daily $500 · allowed tokens: USDC, EURC. Change it in the Guardian page.' };
      } else if (lower.includes('pause')) {
        reply = { role: 'agent', kind: 'action', title: 'Pause agent', summary: 'Agent will stop executing until resumed', meta: 'Existing Guardian policy preserved · resume anytime', confirm: 'Pause' };
      } else {
        reply = { role: 'agent', kind: 'text', text: 'I can send USDC, swap tokens, set balance alerts, or query your Guardian policy. Actions above your spending limit go to Telegram for approval.' };
      }
      setMessages([...newMsgs, reply]);
    }, 600);
  };

  // Launcher routes to the real /chat page where Aegis lives. The inline
  // dock below is a thin canned-reply demo, not the real agent, so opening
  // it from the launcher created the impression that the chat was broken.
  // The keyboard shortcut (⌘K) also goes to /chat for consistency.
  if (!chatOpen) {
    return (
      <button className="ga-launcher" onClick={() => router.push('/chat')}>
        <span className="ga-launcher-orb" />
        <span className="ga-launcher-text">
          <span className="ga-launcher-eyebrow">Aegis</span>
          <span className="ga-launcher-label">Ask the agent</span>
        </span>
      </button>
    );
  }

  return (
    <div className="chat-dock">
      <div className="chat-dock-head">
        <div className="chat-dock-orb"/>
        <div>
          <div className="chat-dock-title">GuardAgent</div>
          <div className="chat-dock-sub">execution: signed · Arc Testnet</div>
        </div>
        <div style={{ flex: 1 }}/>
        <button className="btn btn-quiet btn-icon" onClick={() => { setChatOpen(false); router.push('/chat'); }}>
          <IconExternal size={14}/>
        </button>
        <button className="btn btn-quiet btn-icon" onClick={() => setChatOpen(false)}>
          <IconClose size={14}/>
        </button>
      </div>
      <div className="chat-dock-body" ref={bodyRef}>
        {messages.map((m, i) => {
          if (m.kind === 'action') return (
            <div key={i} className="chat-msg agent-action">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <IconSparkle size={14} style={{ color: 'var(--amber-400)' }}/>
                <span style={{ fontSize: 11, color: 'var(--amber-300)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{m.title}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>{m.summary}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', marginBottom: 12 }}>{m.meta}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-agent btn-sm" style={{ flex: 1 }}><IconCheck size={13}/> {m.confirm}</button>
                <button className="btn btn-ghost btn-sm">Cancel</button>
              </div>
            </div>
          );
          return <div key={i} className={`chat-msg ${m.role}`} style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>;
        })}
      </div>
      {messages.length <= 1 && (
        <div className="chat-suggest">
          {suggestions.map((s, i) => <button key={i} onClick={() => send(s)}>{s}</button>)}
        </div>
      )}
      <div className="chat-input-row">
        <textarea className="chat-input" rows={1} placeholder="Tell the agent what to do…" value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(draft); } }}/>
        <button className="chat-send" onClick={() => send(draft)}><IconSend size={14}/></button>
      </div>
    </div>
  );
}
