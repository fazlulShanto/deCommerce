import {
  Events,
  type Client,
  type DMChannel,
  type Message,
  type NonThreadGuildBasedChannel,
  type PartialMessage,
  type ReadonlyCollection,
  type Snowflake,
} from 'discord.js';
import { getMemoryConfig } from '@/config/memory';
import { enqueueChannelFlush, enqueueDeleteChannel } from '@/queues/memory-live.queue';
import { getNormalizedAgentConfig } from '@/services/agent-config.service';
import { recordMutation } from '@/services/live-memory-buffer.service';
import { logger } from '@/utils/logger';

function currentBucketStart(now: number): number {
  const delay = getMemoryConfig().MEMORY_LIVE_FLUSH_DELAY_MS;
  return Math.floor(now / delay) * delay;
}

async function recordMessageMutation(
  message: Message | PartialMessage,
  mutation: 'upsert' | 'delete',
): Promise<void> {
  if (!message.guildId || !message.channelId || !message.id) return;
  if (
    mutation === 'upsert' &&
    'author' in message &&
    (message.author?.bot ||
      message.webhookId ||
      (typeof message.content === 'string' && message.content.trim().length === 0))
  ) {
    return;
  }

  const config = await getNormalizedAgentConfig(message.guildId);
  const shouldCapture =
    mutation === 'upsert'
      ? config.memoryEnabled
      : config.memoryEnabled || config.initialBackfillVersion > 0;
  if (!shouldCapture) return;

  const now = Date.now();
  const bucketStart = currentBucketStart(now);
  const result = await recordMutation(
    message.guildId,
    config.memoryGeneration,
    message.channelId,
    bucketStart,
    message.id,
    mutation,
    now,
  );
  if (result.shouldEnqueue) {
    await enqueueChannelFlush(
      message.guildId,
      config.memoryGeneration,
      message.channelId,
      bucketStart,
    );
  }
}

async function safelyRecord(
  message: Message | PartialMessage,
  mutation: 'upsert' | 'delete',
): Promise<void> {
  try {
    await recordMessageMutation(message, mutation);
  } catch (error) {
    logger.warn(
      {
        event: 'memory.live.event.degraded',
        guildId: message.guildId,
        channelId: message.channelId,
        mutation,
        err: error,
      },
      'Live memory event was not queued',
    );
  }
}

export const handleMessageCreate = (message: Message) => safelyRecord(message, 'upsert');
export const handleMessageUpdate = (
  _oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage,
) => safelyRecord(newMessage, 'upsert');
export const handleMessageDelete = (message: Message | PartialMessage) =>
  safelyRecord(message, 'delete');

export async function handleBulkMessageDelete(
  messages: ReadonlyCollection<Snowflake, Message | PartialMessage>,
): Promise<void> {
  await Promise.all(
    Array.from(messages.values()).map((message) => safelyRecord(message, 'delete')),
  );
}

export async function handleChannelDelete(
  channel: DMChannel | NonThreadGuildBasedChannel,
): Promise<void> {
  if (!channel.isDMBased()) {
    const guildId = channel.guildId;
    try {
      const config = await getNormalizedAgentConfig(guildId);
      if (!config.memoryEnabled && config.initialBackfillVersion < 1) return;
      await enqueueDeleteChannel(guildId, config.memoryGeneration, channel.id);
    } catch (error) {
      logger.warn(
        {
          event: 'memory.live.channel_delete.degraded',
          guildId,
          channelId: channel.id,
          err: error,
        },
        'Channel memory deletion was not queued',
      );
    }
  }
}

export function registerMessageMemoryEvents(client: Client): void {
  client.on(Events.MessageCreate, handleMessageCreate);
  client.on(Events.MessageUpdate, handleMessageUpdate);
  client.on(Events.MessageDelete, handleMessageDelete);
  client.on(Events.MessageBulkDelete, handleBulkMessageDelete);
  client.on(Events.ChannelDelete, handleChannelDelete);
}

export default registerMessageMemoryEvents;
