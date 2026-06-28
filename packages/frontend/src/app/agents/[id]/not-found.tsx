import Link from 'next/link';

export default function AgentNotFound() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-300 font-sans flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <Link href="/" className="text-blue-400 font-bold text-lg hover:text-blue-300 transition mb-12 inline-block">
          🛡️ GuardAgent
        </Link>
        <h1 className="text-4xl font-extrabold text-white mb-3">Agent not found</h1>
        <p className="text-gray-400 mb-8">
          This token id is not registered in the ERC-8004 IdentityRegistry on Arc Testnet.
          Try a different id, or check the registry on{' '}
          <a
            href="https://testnet.arcscan.app/address/0x8004A818BFB912233c491871b3d84c89A494BD9e"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300"
          >
            Arcscan
          </a>.
        </p>
        <Link
          href="/"
          className="inline-block px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md transition text-sm"
        >
          Back to GuardAgent
        </Link>
      </div>
    </div>
  );
}
