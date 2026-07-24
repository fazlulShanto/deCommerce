import {
  compareAndSetAgentConfig,
  getOrCreateAgentConfig,
  markBackfillVersion,
  setMemoryEnabled as setMemoryEnabledInDatabase,
  type AgentConfig,
  type AgentConfigUpdate,
  type MemoryState,
} from '@/db/aiAgentConfig.dal';
import { logger } from '@/utils/logger';
import { redis } from '@/utils/redis';

const CACHE_TTL_SECONDS = 300;
const cacheKeyForGuild = (guildId: string) => `memory-config:v1:${guildId}`;

export interface NormalizedAgentConfig {
  guildId: string;
  memoryEnabled: boolean;
  memoryState: MemoryState;
  memoryEnabledAt: Date | string | null;
  memoryDisabledAt: Date | string | null;
  initialBackfillVersion: number;
  initialBackfillCompletedAt: Date | string | null;
  memoryGeneration: number;
  memoryLastErrorCode: string | null;
  retrieverScoreThreshold: number;
  retrieverTopK: number;
}

export type BeginMemoryEnableResult =
  | {
      kind: 'first_enabled';
      config: NormalizedAgentConfig;
      resumedQueuedTransition: boolean;
    }
  | { kind: 're_enabled'; config: NormalizedAgentConfig }
  | { kind: 'already_enabled'; config: NormalizedAgentConfig }
  | { kind: 'conflict'; config: NormalizedAgentConfig };

export function normalizeAgentConfig(
  document: Partial<AgentConfig> & { guildId?: string },
): NormalizedAgentConfig {
  return {
    guildId: document.guildId ?? '',
    memoryEnabled: document.memoryEnabled ?? false,
    memoryState: document.memoryState ?? 'disabled',
    memoryEnabledAt: document.memoryEnabledAt ?? null,
    memoryDisabledAt: document.memoryDisabledAt ?? null,
    initialBackfillVersion: document.initialBackfillVersion ?? 0,
    initialBackfillCompletedAt: document.initialBackfillCompletedAt ?? null,
    memoryGeneration: document.memoryGeneration ?? 1,
    memoryLastErrorCode: document.memoryLastErrorCode ?? null,
    retrieverScoreThreshold:
      document.retrieverScoreThreshold ?? document.retriverScroreThreshold ?? 0.5,
    retrieverTopK: document.retrieverTopK ?? document.retriverTopK ?? 4,
  };
}

export async function invalidateAgentConfigCache(guildId: string): Promise<void> {
  try {
    await redis.del(cacheKeyForGuild(guildId));
  } catch (error) {
    logger.warn(
      {
        event: 'memory.config.cache.invalidate.failed',
        guildId,
        err: error,
      },
      'Memory config cache invalidation failed',
    );
  }
}

export async function getNormalizedAgentConfig(guildId: string): Promise<NormalizedAgentConfig> {
  const cacheKey = cacheKeyForGuild(guildId);
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      try {
        return normalizeAgentConfig(JSON.parse(cached));
      } catch {
        await redis.del(cacheKey);
      }
    }
  } catch (error) {
    logger.warn(
      { event: 'memory.config.cache.read.failed', guildId, err: error },
      'Memory config cache read failed',
    );
  }

  const normalized = normalizeAgentConfig(await getOrCreateAgentConfig(guildId));
  try {
    await redis.set(cacheKey, JSON.stringify(normalized), 'EX', CACHE_TTL_SECONDS);
  } catch (error) {
    logger.warn(
      { event: 'memory.config.cache.write.failed', guildId, err: error },
      'Memory config cache write failed',
    );
  }
  return normalized;
}

export async function compareAndSetMemoryConfig(
  guildId: string,
  updates: AgentConfigUpdate,
  condition: Partial<AgentConfig>,
): Promise<NormalizedAgentConfig | null> {
  const updated = await compareAndSetAgentConfig(guildId, updates, condition);
  await invalidateAgentConfigCache(guildId);
  return updated ? normalizeAgentConfig(updated) : null;
}

