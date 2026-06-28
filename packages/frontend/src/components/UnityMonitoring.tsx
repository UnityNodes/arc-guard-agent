/**
 * Unity Nodes monitoring - Plausible + GlitchTip (Sentry CDN, no npm dep).
 */
'use client';

import Script from 'next/script';

interface Props {
  domain?: string;
  dsn?: string;
}

export function UnityMonitoring({ domain, dsn }: Props) {
  const d = domain ?? process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  const s = dsn ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!d && !s) return null;
  if (process.env.NODE_ENV !== 'production') return null;

  return (
    <>
      {d && (
        <>
          <Script defer data-domain={d}
            src="https://stats.unitynodes.com/js/script.outbound-links.js"
            strategy="afterInteractive" />
          <Script id="unity-plausible-shim" strategy="afterInteractive"
            dangerouslySetInnerHTML={{ __html:
              `window.plausible=window.plausible||function(){(window.plausible.q=window.plausible.q||[]).push(arguments)}`,
            }} />
        </>
      )}
      {s && (
        <>
          <Script src="https://browser.sentry-cdn.com/8.49.0/bundle.min.js"
            crossOrigin="anonymous" strategy="afterInteractive" />
          <Script id="unity-sentry-init" strategy="afterInteractive"
            dangerouslySetInnerHTML={{ __html:
              `if(window.Sentry){Sentry.init({dsn:${JSON.stringify(s)},environment:'production',tracesSampleRate:0.1,ignoreErrors:[/ResizeObserver loop/,/Non-Error promise rejection/,/Load failed/]})}`,
            }} />
        </>
      )}
    </>
  );
}
