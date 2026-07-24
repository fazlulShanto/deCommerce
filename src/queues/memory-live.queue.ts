import { Queue, type Job, type JobsOptions } from 'bullmq';
import { getMemoryConfig } from '@/config/memory';
import { createBullMqConnectionOptions } from '@/queues/memory-backfill.queue';

export const MEMORY_LIVE_QUEUE_NAME = 'memory-live-v1';

export type LiveMemoryJobData =
  | {
      guildId: string;
      memoryGeneration: number;
      channelId: string;
      bucketStart: number;
    }
  | {
      guildId: string;
      memoryGeneration: number;
      channelId: string;
    }
  | {
      guildId: string;
      memoryGeneration: number;
    };

let liveQueue: Queue<LiveMemoryJobData> | undefined;

export function getLiveMemoryQueue(): Queue<LiveMemoryJobData> {
  if (!liveQueue) {
    const config = getMemoryConfig();
    liveQueue = new Queue<LiveMemoryJobData>(MEMORY_LIVE_QUEUE_NAME, {
      connection: createBullMqConnectionOptions(config.REDIS_URL, 1),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000, jitter: 0.5 },
        removeOnComplete: { age: 24 * 60 * 60, count: 10000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 10000 },
      },
    });
  }
  return liveQueue;
}

function assertIdentifiers(guildId: string, memoryGeneration: number, channelId?: string): void {
  if (!guildId || memoryGeneration < 1 || (channelId !== undefined && !channelId)) {
    throw new Error('MEMORY_LIVE_JOB_DATA_INVALID');
  }
}

export async function enqueueChannelFlush(
  guildId: string,
  memoryGeneration: number,
  channelId: string,
  bucketStart: number,
  queue = getLiveMemoryQueue(),
): Promise<Job<LiveMemoryJobData>> {
  assertIdentifiers(guildId, memoryGeneration, channelId);
  if (!Number.isFinite(bucketStart) || bucketStart <= 0) {
    throw new Error('MEMORY_LIVE_JOB_DATA_INVALID');
  }
  const config = getMemoryConfig();
  return queue.add(
    'flush-channel-mutations',
    { guildId, memoryGeneration, channelId, bucketStart },
    {
      jobId: `memory-flush-${guildId}-g${memoryGeneration}-${channelId}-b${bucketStart}`,
      delay: config.MEMORY_LIVE_FLUSH_DELAY_MS,
    },
  );
}

export async function enqueueDeleteChannel(
  guildId: string,
  memoryGeneration: number,
  channelId: string,
  queue = getLiveMemoryQueue(),
): Promise<Job<LiveMemoryJobData>> {
  assertIdentifiers(guildId, memoryGeneration, channelId);
  return queue.add(
    'delete-channel',
    { guildId, memoryGeneration, channelId },
    {
      jobId: `memory-delete-${guildId}-g${memoryGeneration}-${channelId}`,
    },
  );
}

export async function enqueuePurgeGuild(
  guildId: string,
  memoryGeneration: number,
  queue = getLiveMemoryQueue(),
): Promise<Job<LiveMemoryJobData>> {
  assertIdentifiers(guildId, memoryGeneration);
  return queue.add(
    'purge-guild',
    { guildId, memoryGeneration },
    {
      jobId: `memory-purge-${guildId}-g${memoryGeneration}`,
    },
  );
}

export async function getLiveQueueStatus(): Promise<{
  waiting: number;
  failed: number;
}> {
  const queue = getLiveMemoryQueue();
  const [waiting, failed] = await Promise.all([queue.getWaitingCount(), queue.getFailedCount()]);
  return { waiting, failed };
}

export async function closeLiveQueue(): Promise<void> {
  if (!liveQueue) return;
  const queue = liveQueue;
  liveQueue = undefined;
  await queue.close();
}

export const closeQueue = closeLiveQueue;
