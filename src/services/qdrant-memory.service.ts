import { QdrantClient } from '@qdrant/js-client-rest';
import { z } from 'zod';
import { getMemoryConfig, getMemoryConfigError, NIM_EMBEDDING_DIMENSION } from '@/config/memory';
import type { MemoryChunkPayload, MemoryChunkPoint } from '@/services/memory-chunk.service';

const memorySourceMessageSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
  content: z.string(),
});

const memoryChunkPayloadSchema = z.object({
  schemaVersion: z.literal(2),
  source: z.literal('discord'),
  guildId: z.string(),
  memoryGeneration: z.number().int().positive(),
  userId: z.string(),
  channelId: z.string(),
  chunkSchemaVersion: z.literal(1),
  firstMessageId: z.string(),
  lastMessageId: z.string(),
  firstMessageAt: z.string(),
  lastMessageAt: z.string(),
  sourceMessageIds: z.array(z.string()),
  sourceMessages: z.array(memorySourceMessageSchema),
});

export interface QdrantMemoryClient {
  collectionExists(name: string): Promise<{ exists: boolean }>;
  getCollection(name: string): Promise<any>;
  createCollection(name: string, options: any): Promise<unknown>;
  createPayloadIndex(name: string, options: any): Promise<unknown>;
  upsert(name: string, options: any): Promise<unknown>;
  delete(name: string, options: any): Promise<unknown>;
  query(name: string, options: any): Promise<{ points?: any[] }>;
}

export interface QueryUserMemoryParams {
  guildId: string;
  memoryGeneration: number;
  userId: string;
  vector: number[];
  topK: number;
  candidateLimit?: number;
  scoreThreshold?: number;
}

export interface RetrievedMemoryPoint {
  score: number;
  payload: MemoryChunkPayload;
}

const payloadIndexes = [
  ['guildId', 'keyword'],
  ['memoryGeneration', 'integer'],
  ['userId', 'keyword'],
  ['channelId', 'keyword'],
  ['firstMessageId', 'keyword'],
  ['lastMessageId', 'keyword'],
  ['sourceMessageIds', 'keyword'],
  ['firstMessageAt', 'datetime'],
  ['lastMessageAt', 'datetime'],
] as const;

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && /already exists/i.test(error.message);
}

function assertCollectionSchema(info: any): void {
  const vectors = info?.config?.params?.vectors;
  if (
    !vectors ||
    typeof vectors !== 'object' ||
    !('size' in vectors) ||
    vectors.size !== NIM_EMBEDDING_DIMENSION ||
    vectors.distance !== 'Cosine'
  ) {
    throw new Error('MEMORY_QDRANT_COLLECTION_SCHEMA_MISMATCH');
  }
}

function assertVector(vector: number[]): void {
  if (vector.length !== NIM_EMBEDDING_DIMENSION || !vector.every(Number.isFinite)) {
    throw new Error('MEMORY_QDRANT_VECTOR_INVALID');
  }
}

