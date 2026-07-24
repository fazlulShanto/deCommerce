import type { Redis } from 'ioredis';
import { getMemoryConfig } from '@/config/memory';
import { redis as defaultRedis } from '@/utils/redis';

export type MemoryMutationKind = 'upsert' | 'delete';

const recordMutationScript = `
local bufferKey = KEYS[1]
local markerKey = KEYS[2]
local messageId = ARGV[1]
local mutation = ARGV[2]
local timestamp = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local currentJson = redis.call('HGET', bufferKey, messageId)

if currentJson then
  local current = cjson.decode(currentJson)
  if current.timestamp > timestamp then
    return {0, 0}
  end
  if current.timestamp == timestamp and current.mutation == 'delete' then
    return {0, 0}
  end
end

redis.call('HSET', bufferKey, messageId, cjson.encode({
  mutation = mutation,
  timestamp = timestamp
}))
redis.call('EXPIRE', bufferKey, ttl)
local first = redis.call('SET', markerKey, '1', 'EX', ttl, 'NX')
if first then
  return {1, 1}
end
return {1, 0}
`;

function bufferKey(
  guildId: string,
  memoryGeneration: number,
  channelId: string,
  bucketStart: number,
): string {
  return `memory-live-buffer:v1:${guildId}:g${memoryGeneration}:${channelId}:${bucketStart}`;
}

export async function recordMutation(
  guildId: string,
  memoryGeneration: number,
  channelId: string,
  bucketStart: number,
  messageId: string,
  mutation: MemoryMutationKind,
  eventTimestamp: number,
  redis: Redis = defaultRedis,
): Promise<{ recorded: boolean; shouldEnqueue: boolean }> {
  if (!guildId || !channelId || !messageId || memoryGeneration < 1 || bucketStart <= 0) {
    throw new Error('MEMORY_LIVE_MUTATION_INVALID');
  }

  const config = getMemoryConfig();
  const ttlSeconds = Math.max(300, Math.ceil(config.MEMORY_LIVE_FLUSH_DELAY_MS / 1000) * 10);
  const key = bufferKey(guildId, memoryGeneration, channelId, bucketStart);
  const marker = `${key}:enqueued`;
  const result = (await redis.eval(
    recordMutationScript,
    2,
    key,
    marker,
    messageId,
    mutation,
    String(eventTimestamp),
    String(ttlSeconds),
  )) as [number, number];

  return {
    recorded: Number(result[0]) === 1,
    shouldEnqueue: Number(result[1]) === 1,
  };
}

export interface ClaimedMemoryMutation {
  messageId: string;
  mutation: MemoryMutationKind;
  timestamp: number;
}

export async function readBucketMutations(
  guildId: string,
  memoryGeneration: number,
  channelId: string,
  bucketStart: number,
  redis: Redis = defaultRedis,
): Promise<ClaimedMemoryMutation[]> {
  const entries = await redis.hgetall(bufferKey(guildId, memoryGeneration, channelId, bucketStart));
  return Object.entries(entries).map(([messageId, value]) => {
    const parsed = JSON.parse(value) as Omit<ClaimedMemoryMutation, 'messageId'>;
    return { messageId, ...parsed };
  });
}

export async function acknowledgeBucket(
  guildId: string,
  memoryGeneration: number,
  channelId: string,
  bucketStart: number,
  redis: Redis = defaultRedis,
): Promise<void> {
  const key = bufferKey(guildId, memoryGeneration, channelId, bucketStart);
  await redis.del(key, `${key}:enqueued`, `${key}:processing`);
}
