import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getMemoryConfig,
  getMemoryConfigError,
  NIM_EMBEDDING_DIMENSION,
  NIM_EMBEDDING_MODEL,
} from '../config/memory';
import {
  buildMemoryChunkPoint,
  chunkMessages,
  createMemoryChunkPointId,
  formatChunkForEmbedding,
  type MemoryChunkPayload,
} from '../services/memory-chunk.service';
import { createNimEmbeddingService } from '../services/nim-embedding.service';
import { createQdrantMemoryRepository } from '../services/qdrant-memory.service';

const completeEnvironment = {
  NIM_API_KEY: 'test-key',
  QDRANT_API_URL: 'https://qdrant.invalid',
  QDRANT_API_KEY: 'test-key',
} as NodeJS.ProcessEnv;

describe('memory configuration', () => {
  test('coerces environment values and keeps fixed embedding constants', () => {
    const config = getMemoryConfig({
      ...completeEnvironment,
      MEMORY_FEATURE_ENABLED: 'true',
      MEMORY_EMBED_BATCH_SIZE: '16',
    });
    assert.equal(config.MEMORY_FEATURE_ENABLED, true);
    assert.equal(config.MEMORY_EMBED_BATCH_SIZE, 16);
    assert.equal(NIM_EMBEDDING_MODEL, 'nvidia/nemotron-3-embed-1b');
    assert.equal(NIM_EMBEDDING_DIMENSION, 2048);
  });

  test('reports only sanitized missing variable names', () => {
    assert.equal(
      getMemoryConfigError({}),
      'MEMORY_ENV_MISSING:NIM_API_KEY,QDRANT_API_URL,QDRANT_API_KEY',
    );
  });
});