export function createQdrantMemoryRepository(client: QdrantMemoryClient, collectionName: string) {
  let ensurePromise: Promise<void> | undefined;

  async function createIndexes(): Promise<void> {
    for (const [fieldName, fieldSchema] of payloadIndexes) {
      try {
        await client.createPayloadIndex(collectionName, {
          field_name: fieldName,
          field_schema: fieldSchema,
          wait: true,
        });
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error;
      }
    }
  }

  async function ensureOnce(): Promise<void> {
    const existence = await client.collectionExists(collectionName);
    if (!existence.exists) {
      try {
        await client.createCollection(collectionName, {
          vectors: {
            size: NIM_EMBEDDING_DIMENSION,
            distance: 'Cosine',
          },
        });
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error;
      }
    }

    assertCollectionSchema(await client.getCollection(collectionName));
    await createIndexes();
  }

  async function ensureMemoryCollection(): Promise<void> {
    ensurePromise ??= ensureOnce().catch((error) => {
      ensurePromise = undefined;
      throw error;
    });
    return ensurePromise;
  }

  async function upsertMemoryChunks(points: MemoryChunkPoint[]): Promise<void> {
    if (points.length === 0) return;
    await ensureMemoryCollection();
    for (const point of points) {
      assertVector(point.vector);
      memoryChunkPayloadSchema.parse(point.payload);
    }
    await client.upsert(collectionName, {
      wait: true,
      points,
    });
  }

  async function deleteMemoryChunks(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await ensureMemoryCollection();
    await client.delete(collectionName, {
      wait: true,
      points: ids,
    });
  }

  async function deleteGuildMemory(guildId: string, memoryGeneration?: number): Promise<void> {
    await ensureMemoryCollection();
    const must: any[] = [{ key: 'guildId', match: { value: guildId } }];
    if (memoryGeneration !== undefined) {
      must.push({
        key: 'memoryGeneration',
        match: { value: memoryGeneration },
      });
    }
    await client.delete(collectionName, {
      wait: true,
      filter: { must },
    });
  }

  async function deleteChunksBySourceMessageIds(params: {
    guildId: string;
    memoryGeneration: number;
    channelId: string;
    sourceMessageIds: string[];
  }): Promise<void> {
    if (params.sourceMessageIds.length === 0) return;
    await ensureMemoryCollection();
    await client.delete(collectionName, {
      wait: true,
      filter: {
        must: [
          { key: 'guildId', match: { value: params.guildId } },
          {
            key: 'memoryGeneration',
            match: { value: params.memoryGeneration },
          },
          { key: 'channelId', match: { value: params.channelId } },
          {
            key: 'sourceMessageIds',
            match: { any: params.sourceMessageIds },
          },
        ],
      },
    });
  }

  async function queryPayloads(filter: any, limit = 100): Promise<MemoryChunkPayload[]> {
    const response = await client.query(collectionName, {
      filter,
      limit,
      with_payload: true,
      with_vector: false,
    });
    return (response.points ?? []).map((point) => memoryChunkPayloadSchema.parse(point.payload));
  }

  async function findChunksBySourceMessageIds(params: {
    guildId: string;
    memoryGeneration: number;
    channelId: string;
    sourceMessageIds: string[];
  }): Promise<MemoryChunkPayload[]> {
    if (params.sourceMessageIds.length === 0) return [];
    await ensureMemoryCollection();
    return queryPayloads({
      must: [
        { key: 'guildId', match: { value: params.guildId } },
        {
          key: 'memoryGeneration',
          match: { value: params.memoryGeneration },
        },
        { key: 'channelId', match: { value: params.channelId } },
        {
          key: 'sourceMessageIds',
          match: { any: params.sourceMessageIds },
        },
      ],
    });
  }

  async function findChannelUserChunksAround(params: {
    guildId: string;
    memoryGeneration: number;
    channelId: string;
    userId: string;
    from: Date;
    to: Date;
  }): Promise<MemoryChunkPayload[]> {
    if (params.from > params.to) {
      throw new Error('MEMORY_QDRANT_TIME_RANGE_INVALID');
    }
    await ensureMemoryCollection();
    return queryPayloads({
      must: [
        { key: 'guildId', match: { value: params.guildId } },
        {
          key: 'memoryGeneration',
          match: { value: params.memoryGeneration },
        },
        { key: 'channelId', match: { value: params.channelId } },
        { key: 'userId', match: { value: params.userId } },
        {
          key: 'firstMessageAt',
          range: {
            gte: params.from.toISOString(),
            lte: params.to.toISOString(),
          },
        },
      ],
    });
  }

  async function queryUserMemory(params: QueryUserMemoryParams): Promise<RetrievedMemoryPoint[]> {
    assertVector(params.vector);
    if (!Number.isInteger(params.topK) || params.topK < 1 || params.topK > 10) {
      throw new Error('MEMORY_QDRANT_QUERY_LIMIT_INVALID');
    }
    const candidateLimit = params.candidateLimit ?? params.topK;
    if (!Number.isInteger(candidateLimit) || candidateLimit < params.topK || candidateLimit > 50) {
      throw new Error('MEMORY_QDRANT_QUERY_LIMIT_INVALID');
    }
    await ensureMemoryCollection();
    const response = await client.query(collectionName, {
      query: params.vector,
      filter: {
        must: [
          { key: 'guildId', match: { value: params.guildId } },
          {
            key: 'memoryGeneration',
            match: { value: params.memoryGeneration },
          },
          { key: 'userId', match: { value: params.userId } },
        ],
      },
      limit: candidateLimit,
      score_threshold: params.scoreThreshold,
      with_payload: true,
      with_vector: false,
    });

    return (response.points ?? []).map((point) => {
      const payload = memoryChunkPayloadSchema.parse(point.payload);
      if (
        payload.guildId !== params.guildId ||
        payload.memoryGeneration !== params.memoryGeneration ||
        payload.userId !== params.userId
      ) {
        throw new Error('MEMORY_QDRANT_TENANT_ISOLATION_VIOLATION');
      }
      return {
        score: typeof point.score === 'number' ? point.score : 0,
        payload,
      };
    });
  }

  return {
    deleteChunksBySourceMessageIds,
    deleteGuildMemory,
    deleteMemoryChunks,
    ensureMemoryCollection,
    findChannelUserChunksAround,
    findChunksBySourceMessageIds,
    queryUserMemory,
    upsertMemoryChunks,
  };
}

