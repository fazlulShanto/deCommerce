import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { enableGuildMemory, type EnableMemoryDependencies } from '../commands/admin/enable-memory';
import {
  MEMORY_BACKFILL_JOB_NAME,
  createBullMqConnectionOptions,
  enqueueInitialBackfill,
} from '../queues/memory-backfill.queue';
import {
  runMemoryBackfill,
  type MemoryBackfillDependencies,
} from '../services/memory-backfill.service';
import { getMemoryConfig, NIM_EMBEDDING_DIMENSION } from '../config/memory';
import { MemoryEmbeddingError } from '../services/nim-embedding.service';
import { isNonRetryableBackfillError } from '../workers/memory-backfill.worker';

describe('memory backfill queue', () => {
  test('enqueues the exact content-free idempotent job contract', async () => {
    const calls: any[] = [];
    const queue = {
      async getJob() {
        return undefined;
      },
      async add(...args: any[]) {
        calls.push(args);
        return { id: args[2].jobId };
      },
    };

    await enqueueInitialBackfill('guild', 2, 1, queue as any);

    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], MEMORY_BACKFILL_JOB_NAME);
    assert.deepEqual(calls[0][1], {
      guildId: 'guild',
      generation: 2,
      version: 1,
    });
    assert.equal(calls[0][2].jobId, 'memory-backfill-guild-g2-v1');
    assert.doesNotMatch(calls[0][2].jobId, /:/);
    assert.doesNotMatch(JSON.stringify(calls[0][1]), /content|vector|embedding/);
  });

  test('retries an existing failed idempotent job with fresh attempt counters', async () => {
    let retried = false;
    let added = false;
    const existingJob = {
      async getState() {
        return 'failed';
      },
      async retry(state: string, options: Record<string, boolean>) {
        retried =
          state === 'failed' &&
          options.resetAttemptsMade === true &&
          options.resetAttemptsStarted === true;
      },
    };
    const queue = {
      async getJob() {
        return existingJob;
      },
      async add() {
        added = true;
      },
    };

    const result = await enqueueInitialBackfill('guild', 1, 1, queue as any);

    assert.equal(result, existingJob);
    assert.equal(retried, true);
    assert.equal(added, false);
  });

  test('builds BullMQ connection options from the configured Redis URL', () => {
    assert.deepEqual(
      createBullMqConnectionOptions('rediss://user:password@redis.example:6380/2', null),
      {
        host: 'redis.example',
        port: 6380,
        username: 'user',
        password: 'password',
        db: 2,
        maxRetriesPerRequest: null,
        tls: {},
      },
    );
  });
});

describe('enable memory workflow', () => {
  function dependencies(
    overrides: Partial<EnableMemoryDependencies> = {},
  ): EnableMemoryDependencies {
    return {
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      preflight: async () => ({ available: true }),
      beginEnable: async () => ({
        kind: 'first_enabled',
        resumedQueuedTransition: false,
        config: {
          guildId: 'guild',
          memoryEnabled: true,
          memoryState: 'queued',
          memoryEnabledAt: '2026-01-01T00:00:00.000Z',
          memoryDisabledAt: null,
          initialBackfillVersion: 0,
          initialBackfillCompletedAt: null,
          memoryGeneration: 1,
          memoryLastErrorCode: null,
          retrieverScoreThreshold: 0.5,
          retrieverTopK: 4,
        },
      }),
      rollbackEnable: async () => true,
      createRun: async (input: any) => ({ ...input }),
      enqueue: async () => ({ id: 'memory-backfill-guild-g1-v1' }) as any,
      updateRun: async () => undefined,
      ...overrides,
    } as EnableMemoryDependencies;
  }

  test('queues first enable and resumes an orphaned queued transition', async () => {
    let enqueueCount = 0;
    const outcome = await enableGuildMemory(
      'guild',
      dependencies({
        beginEnable: async () =>
          ({
            ...(await dependencies().beginEnable('guild', new Date())),
            resumedQueuedTransition: true,
          }) as any,
        enqueue: async () => {
          enqueueCount += 1;
          return { id: 'memory-backfill-guild-g1-v1' } as any;
        },
      }),
    );

    assert.deepEqual(outcome, {
      kind: 'queued',
      jobId: 'memory-backfill-guild-g1-v1',
    });
    assert.equal(enqueueCount, 1);
  });

  test('rolls back the matching transition when queueing fails', async () => {
    let rolledBack = false;
    let runMarkedFailed = false;
    const outcome = await enableGuildMemory(
      'guild',
      dependencies({
        enqueue: async () => {
          throw new Error('redis unavailable');
        },
        rollbackEnable: async () => {
          rolledBack = true;
          return true;
        },
        updateRun: async (_key, updates) => {
          runMarkedFailed =
            updates.status === 'failed' && updates.lastErrorCode === 'queue_unavailable';
        },
      }),
    );

    assert.deepEqual(outcome, { kind: 'queue_failed' });
    assert.equal(rolledBack, true);
    assert.equal(runMarkedFailed, true);
  });

  test('rolls back the matching transition when run creation fails', async () => {
    let rolledBack = false;
    let rollbackCode = '';
    const outcome = await enableGuildMemory(
      'guild',
      dependencies({
        createRun: async () => {
          throw new Error('mongo unavailable');
        },
        rollbackEnable: async (_guildId, _generation, errorCode) => {
          rolledBack = true;
          rollbackCode = errorCode;
          return true;
        },
      }),
    );

    assert.deepEqual(outcome, { kind: 'queue_failed' });
    assert.equal(rolledBack, true);
    assert.equal(rollbackCode, 'checkpoint_unavailable');
  });
});

