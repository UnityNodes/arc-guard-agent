import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service · GuardAgent',
  description: 'Terms of Service for GuardAgent stablecoin operations platform on Arc.',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-300 font-sans">
      <div className="max-w-3xl mx-auto px-6 py-12 pb-20">

        {/* Logo */}
        <div className="mb-12">
          <Link href="/" className="text-blue-400 font-bold text-lg hover:text-blue-300 transition">
            🛡️ GuardAgent
          </Link>
        </div>

        <h1 className="text-4xl font-extrabold text-white mb-2">Terms of Service</h1>
        <p className="text-sm text-gray-500 mb-12">Last updated April 4, 2026. Effective immediately upon use of the service.</p>

        <div className="bg-blue-950/40 border-l-4 border-blue-500 px-5 py-4 rounded-r-lg mb-10">
          <p className="text-blue-300">
            Please read these terms carefully before using GuardAgent. By connecting your wallet and using this service, you agree to everything described below.
          </p>
        </div>

        <Section title="What GuardAgent Is">
          <p>GuardAgent is a stablecoin operations platform built on Arc. It watches token prices around the clock, sends you alerts when prices hit your defined thresholds, and can execute protective swaps on your behalf through a separate agent wallet that you control and fund independently.</p>
          <p>GuardAgent is operated by GuardAgent ("we", "us", "our"). By using this service, you enter into a binding agreement with us under these Terms of Service.</p>
        </Section>

        <Section title="Your Wallet and Your Keys">
          <p>GuardAgent operates on a strictly non-custodial basis. We <strong className="text-gray-200">never have access to your private keys, seed phrases, or the funds in your personal wallet.</strong></p>
          <p>You sign in with email or a social provider (Google, Apple, etc.) via Privy (our identity provider). Privy provisions an embedded wallet for you on first sign-in. You remain in control of that wallet. GuardAgent never sees your private keys or seed phrases.</p>
          <p>Your email and Privy-provided wallet address together identify your account. GuardAgent reads publicly available blockchain data to monitor prices and alert you, but it has no ability to move, access, or influence the assets in your personal wallet.</p>
        </Section>

        <Section title="The Agent Wallet">
          <p>GuardAgent offers an optional feature where a separate, dedicated agent wallet is created for you using Circle Developer-Controlled Wallets on Arc. This wallet is distinct from your personal wallet. You choose whether to fund it and how much to put in. The agent wallet is used exclusively to execute stablecoin operations (for example, swapping USDC to EURC) when you ask it to or when you enable AutoMode.</p>
          <div className="bg-amber-950/30 border-l-4 border-amber-500 px-5 py-4 rounded-r-lg my-5">
            <p className="text-amber-300 m-0">The agent wallet is funded by you and used only at your direction or with your explicit consent through AutoMode settings. Swaps carry inherent risks including price slippage, failed transactions, and market volatility. GuardAgent is not responsible for losses resulting from swap execution.</p>
          </div>
          <p>You set the maximum transaction size and daily limits for the agent wallet. These limits cannot be exceeded without your intervention. You can withdraw funds from the agent wallet at any time.</p>
        </Section>

        <Section title="AI Recommendations Are Not Financial Advice">
          <p>GuardAgent uses AI models (provided by Groq and OpenRouter) to generate insights and recommendations when your price alerts trigger. These insights are based on publicly available market data and are provided for informational purposes only.</p>
          <div className="bg-amber-950/30 border-l-4 border-amber-500 px-5 py-4 rounded-r-lg my-5">
            <p className="text-amber-300 m-0"><strong className="text-amber-200">Nothing GuardAgent says, suggests, or recommends constitutes financial advice, investment advice, or trading advice.</strong> All investment decisions are yours alone. You are solely responsible for evaluating any information GuardAgent provides before acting on it.</p>
          </div>
        </Section>

        <Section title="Price Alerts and Monitoring">
          <p>GuardAgent monitors prices using the Pyth Network price oracle. We make reasonable efforts to deliver alerts promptly, but we cannot guarantee that every alert will be delivered on time or at all. Price data may occasionally be delayed, unavailable, or inaccurate due to factors outside our control including oracle outages, network congestion, or third-party service disruptions.</p>
          <p>Do not rely on GuardAgent as your only source of monitoring for time-critical trading decisions.</p>
        </Section>

        <Section title="Acceptable Use">
          <p>You agree to use GuardAgent only for lawful purposes. You will not attempt to reverse-engineer, scrape, or abuse the service. You will not use GuardAgent to facilitate market manipulation, money laundering, or any activity that violates applicable law.</p>
          <p>We reserve the right to suspend or terminate your access if we believe you are violating these terms or misusing the service.</p>
        </Section>

        <Section title="Free and Pro Plans">
          <p>GuardAgent offers a free plan with up to 10 price rules and a Pro plan with expanded limits. We reserve the right to change pricing, features, and plan structures at any time with reasonable notice. Existing users will be given advance notice before any charges apply.</p>
        </Section>

        <Section title="Third-Party Services">
          <p>GuardAgent depends on several external services including Circle, Pyth Network, Groq, and OpenRouter. We are not responsible for the availability, accuracy, or performance of these third-party services.</p>
        </Section>

        <Section title="No Warranties">
          <p>GuardAgent is provided on an "as is" and "as available" basis. We make no warranties of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or uninterrupted availability.</p>
        </Section>

        <Section title="Limitation of Liability">
          <p>To the fullest extent permitted by law, GuardAgent and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including but not limited to loss of funds, missed trades, failed swaps, or financial losses of any kind arising from your use of the service.</p>
          <p>You use this service at your own risk. Crypto markets are volatile and unpredictable. Past performance of any strategy or recommendation does not guarantee future results.</p>
        </Section>

        <Section title="Governing Law">
          <p>These Terms are governed by the laws of the State of Delaware, United States, without regard to its conflict of law provisions.</p>
        </Section>

        <Section title="Contact">
          <p>If you have any questions about these Terms, you can reach us at{' '}
            <a href="mailto:guardagent.org@gmail.com" className="text-blue-400 hover:text-blue-300">guardagent.org@gmail.com</a>.
          </p>
        </Section>

        <hr className="border-gray-800 my-10" />

        <div className="text-center text-xs text-gray-600 space-x-4">
          <Link href="/privacy" className="hover:text-gray-400 transition">Privacy Policy</Link>
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