let defaultRepository: ReturnType<typeof createQdrantMemoryRepository> | undefined;

function getDefaultRepository() {
  if (defaultRepository) return defaultRepository;
  const configError = getMemoryConfigError();
  if (configError) throw new Error(configError);
  const config = getMemoryConfig();
  const client = new QdrantClient({
    url: config.QDRANT_API_URL!,
    apiKey: config.QDRANT_API_KEY!,
    port: null,
  });
  defaultRepository = createQdrantMemoryRepository(client, config.QDRANT_MEMORY_COLLECTION);
  return defaultRepository;
}

export const ensureMemoryCollection = () => getDefaultRepository().ensureMemoryCollection();
export const upsertMemoryChunks = (points: MemoryChunkPoint[]) =>
  getDefaultRepository().upsertMemoryChunks(points);
export const deleteMemoryChunks = (ids: string[]) => getDefaultRepository().deleteMemoryChunks(ids);
export const deleteGuildMemory = (guildId: string, memoryGeneration?: number) =>
  getDefaultRepository().deleteGuildMemory(guildId, memoryGeneration);
export const deleteChunksBySourceMessageIds = (
  params: Parameters<
    ReturnType<typeof createQdrantMemoryRepository>['deleteChunksBySourceMessageIds']
  >[0],
) => getDefaultRepository().deleteChunksBySourceMessageIds(params);
export const findChunksBySourceMessageIds = (
  params: Parameters<
    ReturnType<typeof createQdrantMemoryRepository>['findChunksBySourceMessageIds']
  >[0],
) => getDefaultRepository().findChunksBySourceMessageIds(params);
export const findChannelUserChunksAround = (
  params: Parameters<
    ReturnType<typeof createQdrantMemoryRepository>['findChannelUserChunksAround']
  >[0],
) => getDefaultRepository().findChannelUserChunksAround(params);
export const queryUserMemory = (params: QueryUserMemoryParams) =>
  getDefaultRepository().queryUserMemory(params);

export function getQdrantMemoryService() {
  return getDefaultRepository();
}

export async function memoryInfrastructurePreflight(): Promise<{
  available: boolean;
  reason?: string;
}> {
  const configError = getMemoryConfigError();
  if (configError) {
    return { available: false, reason: configError };
  }
  try {
    await ensureMemoryCollection();
    return { available: true };
  } catch (error) {
    return {
      available: false,
      reason:
        error instanceof Error && error.message.startsWith('MEMORY_')
          ? error.message
          : 'MEMORY_INFRASTRUCTURE_UNAVAILABLE',
    };
  }
}
