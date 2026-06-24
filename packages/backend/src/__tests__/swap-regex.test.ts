/**
 * Test the pre-intercept regex patterns from chat.ts
 * These regexes determine how user swap commands are parsed before hitting the AI.
 */

// Exact regex patterns from chat.ts (lines 156, 203, 241, 394)
const percentRegex = /(?:swap|convert|exchange|trade|sell|buy)\s+(\d+)%\s+(\w+)\s+(?:to|into|for)\s+(\w+)/i;
const swapFullRegex = /(?:swap|convert|exchange|trade|sell|buy)\s+([\d.]+)\s+(\w+)\s+(?:to|into|for)\s+(\w+)/i;
const swapNoAmountRegex = /(?:swap|convert|exchange|trade|sell|buy)\s+(\w+)\s+(?:to|into|for)\s+(\w+)/i;
const sellBuyRegex = /^(sell|buy)\s+(\w+)$/i;

describe('Swap Regex, percentMatch', () => {
  it('captures "sell 25% ETH to USDC"', () => {
    const m = 'sell 25% ETH to USDC'.match(percentRegex);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('25');
    expect(m![2]).toBe('ETH');
    expect(m![3]).toBe('USDC');
  });

  it('captures "swap 50% USYC into EURC"', () => {
    const m = 'swap 50% USYC into EURC'.match(percentRegex);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('50');
    expect(m![2]).toBe('USYC');
    expect(m![3]).toBe('EURC');
  });

  it('captures "buy 100% USDC for ETH"', () => {
    const m = 'buy 100% USDC for ETH'.match(percentRegex);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('100');
    expect(m![2]).toBe('USDC');
    expect(m![3]).toBe('ETH');
  });

  it('is case insensitive', () => {
    const m = 'SELL 25% eth TO usdc'.match(percentRegex);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('25');
  });

  it('supports all verb variants', () => {
    for (const verb of ['swap', 'convert', 'exchange', 'trade', 'sell', 'buy']) {
      const m = `${verb} 10% ETH to USDC`.match(percentRegex);
      expect(m).not.toBeNull();
    }
  });

  it('does not match without percentage sign', () => {
    const m = 'sell 25 ETH to USDC'.match(percentRegex);
    expect(m).toBeNull();
  });
});

describe('Swap Regex, swapFullMatch', () => {
  it('captures "swap 0.5 ETH to USDC"', () => {
    const m = 'swap 0.5 ETH to USDC'.match(swapFullRegex);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('0.5');
    expect(m![2]).toBe('ETH');
    expect(m![3]).toBe('USDC');
  });

  it('captures integer amounts like "swap 1 ETH to USDC"', () => {
    const m = 'swap 1 ETH to USDC'.match(swapFullRegex);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('1');
  });

  it('captures "trade 100.25 USDC into USYC"', () => {
    const m = 'trade 100.25 USDC into USYC'.match(swapFullRegex);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('100.25');
    expect(m![2]).toBe('USDC');
    expect(m![3]).toBe('USYC');
  });

  it('captures "sell 0.001 ETH for USDC"', () => {
    const m = 'sell 0.001 ETH for USDC'.match(swapFullRegex);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('0.001');
  });

  it('is case insensitive', () => {
    const m = 'SWAP 2 eth TO usdc'.match(swapFullRegex);
    expect(m).not.toBeNull();
    expect(m![2]).toBe('eth');
  });
});

describe('Swap Regex, swapNoAmountMatch', () => {
  it('captures "sell ETH to USDC"', () => {
    const m = 'sell ETH to USDC'.match(swapNoAmountRegex);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('ETH');
    expect(m![2]).toBe('USDC');
  });

  it('captures "swap USYC into EURC"', () => {
    const m = 'swap USYC into EURC'.match(swapNoAmountRegex);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('USYC');
    expect(m![2]).toBe('EURC');
  });

  it('captures "convert USDC for ETH"', () => {
    const m = 'convert USDC for ETH'.match(swapNoAmountRegex);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('USDC');
    expect(m![2]).toBe('ETH');
  });

  it('is case insensitive', () => {
    const m = 'BUY eth FOR usdc'.match(swapNoAmountRegex);
    expect(m).not.toBeNull();
  });
});

describe('Swap Regex, sellBuyMatch', () => {
  it('captures "sell ETH"', () => {
    const m = 'sell ETH'.match(sellBuyRegex);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('sell');
    expect(m![2]).toBe('ETH');
  });

  it('captures "buy USDC"', () => {
    const m = 'buy USDC'.match(sellBuyRegex);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('buy');
    expect(m![2]).toBe('USDC');
  });

  it('is case insensitive', () => {
    const m = 'SELL eth'.match(sellBuyRegex);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('SELL');
    expect(m![2]).toBe('eth');
  });

  it('does not match with extra words', () => {
    expect('sell ETH to USDC'.match(sellBuyRegex)).toBeNull();
    expect('please sell ETH'.match(sellBuyRegex)).toBeNull();
  });

  it('does not match empty token', () => {
    expect('sell '.match(sellBuyRegex)).toBeNull();
  });
});

describe('Swap Regex, negative cases', () => {
  it('does not match random text', () => {
    expect('hello world'.match(percentRegex)).toBeNull();
    expect('hello world'.match(swapFullRegex)).toBeNull();
    expect('hello world'.match(swapNoAmountRegex)).toBeNull();
    expect('hello world'.match(sellBuyRegex)).toBeNull();
  });

  it('does not match partial swap commands missing destination', () => {
    expect('swap ETH'.match(swapNoAmountRegex)).toBeNull();
    expect('swap 0.5 ETH'.match(swapFullRegex)).toBeNull();
  });

  it('percentRegex requires a number before %', () => {
    expect('sell % ETH to USDC'.match(percentRegex)).toBeNull();
  });
});
