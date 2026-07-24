import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildTextBasedChannel,
  type Message,
} from 'discord.js';
import { getMemoryConfig } from '@/config/memory';
import {
  BACKFILL_VERSION,
  advanceChannelCheckpoint,
  claimChannelCheckpoint,
  findRun,
  getOrCreateRun,
  markChannelFinished,
  markRunFinished,
  markRunRunning,
  recomputeRunSummary,
  updateRun,
  upsertChannelCheckpoint,
  type BackfillRunKey,
  type MemoryBackfillChannelCheckpoint,
} from '@/db/memoryBackfill.dal';
import {
  compareAndSetMemoryConfig,
  getNormalizedAgentConfig,
} from '@/services/agent-config.service';
import {
  buildMemoryChunkPoint,
  chunkMessages,
  formatChunkForEmbedding,
  isEligibleMemoryMessage,
  type MemoryChunkPoint,
  type MemoryMessageLike,
} from '@/services/memory-chunk.service';
import { embedPassages } from '@/services/nim-embedding.service';
import { upsertMemoryChunks } from '@/services/qdrant-memory.service';

export interface BackfillProgressReporter {
  updateProgress(progress: Record<string, number>): Promise<void>;
}

export interface MemoryBackfillDependencies {
  now(): Date;
  memoryConfig: typeof getMemoryConfig;
  getConfig: typeof getNormalizedAgentConfig;
  compareAndSetConfig: typeof compareAndSetMemoryConfig;
  findRun: typeof findRun;
  getOrCreateRun: typeof getOrCreateRun;
  markRunRunning: typeof markRunRunning;
  markRunFinished: typeof markRunFinished;
  updateRun: typeof updateRun;
  upsertChannelCheckpoint: typeof upsertChannelCheckpoint;
  claimChannelCheckpoint: typeof claimChannelCheckpoint;
  advanceChannelCheckpoint: typeof advanceChannelCheckpoint;
  markChannelFinished: typeof markChannelFinished;
  recomputeRunSummary: typeof recomputeRunSummary;
  embedPassages: typeof embedPassages;
  upsertMemoryChunks(points: MemoryChunkPoint[]): Promise<void>;
}

const defaultDependencies: MemoryBackfillDependencies = {
  now: () => new Date(),
  memoryConfig: getMemoryConfig,
  getConfig: getNormalizedAgentConfig,
  compareAndSetConfig: compareAndSetMemoryConfig,
  findRun,
  getOrCreateRun,
  markRunRunning,
  markRunFinished,
  updateRun,
  upsertChannelCheckpoint,
  claimChannelCheckpoint,
  advanceChannelCheckpoint,
  markChannelFinished,
  recomputeRunSummary,
  embedPassages,
  upsertMemoryChunks,
};

function toMemoryMessage(message: Message, guildId: string, channelId: string): MemoryMessageLike {
  return {
    id: message.id,
    guildId,
    channelId,
    userId: message.author.id,
    author: {
      id: message.author.id,
      bot: message.author.bot,
    },
    webhookId: message.webhookId,
    system: message.system,
    content: message.content,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
  };
}

function isExpectedChannelAccessError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  return ['10003', '50001', '50013'].includes(code);
}

function sanitizedBackfillError(error: unknown): string {
  if (error instanceof Error && error.message.startsWith('MEMORY_')) {
    return error.message.split(':')[0];
  }
  return isExpectedChannelAccessError(error)
    ? 'discord_channel_unavailable'
    : 'memory_backfill_failed';
}

async function upsertChunkBatches(
  messages: MemoryMessageLike[],
  key: BackfillRunKey,
  channelId: string,
  dependencies: MemoryBackfillDependencies,
): Promise<number> {
  const config = dependencies.memoryConfig();
  const chunks = chunkMessages(messages, {
    guildId: key.guildId,
    memoryGeneration: key.generation,
    channelId,
    maxMessages: config.MEMORY_CHUNK_MAX_MESSAGES,
    maxChars: config.MEMORY_CHUNK_MAX_CHARS,
    maxGapSeconds: config.MEMORY_CHUNK_MAX_GAP_SECONDS,
  });

  for (let offset = 0; offset < chunks.length; offset += config.MEMORY_EMBED_BATCH_SIZE) {
    const batch = chunks.slice(offset, offset + config.MEMORY_EMBED_BATCH_SIZE);
    const vectors = await dependencies.embedPassages(batch.map(formatChunkForEmbedding));
    if (vectors.length !== batch.length) {
      throw new Error('MEMORY_NIM_RESPONSE_LENGTH_MISMATCH');
    }
    await dependencies.upsertMemoryChunks(
      batch.map((chunk, index) => buildMemoryChunkPoint(chunk, vectors[index])),
    );
  }

  return chunks.length;
}

