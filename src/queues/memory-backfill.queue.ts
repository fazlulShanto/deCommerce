import { Queue, type ConnectionOptions, type Job, type JobsOptions } from 'bullmq';
import { getMemoryConfig } from '@/config/memory';

export const MEMORY_BACKFILL_QUEUE_NAME = 'memory-backfill-v1';
export const MEMORY_BACKFILL_JOB_NAME = 'guild-initial-backfill';

export interface MemoryBackfillJobData {
  guildId: string;
  generation: number;
  version: number;
}

export interface MemoryBackfillQueueClient {
  add(
    name: string,
    data: MemoryBackfillJobData,
    options?: JobsOptions,
  ): Promise<Job<MemoryBackfillJobData> | any>;
  getJob(jobId: string): Promise<Job<MemoryBackfillJobData> | undefined>;
  getJobCounts(...types: string[]): Promise<Record<string, number>>;
  close(): Promise<void>;
}

export function createBullMqConnectionOptions(
  redisUrl: string,
  maxRetriesPerRequest: number | null,
): ConnectionOptions {
  const parsed = new URL(redisUrl);
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error('MEMORY_REDIS_URL_INVALID');
  }

  const database = parsed.pathname.replace(/^\//, '');
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: database ? Number(database) : 0,
    maxRetriesPerRequest,
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

function defaultJobOptions(): JobsOptions {
  return {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000,
      jitter: 0.5,
    },
    removeOnComplete: {
      age: 7 * 24 * 60 * 60,
      count: 1000,
    },
    removeOnFail: {
      age: 30 * 24 * 60 * 60,
      count: 5000,
    },
  };
}

let queue: Queue<MemoryBackfillJobData> | undefined;

export function getMemoryBackfillQueue(): Queue<MemoryBackfillJobData> {
  if (!queue) {
    const config = getMemoryConfig();
    queue = new Queue<MemoryBackfillJobData>(MEMORY_BACKFILL_QUEUE_NAME, {
      connection: createBullMqConnectionOptions(config.REDIS_URL, 1),
      defaultJobOptions: defaultJobOptions(),
    });
  }
  return queue;
}

export function getBackfillWorkerConnection(): ConnectionOptions {
  return createBullMqConnectionOptions(getMemoryConfig().REDIS_URL, null);
}

export function getMemoryBackfillJobId(
  guildId: string,
  generation: number,
  version: number,
): string {
  return `memory-backfill-${guildId}-g${generation}-v${version}`;
}

export async function enqueueInitialBackfill(
  guildId: string,
  generation = 1,
  version = 1,
  queueClient: MemoryBackfillQueueClient = getMemoryBackfillQueue(),
): Promise<Job<MemoryBackfillJobData>> {
  if (!guildId || generation < 1 || version < 1) {
    throw new Error('MEMORY_BACKFILL_JOB_DATA_INVALID');
  }

  const jobId = getMemoryBackfillJobId(guildId, generation, version);
  const existing = await queueClient.getJob(jobId);
  if (existing) {
    if ((await existing.getState()) === 'failed') {
      await existing.retry('failed', {
        resetAttemptsMade: true,
        resetAttemptsStarted: true,
      });
    }
    return existing;
  }

  return queueClient.add(
    MEMORY_BACKFILL_JOB_NAME,
    { guildId, generation, version },
    {
      jobId,
    },
  ) as Promise<Job<MemoryBackfillJobData>>;
}

export async function getInitialBackfillJob(
  guildId: string,
  generation = 1,
  version = 1,
  queueClient: MemoryBackfillQueueClient = getMemoryBackfillQueue(),
): Promise<Job<MemoryBackfillJobData> | undefined> {
  return queueClient.getJob(getMemoryBackfillJobId(guildId, generation, version));
}

export async function getMemoryBackfillQueueCounts(
  queueClient: MemoryBackfillQueueClient = getMemoryBackfillQueue(),
): Promise<Record<string, number>> {
  return queueClient.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
}

export async function closeMemoryBackfillQueue(): Promise<void> {
  if (!queue) return;
  const currentQueue = queue;
  queue = undefined;
  await currentQueue.close();
}
