import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { logger, flushLogger, closeLogger, createLogger } from '../utils/logger';

describe('Logger', () => {
  test('should export logger and helper functions', async () => {
    assert.ok(logger);
    assert.ok(flushLogger);
    assert.ok(closeLogger);
    assert.ok(createLogger);
    await flushLogger();
    await closeLogger();
  });

  test('should log without crashing', async () => {
    logger.info({ event: 'test.event' }, 'structured test log');
    await flushLogger();
    assert.ok(true);
  });

  test('should handle error logging', async () => {
    const err = new Error('test error');
    logger.error({ event: 'logger.test.error', err }, 'error test');
    await flushLogger();
    assert.ok(true);
  });

  test('should fallback gracefully', async () => {
    // test fallback by unsetting env
    const originalKey = process.env.LOG_SERVER_API_KEY;
    delete process.env.LOG_SERVER_API_KEY;
    delete process.env.BETTERSTACK_INGESTING_URL;
    createLogger();

    logger.info({ event: 'fallback.event' }, 'fallback test');
    await flushLogger();

    process.env.LOG_SERVER_API_KEY = originalKey;
    assert.ok(true);
  });
});