async function processChannel(
  channel: GuildTextBasedChannel,
  key: BackfillRunKey,
  checkpoint: MemoryBackfillChannelCheckpoint,
  cutoffAt: Date,
  maxScannedMessages: number,
  dependencies: MemoryBackfillDependencies,
  progress?: BackfillProgressReporter,
): Promise<void> {
  let beforeMessageId: string | null = checkpoint.beforeMessageId ?? null;
  let scannedCount = checkpoint.scannedCount;
  let eligibleMessageCount = checkpoint.eligibleMessageCount;
  let indexedChunkCount = checkpoint.indexedChunkCount;
  let skippedMessageCount = checkpoint.skippedMessageCount;

  while (scannedCount < maxScannedMessages) {
    const config = await dependencies.getConfig(key.guildId);
    if (!config.memoryEnabled || config.memoryGeneration !== key.generation) {
      await dependencies.markChannelFinished(
        key,
        channel.id,
        'skipped',
        'memory_disabled',
        dependencies.now(),
      );
      return;
    }

    const remaining = maxScannedMessages - scannedCount;
    const page = await channel.messages.fetch({
      limit: Math.min(100, remaining),
      ...(beforeMessageId ? { before: beforeMessageId } : {}),
    });
    const newestFirst = Array.from(page.values());
    if (newestFirst.length === 0) break;

    const inWindow: Message[] = [];
    let reachedCutoff = false;
    for (const message of newestFirst) {
      if (message.createdTimestamp < cutoffAt.getTime()) {
        reachedCutoff = true;
        break;
      }
      inWindow.push(message);
    }

    scannedCount += inWindow.length;
    const normalized = inWindow.map((message) => toMemoryMessage(message, key.guildId, channel.id));
    const eligible = normalized.filter(isEligibleMemoryMessage);
    eligibleMessageCount += eligible.length;
    skippedMessageCount += normalized.length - eligible.length;

    const indexedThisPage = await upsertChunkBatches(
      eligible.reverse(),
      key,
      channel.id,
      dependencies,
    );
    indexedChunkCount += indexedThisPage;

    const oldestProcessed = inWindow[inWindow.length - 1];
    beforeMessageId = reachedCutoff ? null : (oldestProcessed?.id ?? null);
    await dependencies.advanceChannelCheckpoint(key, channel.id, {
      beforeMessageId,
      lastProcessedMessageId: oldestProcessed?.id ?? null,
      scannedCount,
      eligibleMessageCount,
      indexedChunkCount,
      skippedMessageCount,
    });

    const summary = await dependencies.recomputeRunSummary(key);
    await dependencies.updateRun(key, {
      lastHeartbeatAt: dependencies.now(),
    });
    await progress?.updateProgress({
      scannedCount: summary.scannedCount,
      eligibleMessageCount: summary.eligibleMessageCount,
      indexedChunkCount: summary.indexedChunkCount,
    });

    if (reachedCutoff || inWindow.length === 0 || scannedCount >= maxScannedMessages) {
      break;
    }
  }

  await dependencies.markChannelFinished(key, channel.id, 'completed', null, dependencies.now());
}

async function discoverChannels(
  guild: Guild,
  key: BackfillRunKey,
  dependencies: MemoryBackfillDependencies,
): Promise<GuildTextBasedChannel[]> {
  const fetchedChannels = await guild.channels.fetch();
  const member = guild.members.me ?? (await guild.members.fetchMe());
  const eligibleChannels: GuildTextBasedChannel[] = [];

  for (const channel of Array.from(fetchedChannels.values())) {
    if (
      !channel ||
      (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)
    ) {
      continue;
    }

    const channelType = channel.type === ChannelType.GuildAnnouncement ? 'announcement' : 'text';
    await dependencies.upsertChannelCheckpoint(key, channel.id, channelType);
    const permissions = channel.permissionsFor(member);
    if (
      !permissions?.has(PermissionFlagsBits.ViewChannel) ||
      !permissions.has(PermissionFlagsBits.ReadMessageHistory)
    ) {
      await dependencies.markChannelFinished(
        key,
        channel.id,
        'skipped',
        'missing_permissions',
        dependencies.now(),
      );
      continue;
    }
    eligibleChannels.push(channel);
  }

  await dependencies.recomputeRunSummary(key);
  return eligibleChannels;
}

