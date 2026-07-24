import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Client } from 'discord.js';
import { getMemoryConfig } from '@/config/memory';
import { markRunFinished } from '@/db/memoryBackfill.dal';
import {
  MEMORY_BACKFILL_QUEUE_NAME,
  getBackfillWorkerConnection,
  type MemoryBackfillJobData,
} from '@/queues/memory-backfill.queue';
import { compareAndSetMemoryConfig } from '@/services/agent-config.service';
import { runMemoryBackfill } from '@/services/memory-backfill.service';
import { MemoryEmbeddingError } from '@/services/nim-embedding.service';
import { logger } from '@/utils/logger';

let activeWorker: Worker<MemoryBackfillJobData> | undefined;

export function createMemoryBackfillWorker(client: Client): Worker<MemoryBackfillJobData> {
  if (activeWorker) return activeWorker;
  const config = getMemoryConfig();

  const worker = new Worker<MemoryBackfillJobData>(
    MEMORY_BACKFILL_QUEUE_NAME,
    async (job) => {
      try {
        await runMemoryBackfill(client, job.data, {
          updateProgress: (progress) => job.updateProgress(progress),
        });
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error('memory_backfill_failed');
        if (isNonRetryableBackfillError(normalized)) {
          throw new UnrecoverableError(sanitizedErrorCode(normalized));
        }
        throw normalized;
      }
      return { success: true };
    },
    {
      connection: getBackfillWorkerConnection(),
      concurrency: config.MEMORY_BACKFILL_CONCURRENCY,
    },
  );

  worker.on('completed', (job) => {
    logger.info(
      {
        event: 'memory.backfill.job.completed',
        guildId: job.data.guildId,
        generation: job.data.generation,
        version: job.data.version,
      },
      'Memory backfill job completed',
    );
  });

  worker.on('failed', (job, error) => {
    void handleFailedJob(job, error);
  });

  worker.on('stalled', (jobId) => {
    logger.warn({ event: 'memory.backfill.job.stalled', jobId }, 'Memory backfill job stalled');
  });

  worker.on('error', (error) => {
    logger.error(
      {
        event: 'memory.backfill.worker.error',
        errorName: error.name,
      },
      'Memory backfill worker error',
    );
  });

  activeWorker = worker;
  return worker;
}

async function handleFailedJob(
  job: Job<MemoryBackfillJobData> | undefined,
  error: Error,
): Promise<void> {
  const errorCode = sanitizedErrorCode(error);
  logger.error(
    {
      event: 'memory.backfill.job.failed',
      guildId: job?.data.guildId,
      generation: job?.data.generation,
      version: job?.data.version,
      attempt: job?.attemptsMade,
      errorCode,
      errorName: error.name,
    },
    'Memory backfill job failed',
  );

  if (!job || !isFinalAttempt(job, error)) return;

  const key = {
    guildId: job.data.guildId,
    generation: job.data.generation,
    version: job.data.version,
  };
  const results = await Promise.allSettled([
    markRunFinished(key, 'failed', errorCode, new Date()),
    markBackfillConfigFailed(job.data.guildId, job.data.generation, errorCode),
  ]);
  if (results.some((result) => result.status === 'rejected')) {
    logger.error(
      {
        event: 'memory.backfill.final_failure_persistence.failed',
        ...key,
        errorCode,
      },
      'Final backfill failure state could not be fully persisted',
    );
  }
}

async function markBackfillConfigFailed(
  guildId: string,
  generation: number,
  errorCode: string,
): Promise<void> {
  const updates = {
    memoryState: 'failed' as const,
    memoryLastErrorCode: errorCode,
  };
  const fromBackfilling = await compareAndSetMemoryConfig(guildId, updates, {
    memoryEnabled: true,
    memoryGeneration: generation,
    memoryState: 'backfilling',
  });
  if (fromBackfilling) return;
  await compareAndSetMemoryConfig(guildId, updates, {
    memoryEnabled: true,
    memoryGeneration: generation,
    memoryState: 'queued',
  });
}

function isFinalAttempt(job: Job<MemoryBackfillJobData>, error: Error): boolean {
  return error.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);
}

function sanitizedErrorCode(error: Error): string {
  return error.message.startsWith('MEMORY_')
    ? error.message.split(':')[0]
    : 'memory_backfill_failed';
}

export function isNonRetryableBackfillError(error: Error): boolean {
  if (error instanceof MemoryEmbeddingError) return !error.retryable;
  if (
    error.message.startsWith('MEMORY_CONFIG_INVALID') ||
    error.message.startsWith('MEMORY_ENV_MISSING') ||
    error.message.startsWith('MEMORY_QDRANT_COLLECTION_SCHEMA_MISMATCH')
  ) {
    return true;
  }

  const candidate = error as Error & {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  const status = Number(candidate.status ?? candidate.statusCode ?? candidate.response?.status);
  return (
    Number.isInteger(status) && status >= 400 && status < 500 && status !== 408 && status !== 429
  );
}

export async function closeMemoryBackfillWorker(worker = activeWorker): Promise<void> {
  if (!worker) return;
  if (worker === activeWorker) activeWorker = undefined;
  await worker.close();
}
