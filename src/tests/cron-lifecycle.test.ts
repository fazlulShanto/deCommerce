import assert from 'node:assert/strict';
import { setImmediate as waitForImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import cron from 'node-cron';
import cronJobs from '../utils/cronJobs';
import { redis } from '../utils/redis';

test('cron shutdown waits for an in-flight giveaway execution before Redis can close', async (t) => {
  let releaseExecution!: () => void;
  const executionGate = new Promise<void>((resolve) => {
    releaseExecution = resolve;
  });
  let markExecutionStarted!: () => void;
  const executionStarted = new Promise<void>((resolve) => {
    markExecutionStarted = resolve;
  });
  let commandCount = 0;

  t.mock.method(redis, 'zrangebyscore', async () => {
    commandCount += 1;
    if (commandCount === 1) {
      markExecutionStarted();
      await executionGate;
    }
    return [];
  });

  const existingTaskIds = new Set(cron.getTasks().keys());
  cronJobs.checkGiveaways({} as never);
  const createdTask = Array.from(cron.getTasks().entries()).find(
    ([taskId]) => !existingTaskIds.has(taskId),
  );
  assert.ok(createdTask, 'expected the giveaway cron task to be registered');

  createdTask[1].now();
  await executionStarted;

  const stopPromise = Promise.resolve(cronJobs.stopAll());
  let stopSettled = false;
  void stopPromise.then(() => {
    stopSettled = true;
  });
  await waitForImmediate();

  try {
    assert.equal(
      stopSettled,
      false,
      'shutdown returned while the giveaway execution still owned Redis',
    );
  } finally {
    releaseExecution();
    await stopPromise;
    cron.getTasks().delete(createdTask[0]);
  }
});
