'use client';

import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { injected } from 'wagmi/connectors';

export function useWalletConnect() {
  const { address, isConnected, isConnecting } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  const connectMetaMask = () => connect({ connector: injected() });

  const shortAddress = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : null;

  const handleDisconnect = () => disconnect();

  return { address, shortAddress, isConnected, isConnecting: isConnecting || isPending, connectMetaMask, disconnect: handleDisconnect };
}
