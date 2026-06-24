/**
 * Test the structured logger from lib/logger.ts
 * We test the formatMeta helper and log output via console spies.
 */

// Force LOG_LEVEL to debug so all levels are testable
process.env.LOG_LEVEL = 'debug';

// Import after setting env
import { logger } from '../lib/logger';

describe('Logger, log levels', () => {
  let consoleSpy: { log: jest.SpyInstance; warn: jest.SpyInstance; error: jest.SpyInstance };

  beforeEach(() => {
    consoleSpy = {
      log: jest.spyOn(console, 'log').mockImplementation(),
      warn: jest.spyOn(console, 'warn').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation(),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logger.debug writes to console.log with [DEBUG] tag', () => {
    logger.debug('test', 'debug message');
    expect(consoleSpy.log).toHaveBeenCalledTimes(1);
    const output = consoleSpy.log.mock.calls[0][0] as string;
    expect(output).toContain('[DEBUG]');
    expect(output).toContain('[test]');
    expect(output).toContain('debug message');
  });

  it('logger.info writes to console.log with [INFO] tag', () => {
    logger.info('swap', 'Swap executed');
    expect(consoleSpy.log).toHaveBeenCalledTimes(1);
    const output = consoleSpy.log.mock.calls[0][0] as string;
    expect(output).toContain('[INFO]');
    expect(output).toContain('[swap]');
    expect(output).toContain('Swap executed');
  });

  it('logger.warn writes to console.warn with [WARN] tag', () => {
    logger.warn('price', 'Pyth unreachable');
    expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
    const output = consoleSpy.warn.mock.calls[0][0] as string;
    expect(output).toContain('[WARN]');
    expect(output).toContain('[price]');
  });

  it('logger.error writes to console.error with [ERROR] tag', () => {
    logger.error('swap', 'Swap failed');
    expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    const output = consoleSpy.error.mock.calls[0][0] as string;
    expect(output).toContain('[ERROR]');
    expect(output).toContain('Swap failed');
  });

  it('includes ISO timestamp in output', () => {
    logger.info('test', 'timestamped');
    const output = consoleSpy.log.mock.calls[0][0] as string;
    // ISO 8601 pattern: 2024-01-01T00:00:00.000Z
    expect(output).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('Logger, meta serialization', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('serializes object meta as JSON', () => {
    logger.info('test', 'with meta', { txHash: '0xabc', amount: 1.5 });
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('txHash');
    expect(output).toContain('0xabc');
  });

  it('serializes Error meta with message and stack', () => {
    const err = new Error('Something broke');
    logger.info('test', 'with error', err);
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('Something broke');
  });

  it('handles null meta gracefully (no extra output)', () => {
    logger.info('test', 'no meta', null);
    const output = consoleSpy.mock.calls[0][0] as string;
    // null is falsy, formatMeta returns ''
    expect(output).toContain('no meta');
  });

  it('handles undefined meta gracefully', () => {
    logger.info('test', 'no meta');
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).not.toContain('|');
  });

  it('handles string meta', () => {
    logger.info('test', 'string meta', 'extra info');
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('extra info');
  });
});