describe('NIM embedding adapter', () => {
  test('uses passage/query modes and validates 2,048-dimensional vectors', async () => {
    const bodies: any[] = [];
    const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      return new Response(
        JSON.stringify({
          data: body.input.map((_input: string, index: number) => ({
            index,
            embedding: Array(NIM_EMBEDDING_DIMENSION).fill(index + 1),
          })),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const service = createNimEmbeddingService({
      fetch: fetch as typeof globalThis.fetch,
      env: completeEnvironment,
    });

    const passages = await service.embedPassages(['first', 'second']);
    const query = await service.embedQuery('question');

    assert.equal(passages.length, 2);
    assert.equal(query.length, NIM_EMBEDDING_DIMENSION);
    assert.deepEqual(
      bodies.map((body) => body.input_type),
      ['passage', 'query'],
    );
    assert.ok(bodies.every((body) => body.model === NIM_EMBEDDING_MODEL));
    assert.ok(bodies.every((body) => body.truncate === 'NONE'));
  });
});

describe('memory chunks', () => {
  const base = {
    guildId: 'guild',
    channelId: 'channel',
    author: { id: 'user', bot: false },
  };

  test('splits on author/gap/count/characters and creates stable UUID IDs', () => {
    const messages = [
      {
        ...base,
        id: '1',
        content: 'hello',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        ...base,
        id: '2',
        content: 'again',
        createdAt: '2026-01-01T00:01:00.000Z',
      },
      {
        ...base,
        author: { id: 'other', bot: false },
        id: '3',
        content: 'different user',
        createdAt: '2026-01-01T00:02:00.000Z',
      },
    ];

    const chunks = chunkMessages(messages, {
      guildId: 'guild',
      memoryGeneration: 1,
      channelId: 'channel',
      maxMessages: 10,
      maxChars: 1800,
      maxGapSeconds: 300,
    });

    assert.equal(chunks.length, 2);
    assert.deepEqual(chunks[0].sourceMessageIds, ['1', '2']);
    assert.match(chunks[0].pointId, /^[0-9a-f-]{36}$/);
    assert.equal(
      chunks[0].pointId,
      createMemoryChunkPointId({
        guildId: 'guild',
        memoryGeneration: 1,
        channelId: 'channel',
        userId: 'user',
        firstMessageId: '1',
        chunkSchemaVersion: 1,
      }),
    );
    assert.match(formatChunkForEmbedding(chunks[0]), /hello/);
    assert.doesNotMatch(formatChunkForEmbedding(chunks[0]), /undefined/);
  });

  test('keeps one long Discord message as one chunk', () => {
    const chunks = chunkMessages(
      [
        {
          ...base,
          id: 'long',
          content: 'x'.repeat(2000),
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      {
        guildId: 'guild',
        memoryGeneration: 1,
        channelId: 'channel',
        maxChars: 512,
      },
    );
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].sourceMessages[0].content.length, 2000);
  });
});

describe('Qdrant repository', () => {
  test('creates indexes, uses acknowledged upsert, and enforces tenant filters', async () => {
    const calls: Array<{ method: string; args: any[] }> = [];
    const payload: MemoryChunkPayload = {
      schemaVersion: 2,
      source: 'discord',
      guildId: 'guild',
      memoryGeneration: 1,
      userId: 'user',
      channelId: 'channel',
      chunkSchemaVersion: 1,
      firstMessageId: 'message',
      lastMessageId: 'message',
      firstMessageAt: '2026-01-01T00:00:00.000Z',
      lastMessageAt: '2026-01-01T00:00:00.000Z',
      sourceMessageIds: ['message'],
      sourceMessages: [
        {
          id: 'message',
          createdAt: '2026-01-01T00:00:00.000Z',
          editedAt: null,
          content: 'hello',
        },
      ],
    };
    const client = {
      async collectionExists(...args: any[]) {
        calls.push({ method: 'collectionExists', args });
        return { exists: true };
      },
      async getCollection(...args: any[]) {
        calls.push({ method: 'getCollection', args });
        return {
          config: {
            params: {
              vectors: { size: NIM_EMBEDDING_DIMENSION, distance: 'Cosine' },
            },
          },
        };
      },
      async createCollection(...args: any[]) {
        calls.push({ method: 'createCollection', args });
      },
      async createPayloadIndex(...args: any[]) {
        calls.push({ method: 'createPayloadIndex', args });
      },
      async upsert(...args: any[]) {
        calls.push({ method: 'upsert', args });
      },
      async delete(...args: any[]) {
        calls.push({ method: 'delete', args });
      },
      async query(...args: any[]) {
        calls.push({ method: 'query', args });
        return { points: [{ score: 0.9, payload }] };
      },
    };
    const repository = createQdrantMemoryRepository(client, 'memory');
    await repository.ensureMemoryCollection();
    const chunk = chunkMessages(
      [
        {
          guildId: 'guild',
          channelId: 'channel',
          id: 'message',
          author: { id: 'user', bot: false },
          content: 'hello',
          createdAt: payload.firstMessageAt,
        },
      ],
      { guildId: 'guild', memoryGeneration: 1, channelId: 'channel' },
    )[0];
    await repository.upsertMemoryChunks([
      buildMemoryChunkPoint(chunk, Array(NIM_EMBEDDING_DIMENSION).fill(0)),
    ]);
    const results = await repository.queryUserMemory({
      guildId: 'guild',
      memoryGeneration: 1,
      userId: 'user',
      vector: Array(NIM_EMBEDDING_DIMENSION).fill(0),
      topK: 4,
      candidateLimit: 20,
      scoreThreshold: 0.5,
    });

    assert.equal(results.length, 1);
    assert.equal(calls.filter((call) => call.method === 'createPayloadIndex').length, 9);
    const upsert = calls.find((call) => call.method === 'upsert');
    assert.equal(upsert?.args[1].wait, true);
    const query = calls.find((call) => call.method === 'query');
    assert.equal(query?.args[1].limit, 20);
    assert.deepEqual(query?.args[1].filter.must, [
      { key: 'guildId', match: { value: 'guild' } },
      { key: 'memoryGeneration', match: { value: 1 } },
      { key: 'userId', match: { value: 'user' } },
    ]);
  });
});
