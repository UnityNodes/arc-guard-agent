'use client';

import { useRef, useState, KeyboardEvent, ChangeEvent } from 'react';
import { motion } from 'framer-motion';
import { Send } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AnimatedAIInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  suggestions?: string[];
}

export function AnimatedAIInput({
  value,
  onChange,
  onSubmit,
  placeholder = 'Ask AI anything...',
  loading = false,
  disabled = false,
  className,
  suggestions = [],
}: AnimatedAIInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);

  const hasText = value.trim().length > 0;

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (hasText && !loading) onSubmit();
    }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  return (
    <div className={cn(className)}>
      {/* Input container */}
      <div className={cn(
        'relative flex items-center gap-2 rounded-2xl border transition-all duration-200 px-3 py-2',
        focused
          ? 'bg-[#07070f] border-indigo-500/50 shadow-[0_0_0_3px_rgba(99,102,241,0.08)]'
          : 'bg-[#07070f] border-[#252538]',
      )}>
        {/* Animated border glow when focused */}
        {focused && (
          <motion.div
            className="pointer-events-none absolute inset-0 rounded-2xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              background: 'linear-gradient(90deg, rgba(99,102,241,0.08) 0%, transparent 50%, rgba(59,130,246,0.06) 100%)',
            }}
          />
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          disabled={disabled || loading}
          rows={1}
          className="relative flex-1 bg-transparent text-sm text-white placeholder-slate-600 focus:outline-none resize-none min-h-[22px] max-h-[120px] leading-normal py-0 z-10"
        />

        {/* Send button */}
        <motion.button
          onClick={onSubmit}
          disabled={!hasText || loading || disabled}
          whileTap={{ scale: 0.9 }}
          className={cn(
            'relative z-10 w-8 h-8 rounded-xl flex items-center justify-center transition-all shrink-0',
            hasText && !loading
              ? 'bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-lg shadow-indigo-900/40 hover:from-indigo-500 hover:to-blue-500'
              : 'bg-[#1c1c2e] text-slate-600 cursor-not-allowed',
          )}
        >
          {loading ? (
            <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Send size={14} />
          )}
        </motion.button>
      </div>
    </div>
  );
}
