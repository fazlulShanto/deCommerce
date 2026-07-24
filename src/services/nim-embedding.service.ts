import { z } from 'zod';
import {
  getMemoryConfig,
  NIM_EMBEDDING_DIMENSION,
  NIM_EMBEDDING_MODEL,
  NIM_EMBEDDINGS_URL,
} from '@/config/memory';

const embeddingResponseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      embedding: z.array(z.number()),
    }),
  ),
});

export class MemoryEmbeddingError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'MemoryEmbeddingError';
  }
}

export interface NimEmbeddingDependencies {
  fetch: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
}

export function createNimEmbeddingService({
  fetch: fetchImplementation,
  env = process.env,
}: NimEmbeddingDependencies) {
  async function callEmbeddings(
    inputs: string[],
    inputType: 'passage' | 'query',
  ): Promise<number[][]> {
    const normalizedInputs = inputs.map((input) => input.trim());
    if (normalizedInputs.length === 0 || normalizedInputs.some((input) => input.length === 0)) {
      throw new MemoryEmbeddingError('MEMORY_NIM_EMPTY_INPUT', false);
    }

    let config: ReturnType<typeof getMemoryConfig>;
    try {
      config = getMemoryConfig(env);
    } catch {
      throw new MemoryEmbeddingError('MEMORY_CONFIG_INVALID', false);
    }
    if (!config.NIM_API_KEY) {
      throw new MemoryEmbeddingError('MEMORY_ENV_MISSING:NIM_API_KEY', false);
    }
    if (normalizedInputs.length > config.MEMORY_EMBED_BATCH_SIZE) {
      throw new MemoryEmbeddingError('MEMORY_NIM_BATCH_TOO_LARGE', false);
    }

    let response: Response;
    try {
      response = await fetchImplementation(NIM_EMBEDDINGS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.NIM_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: NIM_EMBEDDING_MODEL,
          input: normalizedInputs,
          input_type: inputType,
          encoding_format: 'float',
          truncate: 'NONE',
        }),
        signal: AbortSignal.timeout(config.MEMORY_EXTERNAL_TIMEOUT_MS),
      });
    } catch {
      throw new MemoryEmbeddingError('MEMORY_NIM_NETWORK_ERROR', true);
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new MemoryEmbeddingError(
        retryable ? 'MEMORY_NIM_RETRYABLE_HTTP_ERROR' : 'MEMORY_NIM_HTTP_ERROR',
        retryable,
      );
    }

    let parsed: z.infer<typeof embeddingResponseSchema>;
    try {
      parsed = embeddingResponseSchema.parse(await response.json());
    } catch {
      throw new MemoryEmbeddingError('MEMORY_NIM_INVALID_RESPONSE', false);
    }

    if (parsed.data.length !== normalizedInputs.length) {
      throw new MemoryEmbeddingError('MEMORY_NIM_RESPONSE_LENGTH_MISMATCH', false);
    }

    const ordered = [...parsed.data].sort((a, b) => a.index - b.index);
    if (ordered.some((item, index) => item.index !== index)) {
      throw new MemoryEmbeddingError('MEMORY_NIM_INVALID_RESPONSE_INDEX', false);
    }

    return ordered.map(({ embedding }) => {
      if (embedding.length !== NIM_EMBEDDING_DIMENSION || !embedding.every(Number.isFinite)) {
        throw new MemoryEmbeddingError('MEMORY_NIM_DIMENSION_MISMATCH', false);
      }
      return embedding;
    });
  }

  return {
    embedPassages(inputs: string[]) {
      return callEmbeddings(inputs, 'passage');
    },
    async embedQuery(input: string) {
      return (await callEmbeddings([input], 'query'))[0];
    },
  };
}

const defaultService = createNimEmbeddingService({ fetch: globalThis.fetch });

export const embedPassages = defaultService.embedPassages;
export const embedQuery = defaultService.embedQuery;

export function getNIMEmbeddingService() {
  return defaultService;
}
