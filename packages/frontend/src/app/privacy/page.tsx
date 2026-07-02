import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy · GuardAgent',
  description: 'Privacy Policy for GuardAgent. We collect only what we need and never touch your private keys.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-300 font-sans">
      <div className="max-w-3xl mx-auto px-6 py-12 pb-20">

        {/* Logo */}
        <div className="mb-12">
          <Link href="/" className="text-blue-400 font-bold text-lg hover:text-blue-300 transition">
            🛡️ GuardAgent
          </Link>
        </div>

        <h1 className="text-4xl font-extrabold text-white mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-12">Last updated April 4, 2026. Effective immediately upon use of the service.</p>

        <div className="bg-blue-950/40 border-l-4 border-blue-500 px-5 py-4 rounded-r-lg mb-10">
          <p className="text-blue-300">
            We built GuardAgent on a non-custodial model on purpose. We collect only what we need to make the service work, and we never touch your real wallet or private keys.
          </p>
        </div>

        <Section title="Who We Are">
          <p>GuardAgent is a crypto portfolio monitoring service. Questions about your data: <a href="mailto:guardagent.org@gmail.com" className="text-blue-400 hover:text-blue-300">guardagent.org@gmail.com</a>.</p>
        </Section>

        <Section title="What We Collect and Why">
          <p>You sign in with email or a social provider (Google, Apple, etc.) via Privy (our identity provider). Privy provisions an embedded wallet for you on first sign-in, which is used to identify your account and authorize on-chain operations under your Guardian policy. You remain in control of the embedded wallet; GuardAgent never sees your private keys or seed phrases.</p>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-900 text-left">
                  <th className="px-4 py-3 text-gray-400 font-semibold border-b border-gray-800">Data</th>
                  <th className="px-4 py-3 text-gray-400 font-semibold border-b border-gray-800">Why we have it</th>
                  <th className="px-4 py-3 text-gray-400 font-semibold border-b border-gray-800">Retention</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Email (via Privy)', 'Login + organization invites + critical notifications', 'Until account deleted'],
                  ['Wallet address (via Privy embedded wallet)', 'Authorizes on-chain operations under your Guardian policy', 'Until account deleted'],
                  ['Price rules', 'Token, condition, threshold you set so we know when to notify you', 'Until rule or account deleted'],
                  ['Alert history', 'Record of triggered alerts and prices at the time', 'Until account deleted'],
                  ['Chat messages', 'Conversations with AI agent and alert notifications', 'Until account deleted'],
                  ['Agent wallet address & settings', 'Only if you create an agent wallet (address, limits, network)', 'Until account deleted'],
                  ['Session token', 'JWT that keeps you logged in. Expires after 7 days.', '7 days'],
                  ['Plan status', 'Free or Pro (determines feature limits)', 'Until account deleted'],
                ].map(([data, why, retention]) => (
                  <tr key={data} className="border-b border-gray-900 hover:bg-gray-900/40 transition">
                    <td className="px-4 py-3 text-gray-200 font-medium">{data}</td>
                    <td className="px-4 py-3 text-gray-500">{why}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{retention}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="What We Do Not Collect">
          <p>Beyond your email (held by Privy for login) and Privy-provided wallet address, we do not collect your name, phone number, browser fingerprint, or any information about the assets in personal wallets outside the agent wallet you explicitly create with us. We do not run advertising, and we do not sell your data to anyone.</p>
          <p>Your chat messages are processed by third-party AI models to generate responses, but we do not use your conversation history to train AI models.</p>
        </Section>

        <Section title="Third-Party Services That Receive Your Data">
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-900 text-left">
                  <th className="px-4 py-3 text-gray-400 font-semibold border-b border-gray-800">Service</th>
                  <th className="px-4 py-3 text-gray-400 font-semibold border-b border-gray-800">What it receives</th>
                  <th className="px-4 py-3 text-gray-400 font-semibold border-b border-gray-800">Why</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Privy', 'Email, optional Google/Apple OAuth profile, embedded wallet address', 'User authentication, account management, and embedded wallet provisioning'],
                  ['Circle', 'Agent wallet address & transactions (if agent wallet created)', 'Creates the agent wallet, executes operations on Arc'],
                  ['Pyth Network', 'No personal data (public price feeds only)', 'Real-time token prices for monitoring'],
                  ['Groq', 'Chat messages and alert context', 'Primary AI provider'],
                  ['OpenRouter', 'Chat messages and alert context (fallback only)', 'Backup AI provider'],
                  ['Anthropic', 'Chat messages (Aegis tool-use brain)', 'AI reasoning and tool orchestration'],
                ].map(([svc, what, why]) => (
                  <tr key={svc} className="border-b border-gray-900 hover:bg-gray-900/40 transition">
                    <td className="px-4 py-3 text-gray-200 font-medium">{svc}</td>
                    <td className="px-4 py-3 text-gray-500">{what}</td>
                    <td className="px-4 py-3 text-gray-600">{why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm">
            Each service has its own policy:{' '}
            <a href="https://www.privy.io/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Privy</a>
            {' · '}
            <a href="https://www.circle.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Circle</a>
            {' · '}
            <a href="https://groq.com/privacy-policy/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Groq</a>
            {' · '}
            <a href="https://openrouter.ai/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">OpenRouter</a>
            {' · '}
            <a href="https://www.anthropic.com/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Anthropic</a>
          </p>
        </Section>

        <Section title="Your Wallet Is Not Our Business">
          <p>Wallet authorization happens through your Privy embedded wallet. Privy holds the key material on your behalf using its passkey/MPC infrastructure, and you authorize each action through Privy's UI. No transaction, no gas, nothing moves during sign-in itself. We never see your private key or seed phrase.</p>
          <p>The agent wallet, when you create one, is managed by Circle Developer-Controlled Wallets using MPC; the key material is split between you and Circle and is never stored in our database. Aegis (our AI brain) optionally holds its own separate Circle CLI agent-wallet on a mainnet chain to pay for x402 data feeds. That wallet is independent from your treasury and operates under a per-call USDC spending cap.</p>
        </Section>

        <Section title="Data Security">
          <p>All data is transmitted over encrypted connections (HTTPS). Authentication tokens are signed with a secret key and expire automatically. Our database is not exposed to the public internet.</p>
        </Section>

        <Section title="Your Rights">
          <p>You can delete your price rules and chat history at any time from within the app. To delete your entire account and all data, email <a href="mailto:guardagent.org@gmail.com" className="text-blue-400 hover:text-blue-300">guardagent.org@gmail.com</a>.</p>
          <p>EU/California users may have additional GDPR/CCPA rights. Contact us and we will work with you.</p>
        </Section>

        <Section title="Cookies and Tracking">
          <p>GuardAgent does not use advertising cookies, tracking pixels, or third-party analytics. The only browser storage used is your authentication token to keep you logged in.</p>
        </Section>

        <Section title="Contact">
          <p>Privacy questions: <a href="mailto:guardagent.org@gmail.com" className="text-blue-400 hover:text-blue-300">guardagent.org@gmail.com</a>. We aim to respond within 5 business days.</p>
        </Section>

        <hr className="border-gray-800 my-10" />

        <div className="text-center text-xs text-gray-600 space-x-4">
          <Link href="/terms" className="hover:text-gray-400 transition">Terms of Service</Link>
          <span>·</span>
          <Link href="/whitepaper" className="hover:text-gray-400 transition">Whitepaper</Link>
          <span>·</span>
          <Link href="/" className="hover:text-gray-400 transition">Back to app</Link>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-white mb-3 mt-10">{title}</h2>
      <div className="space-y-3 text-gray-400 leading-relaxed">{children}</div>
    </section>
  );
}
