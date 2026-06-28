'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="min-h-[200px] flex flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="text-red-400 font-semibold text-sm">Something went wrong</div>
          <div className="text-xs max-w-md" style={{ color: 'var(--text-muted)' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-2 px-4 py-1.5 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
