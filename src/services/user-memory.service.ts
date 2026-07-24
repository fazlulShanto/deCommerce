import {
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type PermissionResolvable,
} from 'discord.js';
import { getMemoryConfig } from '@/config/memory';
import type { NormalizedAgentConfig } from '@/services/agent-config.service';
import { embedQuery } from '@/services/nim-embedding.service';
import { queryUserMemory, type RetrievedMemoryPoint } from '@/services/qdrant-memory.service';

export interface RetrievedMemory {
  content: string;
  createdAt: string;
  score: number;
}

export interface RetrieveUserMemoriesInput {
  guild: Guild;
  member: GuildMember;
  userId: string;
  query: string;
  config: Pick<
    NormalizedAgentConfig,
    'memoryEnabled' | 'memoryGeneration' | 'retrieverScoreThreshold' | 'retrieverTopK'
  >;
}

export interface UserMemoryDependencies {
  embedQuery: typeof embedQuery;
  queryUserMemory: typeof queryUserMemory;
  canViewChannel(channelId: string, member: GuildMember): Promise<boolean>;
  contextMaxChars: number;
}

function defaultCanViewChannel(guild: Guild) {
  return async (channelId: string, member: GuildMember): Promise<boolean> => {
    const channel = await guild.channels.fetch(channelId);
    if (!channel || !('permissionsFor' in channel)) return false;
    const permissions = channel.permissionsFor(member);
    return Boolean(permissions?.has(PermissionFlagsBits.ViewChannel as PermissionResolvable));
  };
}

function memoryContent(point: RetrievedMemoryPoint): string {
  return point.payload.sourceMessages
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n');
}

export async function retrieveUserMemories(
  input: RetrieveUserMemoriesInput,
  dependencies?: Partial<UserMemoryDependencies>,
): Promise<RetrievedMemory[]> {
  if (!input.config.memoryEnabled || input.query.trim().length === 0) {
    return [];
  }

  const memoryConfig = getMemoryConfig();
  const deps: UserMemoryDependencies = {
    embedQuery,
    queryUserMemory,
    canViewChannel: defaultCanViewChannel(input.guild),
    contextMaxChars: memoryConfig.MEMORY_CONTEXT_MAX_CHARS,
    ...dependencies,
  };
  const topK = Math.min(10, Math.max(1, input.config.retrieverTopK));
  const candidateLimit = Math.min(50, Math.max(20, topK * 5));
  const vector = await deps.embedQuery(input.query);
  const candidates = await deps.queryUserMemory({
    guildId: input.guild.id,
    memoryGeneration: input.config.memoryGeneration,
    userId: input.userId,
    vector,
    topK,
    candidateLimit,
    scoreThreshold: input.config.retrieverScoreThreshold,
  });

  const channelAccess = new Map<string, Promise<boolean>>();
  const accessible: RetrievedMemory[] = [];
  for (const candidate of candidates) {
    const payload = candidate.payload;
    if (
      payload.guildId !== input.guild.id ||
      payload.memoryGeneration !== input.config.memoryGeneration ||
      payload.userId !== input.userId
    ) {
      throw new Error('MEMORY_QDRANT_TENANT_ISOLATION_VIOLATION');
    }

    let access = channelAccess.get(payload.channelId);
    if (!access) {
      access = deps.canViewChannel(payload.channelId, input.member);
      channelAccess.set(payload.channelId, access);
    }
    if (!(await access)) continue;

    const content = memoryContent(candidate);
    if (!content) continue;
    accessible.push({
      content,
      createdAt: payload.lastMessageAt,
      score: candidate.score,
    });
  }

  accessible.sort(
    (left, right) =>
      right.score - left.score ||
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );

  const selected: RetrievedMemory[] = [];
  let usedCharacters = 0;
  for (const memory of accessible) {
    if (selected.length >= topK) break;
    if (usedCharacters + memory.content.length > deps.contextMaxChars) continue;
    selected.push(memory);
    usedCharacters += memory.content.length;
  }
  return selected;
}
