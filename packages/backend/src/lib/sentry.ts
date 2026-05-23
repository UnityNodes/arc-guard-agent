import * as Sentry from '@sentry/node';

const DSN = process.env.SENTRY_DSN;

const SENSITIVE_HEADERS = ['authorization', 'cookie', 'x-auth-token', 'proxy-authorization'];
const SECRET_KEY_PATTERN = /(token|secret|password|mnemonic|private[_-]?key|jwt|bearer|api[_-]?key)/i;

function scrubObject(obj: unknown, depth = 0): unknown {
  if (obj == null || depth > 6) return obj;
  if (typeof obj === 'string') {
    // Redact any JWT-looking substring (three base64url segments separated by dots).
    return obj.replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[REDACTED_JWT]');
  }
  if (Array.isArray(obj)) return obj.map((v) => scrubObject(v, depth + 1));
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(k)) { out[k] = '[REDACTED]'; continue; }
      out[k] = scrubObject(v, depth + 1);
    }
    return out;
  }
  return obj;
}

export function initSentry() {
  if (!DSN) {
    console.log('[sentry] No SENTRY_DSN configured, skipping');
    return;
  }
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    enabled: !!DSN,
    beforeSend(event) {
      // Strip sensitive request headers that default Express integration attaches.
      if (event.request?.headers) {
        const h = event.request.headers as Record<string, string>;
        for (const name of Object.keys(h)) {
          if (SENSITIVE_HEADERS.includes(name.toLowerCase())) h[name] = '[REDACTED]';
        }
      }
      if (event.request?.cookies) event.request.cookies = { redacted: '[REDACTED]' };
      if (event.request?.query_string && typeof event.request.query_string === 'string') {
        event.request.query_string = event.request.query_string.replace(/([?&](token|secret|key|jwt|bearer|password)=)[^&]+/gi, '$1[REDACTED]');
      }
      if (event.extra) event.extra = scrubObject(event.extra) as Record<string, unknown>;
      if (event.contexts) event.contexts = scrubObject(event.contexts) as typeof event.contexts;
      if (Array.isArray(event.breadcrumbs)) {
        event.breadcrumbs = event.breadcrumbs.map((b) => ({
          ...b,
          data: b.data ? (scrubObject(b.data) as Record<string, unknown>) : b.data,
          message: typeof b.message === 'string' ? (scrubObject(b.message) as string) : b.message,
        }));
      }
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data) breadcrumb.data = scrubObject(breadcrumb.data) as Record<string, unknown>;
      return breadcrumb;
    },
  });
  console.log('[sentry] Initialized (PII scrubbing enabled)');
}

export { Sentry };
