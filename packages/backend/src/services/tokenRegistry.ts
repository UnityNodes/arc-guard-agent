import { ARC_EXPLORER } from '../lib/chains';

export interface RegistryToken {
  symbol: string;
  name: string;
  coingeckoId: string;
  logo: string;
  contractAddress: string | null;
  explorerUrl: string | null;
  decimals: number;
  hasPythFeed: boolean;
  pythFeedId: string | null;
}

const PYTH_USDC_USD = '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a';
const PYTH_EUR_USD  = '0x76fa85158bf14ede77087fe3ae472f66213f6ea2f5b411cb2de472794990fa5c';

function explorer(address: string): string {
  return `${ARC_EXPLORER}/token/${address}`;
}

const ARC_REGISTRY: RegistryToken[] = [
  {
    symbol: 'USDC',
    name: 'USD Coin',
    coingeckoId: 'usd-coin',
    logo: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
    contractAddress: '0x3600000000000000000000000000000000000000',
    explorerUrl: explorer('0x3600000000000000000000000000000000000000'),
    decimals: 6,
    hasPythFeed: true,
    pythFeedId: PYTH_USDC_USD,
  },
  {
    symbol: 'EURC',
    name: 'Euro Coin',
    coingeckoId: 'euro-coin',
    logo: 'https://assets.coingecko.com/coins/images/26045/small/euro-coin.png',
    contractAddress: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
    explorerUrl: explorer('0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a'),
    decimals: 6,
    hasPythFeed: true,
    pythFeedId: PYTH_EUR_USD,
  },
  {
    symbol: 'USYC',
    name: 'US Yield Coin',
    coingeckoId: 'usyc',
    logo: '',
    contractAddress: '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C',
    explorerUrl: explorer('0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C'),
    decimals: 6,
    hasPythFeed: false,
    pythFeedId: null,
  },
];

export async function getTokenRegistry(): Promise<RegistryToken[]> {
  return ARC_REGISTRY;
}

export async function refreshTokenRegistry(): Promise<RegistryToken[]> {
  return ARC_REGISTRY;
}

export async function maybeRefreshRegistry(): Promise<void> {
  return;
}
