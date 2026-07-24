import { createHash } from 'node:crypto';
import { getMemoryConfig } from '@/config/memory';

export interface MemoryMessageLike {
  id: string;
  guildId?: string;
  channelId?: string;
  userId?: string;
  content: string;
  createdAt: Date | string;
  editedAt?: Date | string | null;
  author?: { id?: string; bot?: boolean };
  webhookId?: string | null;
  system?: boolean;
}

export interface MemorySourceMessage {
  id: string;
  createdAt: string;
  editedAt: string | null;
  content: string;
}

export interface MemoryChunkIdentity {
  guildId: string;
  memoryGeneration: number;
  channelId: string;
  userId: string;
  firstMessageId: string;
  chunkSchemaVersion: number;
}

export interface MemoryChunk extends MemoryChunkIdentity {
  pointId: string;
  lastMessageId: string;
  firstMessageAt: string;
  lastMessageAt: string;
  sourceMessageIds: string[];
  sourceMessages: MemorySourceMessage[];
}

export interface MemoryChunkOptions {
  guildId: string;
  memoryGeneration: number;
  channelId: string;
  maxMessages?: number;
  maxChars?: number;
  maxGapSeconds?: number;
}

export interface MemoryChunkPayload {
  schemaVersion: 2;
  source: 'discord';
  guildId: string;
  memoryGeneration: number;
  userId: string;
  channelId: string;
  chunkSchemaVersion: 1;
  firstMessageId: string;
  lastMessageId: string;
  firstMessageAt: string;
  lastMessageAt: string;
  sourceMessageIds: string[];
  sourceMessages: MemorySourceMessage[];
}

export interface MemoryChunkPoint {
  id: string;
  vector: number[];
  payload: MemoryChunkPayload;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function isEligibleMemoryMessage(message: MemoryMessageLike): boolean {
  return Boolean(
    message &&
      typeof message.content === 'string' &&
      message.content.trim().length > 2 &&
      !message.author?.bot &&
      !message.webhookId &&
      !message.system,
  );
}

export function normalizeMemorySourceMessage(message: MemoryMessageLike): MemorySourceMessage {
  const createdAt = toIso(message.createdAt);
  if (!createdAt) {
    throw new Error('MEMORY_MESSAGE_INVALID_TIMESTAMP');
  }

  return {
    id: message.id,
    createdAt,
    editedAt: toIso(message.editedAt),
    content: message.content.trim(),
  };
}

export function createMemoryChunkPointId(identity: MemoryChunkIdentity): string {
  const hash = createHash('sha256')
    .update(
      [
        identity.guildId,
        identity.memoryGeneration,
        identity.channelId,
        identity.userId,
        identity.firstMessageId,
        identity.chunkSchemaVersion,
      ].join('/'),
    )
    .digest('hex');

  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `a${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

export function chunkMessages(
  messages: MemoryMessageLike[],
  options: MemoryChunkOptions,
): MemoryChunk[] {
  const config = getMemoryConfig();
  const maxMessages = options.maxMessages ?? config.MEMORY_CHUNK_MAX_MESSAGES;
  const maxChars = options.maxChars ?? config.MEMORY_CHUNK_MAX_CHARS;
  const maxGapSeconds = options.maxGapSeconds ?? config.MEMORY_CHUNK_MAX_GAP_SECONDS;
  const chronological = [...messages]
    .filter(isEligibleMemoryMessage)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const groups: MemoryMessageLike[][] = [];
  let current: MemoryMessageLike[] = [];
  let currentChars = 0;

  for (const message of chronological) {
    const authorId = message.author?.id ?? message.userId;
    if (!authorId) continue;

    const previous = current.at(-1);
    const previousAuthorId = previous?.author?.id ?? previous?.userId;
    const gapSeconds = previous
      ? (new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime()) / 1000
      : 0;
    const nextLength = message.content.trim().length;
    const shouldSplit =
      current.length > 0 &&
      (current.length >= maxMessages ||
        previousAuthorId !== authorId ||
        gapSeconds > maxGapSeconds ||
        currentChars + nextLength > maxChars);

    if (shouldSplit) {
      groups.push(current);
      current = [];
      currentChars = 0;
    }

    current.push(message);
    currentChars += nextLength;
  }

  if (current.length > 0) groups.push(current);

  return groups.map((group) => {
    const first = group[0];
    const last = group[group.length - 1];
    const userId = first.author?.id ?? first.userId!;
    const sourceMessages = group.map(normalizeMemorySourceMessage);
    const identity: MemoryChunkIdentity = {
      guildId: options.guildId,
      memoryGeneration: options.memoryGeneration,
      channelId: options.channelId,
      userId,
      firstMessageId: first.id,
      chunkSchemaVersion: 1,
    };

    return {
      ...identity,
      pointId: createMemoryChunkPointId(identity),
      lastMessageId: last.id,
      firstMessageAt: sourceMessages[0].createdAt,
      lastMessageAt: sourceMessages[sourceMessages.length - 1].createdAt,
      sourceMessageIds: sourceMessages.map((message) => message.id),
      sourceMessages,
    };
  });
}

export function formatChunkForEmbedding(chunk: MemoryChunk): string {
  return chunk.sourceMessages
    .map((message) => `[${message.createdAt}]\n${message.content}`)
    .join('\n---\n');
}

export function buildMemoryChunkPayload(chunk: MemoryChunk): MemoryChunkPayload {
  return {
    schemaVersion: 2,
    source: 'discord',
    guildId: chunk.guildId,
    memoryGeneration: chunk.memoryGeneration,
    userId: chunk.userId,
    channelId: chunk.channelId,
    chunkSchemaVersion: 1,
    firstMessageId: chunk.firstMessageId,
    lastMessageId: chunk.lastMessageId,
    firstMessageAt: chunk.firstMessageAt,
    lastMessageAt: chunk.lastMessageAt,
    sourceMessageIds: chunk.sourceMessageIds,
    sourceMessages: chunk.sourceMessages,
  };
}

export function buildMemoryChunkPoint(chunk: MemoryChunk, vector: number[]): MemoryChunkPoint {
  return {
    id: chunk.pointId,
    vector,
    payload: buildMemoryChunkPayload(chunk),
  };
}

export function formatChunkForRetrievedMemory(chunk: MemoryChunkPayload): MemoryChunkPayload {
  return structuredClone(chunk);
}

export function getMemoryChunkService() {
  return {
    buildMemoryChunkPayload,
    buildMemoryChunkPoint,
    chunkMessages,
    createMemoryChunkPointId,
    formatChunkForEmbedding,
    formatChunkForRetrievedMemory,
    isEligibleMemoryMessage,
    normalizeMemorySourceMessage,
  };
}
