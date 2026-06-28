'use client';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

let cachedToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: () => void) {
  unauthorizedHandler = fn;
}

export function setApiToken(token: string | null) {
  cachedToken = token;
  if (token) {
    if (typeof window !== 'undefined') localStorage.setItem('ga-api-token', token);
  } else {
    if (typeof window !== 'undefined') localStorage.removeItem('ga-api-token');
  }
}

export function getApiToken(): string | null {
  if (cachedToken) return cachedToken;
  if (typeof window !== 'undefined') {
    cachedToken = localStorage.getItem('ga-api-token');
  }
  return cachedToken;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getApiToken();
  const res = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    if (res.status === 401) {
      setApiToken(null);
      unauthorizedHandler?.();
    }
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const msg = typeof body.error === 'string' ? body.error
      : typeof body.message === 'string' ? body.message
      : res.statusText || 'Request failed';
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export async function exchangePrivyToken(accessToken: string, email?: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/auth/privy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken, email }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Auth failed');
  }
  const data = await res.json() as { token: string };
  setApiToken(data.token);
  return data.token;
}
