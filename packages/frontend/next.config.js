/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@coinbase/onchainkit'],

  // ── Performance: compress + optimize ─────────────────────────
  compress: true,  // gzip fallback (Cloudflare handles Brotli at edge)
  poweredByHeader: false,  // Remove X-Powered-By header

  // ── Security + caching headers for Cloudflare CDN ────────────
  // On app.guardagent.org the root path serves the dashboard. The marketing
  // landing only lives on guardagent.org. Using a Next.js rewrite (not a
  // Caddy redirect) keeps the URL bar clean and lets the client router stay
  // in sync, so navigating to /wallet, /chat etc. still works normally.
  //
  // beforeFiles is required so the rewrite fires BEFORE Next.js looks for a
  // page at /. The array-returning shorthand puts entries in afterFiles,
  // where the / page (landing) would already match and the rewrite never
  // kicks in.
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/',
          destination: '/dashboard',
          has: [{ type: 'host', value: 'app.guardagent.org' }],
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },

  async headers() {
    return [
      {
        // HTML pages: NEVER cache at CDN (Cloudflare) level.
        // s-maxage=60 caused Cloudflare to serve stale HTML after deploy,
        // referencing old JS chunk hashes → 502 Bad Gateway on those chunks.
        // no-store ensures every request gets fresh HTML with correct chunk refs.
        // MUST come first - overridden by static rules below for asset paths.
        source: '/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
          // Security headers
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Strict Transport Security, tells browsers to always use HTTPS
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
      {
        // Static JS/CSS chunks - content-addressed hashes, safe to immutable-cache forever.
        // This OVERRIDES the no-store rule above for /_next/static/* paths.
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // Images, fonts, icons - long browser cache
        source: '/:path*.(ico|png|jpg|jpeg|svg|webp|woff|woff2)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=2592000' },
        ],
      },
    ];
  },

  webpack: (config, { isServer }) => {
    // Optional/native deps that don't exist in browser context
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      crypto: false,
      'pino-pretty': false,
      '@react-native-async-storage/async-storage': false,
      'lokijs': false,
      'utf-8-validate': false,
      'bufferutil': false,
      'encoding': false,
      '@farcaster/mini-app-solana': false,
      '@solana/web3.js': false,
    };
    // Suppress optional dependency warnings
    config.plugins = config.plugins || [];
    return config;
  },
};

module.exports = nextConfig;