describe('historical backfill workflow', () => {
  test('paginates Discord history, filters messages, checkpoints, and completes', async () => {
    const now = new Date('2026-01-10T00:00:00.000Z');
    const config = getMemoryConfig({
      NIM_API_KEY: 'test-key',
      QDRANT_API_URL: 'https://qdrant.invalid',
      QDRANT_API_KEY: 'test-key',
      MEMORY_BACKFILL_MAX_AGE_DAYS: '365',
      MEMORY_BACKFILL_MAX_MESSAGES_PER_CHANNEL: '50000',
      MEMORY_EMBED_BATCH_SIZE: '32',
    });
    const agentConfig: any = {
      guildId: 'guild',
      memoryEnabled: true,
      memoryState: 'queued',
      memoryEnabledAt: now,
      memoryDisabledAt: null,
      initialBackfillVersion: 0,
      initialBackfillCompletedAt: null,
      memoryGeneration: 1,
      memoryLastErrorCode: null,
      retrieverScoreThreshold: 0.5,
      retrieverTopK: 4,
    };
    const run: any = {
      guildId: 'guild',
      generation: 1,
      version: 1,
      jobId: 'memory-backfill-guild-g1-v1',
      status: 'queued',
      enabledAt: now,
      cutoffAt: new Date('2025-01-10T00:00:00.000Z'),
      maxScannedMessagesPerChannel: 50000,
      discoveredChannelCount: 0,
      completedChannelCount: 0,
      skippedChannelCount: 0,
      failedChannelCount: 0,
      scannedCount: 0,
      eligibleMessageCount: 0,
      indexedChunkCount: 0,
      startedAt: null,
      completedAt: null,
      lastHeartbeatAt: null,
      lastErrorCode: null,
    };
    const checkpoint: any = {
      guildId: 'guild',
      generation: 1,
      version: 1,
      channelId: 'channel',
      channelType: 'text',
      status: 'pending',
      beforeMessageId: null,
      scannedCount: 0,
      eligibleMessageCount: 0,
      indexedChunkCount: 0,
      skippedMessageCount: 0,
      lastProcessedMessageId: null,
      startedAt: null,
      completedAt: null,
      lastErrorCode: null,
    };
    const fetchedBefore: Array<string | undefined> = [];
    const points: any[] = [];
    const progressUpdates: Array<Record<string, number>> = [];
    const messages = [
      {
        id: '3',
        author: { id: 'bot', bot: true },
        webhookId: null,
        system: false,
        content: 'ignored bot message',
        createdAt: new Date('2026-01-09T12:02:00.000Z'),
        createdTimestamp: Date.parse('2026-01-09T12:02:00.000Z'),
        editedAt: null,
      },
      {
        id: '2',
        author: { id: 'user', bot: false },
        webhookId: null,
        system: false,
        content: 'second message',
        createdAt: new Date('2026-01-09T12:01:00.000Z'),
        createdTimestamp: Date.parse('2026-01-09T12:01:00.000Z'),
        editedAt: null,
      },
      {
        id: '1',
        author: { id: 'user', bot: false },
        webhookId: null,
        system: false,
        content: 'first message',
        createdAt: new Date('2026-01-09T12:00:00.000Z'),
        createdTimestamp: Date.parse('2026-01-09T12:00:00.000Z'),
        editedAt: null,
      },
    ];
    const channel: any = {
      id: 'channel',
      type: 0,
      permissionsFor: () => ({ has: () => true }),
      messages: {
        fetch: async ({ before }: { before?: string }) => {
          fetchedBefore.push(before);
          return new Map(before ? [] : messages.map((message) => [message.id, message]));
        },
      },
    };
    const client: any = {
      guilds: {
        fetch: async () => ({
          channels: { fetch: async () => new Map([[channel.id, channel]]) },
          members: { me: {}, fetchMe: async () => ({}) },
        }),
      },
    };

    const summarize = () => ({
      discoveredChannelCount: 1,
      completedChannelCount: checkpoint.status === 'completed' ? 1 : 0,
      skippedChannelCount: checkpoint.status === 'skipped' ? 1 : 0,
      failedChannelCount: checkpoint.status === 'failed' ? 1 : 0,
      scannedCount: checkpoint.scannedCount,
      eligibleMessageCount: checkpoint.eligibleMessageCount,
      indexedChunkCount: checkpoint.indexedChunkCount,
    });
    const dependencies = {
      now: () => now,
      memoryConfig: () => config,
      getConfig: async () => ({ ...agentConfig }),
      compareAndSetConfig: async (_guildId: string, updates: Record<string, unknown>) => {
        Object.assign(agentConfig, updates);
        return { ...agentConfig };
      },
      findRun: async () => run,
      getOrCreateRun: async () => run,
      markRunRunning: async () => {
        run.status = 'running';
        run.startedAt = now;
      },
      markRunFinished: async (_key: unknown, status: string, errorCode: string | null) => {
        run.status = status;
        run.lastErrorCode = errorCode;
        run.completedAt = now;
      },
      updateRun: async (_key: unknown, updates: Record<string, unknown>) => {
        Object.assign(run, updates);
      },
      upsertChannelCheckpoint: async () => checkpoint,
      claimChannelCheckpoint: async () => {
        checkpoint.status = 'running';
        return { ...checkpoint };
      },
      advanceChannelCheckpoint: async (
        _key: unknown,
        _channelId: string,
        updates: Record<string, unknown>,
      ) => {
        Object.assign(checkpoint, updates);
      },
      markChannelFinished: async (
        _key: unknown,
        _channelId: string,
        status: string,
        errorCode: string | null,
      ) => {
        checkpoint.status = status;
        checkpoint.lastErrorCode = errorCode;
      },
      recomputeRunSummary: async () => {
        const summary = summarize();
        Object.assign(run, summary);
        return summary;
      },
      embedPassages: async (inputs: string[]) =>
        inputs.map(() => Array(NIM_EMBEDDING_DIMENSION).fill(0.25)),
      upsertMemoryChunks: async (batch: any[]) => {
        points.push(...batch);
      },
    } as unknown as MemoryBackfillDependencies;

    await runMemoryBackfill(
      client,
      { guildId: 'guild', generation: 1, version: 1 },
      {
        updateProgress: async (progress) => {
          progressUpdates.push(progress);
        },
      },
      dependencies,
    );

    assert.deepEqual(fetchedBefore, [undefined, '1']);
    assert.equal(checkpoint.status, 'completed');
    assert.equal(checkpoint.scannedCount, 3);
    assert.equal(checkpoint.eligibleMessageCount, 2);
    assert.equal(checkpoint.skippedMessageCount, 1);
    assert.equal(checkpoint.indexedChunkCount, 1);
    assert.equal(points.length, 1);
    assert.deepEqual(points[0].payload.sourceMessageIds, ['1', '2']);
    assert.equal(run.status, 'completed');
    assert.equal(agentConfig.memoryState, 'ready');
    assert.equal(agentConfig.initialBackfillVersion, 1);
    assert.ok(progressUpdates.length > 0);
  });

  test('classifies permanent failures without suppressing transient retries', () => {
    assert.equal(
      isNonRetryableBackfillError(new MemoryEmbeddingError('MEMORY_NIM_DIMENSION_MISMATCH', false)),
      true,
    );
    assert.equal(
      isNonRetryableBackfillError(new MemoryEmbeddingError('MEMORY_NIM_NETWORK_ERROR', true)),
      false,
    );
    assert.equal(
      isNonRetryableBackfillError(Object.assign(new Error('unauthorized'), { status: 401 })),
      true,
    );
    assert.equal(
      isNonRetryableBackfillError(Object.assign(new Error('rate limited'), { status: 429 })),
      false,
    );
  });
});