export async function runMemoryBackfill(
  client: Client,
  input: {
    guildId: string;
    generation: number;
    version?: number;
  },
  progress?: BackfillProgressReporter,
  dependencies: MemoryBackfillDependencies = defaultDependencies,
): Promise<void> {
  const version = input.version ?? BACKFILL_VERSION;
  const key: BackfillRunKey = {
    guildId: input.guildId,
    generation: input.generation,
    version,
  };
  const config = dependencies.memoryConfig();
  const existingRun =
    (await dependencies.findRun(input.guildId, input.generation, version)) ??
    (await dependencies.getOrCreateRun({
      ...key,
      jobId: `memory-backfill-${input.guildId}-g${input.generation}-v${version}`,
      enabledAt: dependencies.now(),
      cutoffAt: new Date(
        dependencies.now().getTime() - config.MEMORY_BACKFILL_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
      ),
      maxScannedMessagesPerChannel: config.MEMORY_BACKFILL_MAX_MESSAGES_PER_CHANNEL,
    }));

  const runtimeConfig = await dependencies.getConfig(input.guildId);
  if (!runtimeConfig.memoryEnabled || runtimeConfig.memoryGeneration !== input.generation) {
    await dependencies.markRunFinished(key, 'cancelled', 'memory_disabled', dependencies.now());
    return;
  }

  if (
    runtimeConfig.initialBackfillVersion >= version &&
    (runtimeConfig.memoryState === 'ready' || runtimeConfig.memoryState === 'ready_with_warnings')
  ) {
    await dependencies.markRunFinished(
      key,
      runtimeConfig.memoryState === 'ready_with_warnings' ? 'completed_with_warnings' : 'completed',
      null,
      dependencies.now(),
    );
    return;
  }

  if (runtimeConfig.memoryState !== 'queued' && runtimeConfig.memoryState !== 'backfilling') {
    await dependencies.markRunFinished(
      key,
      'cancelled',
      'memory_state_changed',
      dependencies.now(),
    );
    return;
  }

  if (runtimeConfig.memoryState === 'queued') {
    const started = await dependencies.compareAndSetConfig(
      input.guildId,
      { memoryState: 'backfilling' },
      {
        memoryEnabled: true,
        memoryGeneration: input.generation,
        memoryState: 'queued',
      },
    );
    if (!started) {
      const refreshed = await dependencies.getConfig(input.guildId);
      if (
        !refreshed.memoryEnabled ||
        refreshed.memoryGeneration !== input.generation ||
        refreshed.memoryState !== 'backfilling'
      ) {
        await dependencies.markRunFinished(
          key,
          'cancelled',
          'memory_state_changed',
          dependencies.now(),
        );
        return;
      }
    }
  }
  await dependencies.markRunRunning(key, dependencies.now());

  try {
    const guild = await client.guilds.fetch(input.guildId);
    const channels = await discoverChannels(guild, key, dependencies);

    for (const channel of channels) {
      const checkpoint = await dependencies.claimChannelCheckpoint(
        key,
        channel.id,
        dependencies.now(),
      );
      if (!checkpoint) continue;
      try {
        await processChannel(
          channel,
          key,
          checkpoint,
          existingRun.cutoffAt,
          existingRun.maxScannedMessagesPerChannel,
          dependencies,
          progress,
        );
      } catch (error) {
        if (!isExpectedChannelAccessError(error)) throw error;
        await dependencies.markChannelFinished(
          key,
          channel.id,
          'skipped',
          sanitizedBackfillError(error),
          dependencies.now(),
        );
      }
    }

    const summary = await dependencies.recomputeRunSummary(key);
    const completedWithWarnings = summary.failedChannelCount > 0 || summary.skippedChannelCount > 0;
    const finalState = completedWithWarnings ? 'ready_with_warnings' : 'ready';
    await dependencies.markRunFinished(
      key,
      completedWithWarnings ? 'completed_with_warnings' : 'completed',
      null,
      dependencies.now(),
    );
    const completedConfig = await dependencies.compareAndSetConfig(
      input.guildId,
      {
        memoryState: finalState,
        initialBackfillVersion: version,
        initialBackfillCompletedAt: dependencies.now(),
        memoryLastErrorCode: null,
      },
      {
        memoryEnabled: true,
        memoryGeneration: input.generation,
        memoryState: 'backfilling',
      },
    );
    if (!completedConfig) {
      const refreshed = await dependencies.getConfig(input.guildId);
      if (!refreshed.memoryEnabled || refreshed.memoryGeneration !== input.generation) {
        await dependencies.markRunFinished(
          key,
          'cancelled',
          'memory_state_changed',
          dependencies.now(),
        );
        return;
      }
      if (
        refreshed.initialBackfillVersion < version ||
        (refreshed.memoryState !== 'ready' && refreshed.memoryState !== 'ready_with_warnings')
      ) {
        throw new Error('MEMORY_BACKFILL_STATE_TRANSITION_FAILED');
      }
    }
  } catch (error) {
    await dependencies.updateRun(key, {
      lastHeartbeatAt: dependencies.now(),
      lastErrorCode: sanitizedBackfillError(error),
    });
    throw error;
  }
}

export function getMemoryBackfillService(
  context: {
    guildId: string;
    client: Client;
    generation: number;
    version: number;
  },
  dependencies: MemoryBackfillDependencies = defaultDependencies,
) {
  return {
    processGuild: () => runMemoryBackfill(context.client, context, undefined, dependencies),
  };
}