export async function beginMemoryEnable(
  guildId: string,
  now = new Date(),
): Promise<BeginMemoryEnableResult> {
  const current = await getNormalizedAgentConfig(guildId);

  if (current.memoryEnabled) {
    if (current.initialBackfillVersion < 1 && current.memoryState === 'queued') {
      return {
        kind: 'first_enabled',
        config: current,
        resumedQueuedTransition: true,
      };
    }
    if (current.initialBackfillVersion < 1 && current.memoryState === 'failed') {
      const recovered = await compareAndSetMemoryConfig(
        guildId,
        {
          memoryState: 'queued',
          memoryLastErrorCode: null,
        },
        {
          memoryEnabled: true,
          memoryState: 'failed',
          memoryGeneration: current.memoryGeneration,
          initialBackfillVersion: current.initialBackfillVersion,
        },
      );
      if (recovered) {
        return {
          kind: 'first_enabled',
          config: recovered,
          resumedQueuedTransition: true,
        };
      }
      return {
        kind: 'conflict',
        config: await getNormalizedAgentConfig(guildId),
      };
    }
    return { kind: 'already_enabled', config: current };
  }

  if (current.memoryState !== 'disabled') {
    return { kind: 'conflict', config: current };
  }

  if (current.initialBackfillVersion >= 1) {
    const updated = await compareAndSetMemoryConfig(
      guildId,
      {
        memoryEnabled: true,
        memoryState: 'ready',
        memoryEnabledAt: now,
        memoryDisabledAt: null,
        memoryLastErrorCode: null,
      },
      {
        memoryEnabled: false,
        memoryState: 'disabled',
        memoryGeneration: current.memoryGeneration,
      },
    );
    return updated
      ? { kind: 're_enabled', config: updated }
      : {
          kind: 'conflict',
          config: await getNormalizedAgentConfig(guildId),
        };
  }

  const updated = await compareAndSetMemoryConfig(
    guildId,
    {
      memoryEnabled: true,
      memoryState: 'queued',
      memoryEnabledAt: now,
      memoryDisabledAt: null,
      memoryLastErrorCode: null,
    },
    {
      memoryEnabled: false,
      memoryState: 'disabled',
      memoryGeneration: current.memoryGeneration,
      initialBackfillVersion: current.initialBackfillVersion,
    },
  );

  return updated
    ? {
        kind: 'first_enabled',
        config: updated,
        resumedQueuedTransition: false,
      }
    : {
        kind: 'conflict',
        config: await getNormalizedAgentConfig(guildId),
      };
}

export async function rollbackFirstMemoryEnable(
  guildId: string,
  generation: number,
  errorCode: string,
): Promise<boolean> {
  const rolledBack = await compareAndSetMemoryConfig(
    guildId,
    {
      memoryEnabled: false,
      memoryState: 'disabled',
      memoryEnabledAt: null,
      memoryDisabledAt: new Date(),
      memoryLastErrorCode: errorCode,
    },
    {
      memoryEnabled: true,
      memoryState: 'queued',
      memoryGeneration: generation,
      initialBackfillVersion: 0,
    },
  );
  return Boolean(rolledBack);
}

export async function setMemoryEnabled(
  guildId: string,
  enabled: boolean,
  state: MemoryState = enabled ? 'queued' : 'disabled',
): Promise<NormalizedAgentConfig> {
  const updated = await setMemoryEnabledInDatabase(guildId, enabled, state);
  await invalidateAgentConfigCache(guildId);
  return normalizeAgentConfig(updated);
}

export async function markInitialBackfill(
  guildId: string,
  version: number,
  completedAt: Date | null,
): Promise<NormalizedAgentConfig> {
  const updated = await markBackfillVersion(guildId, version, completedAt);
  await invalidateAgentConfigCache(guildId);
  return normalizeAgentConfig(updated);
}

export const getOrCreateAgentConfigWithCache = getNormalizedAgentConfig;
