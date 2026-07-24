import { z } from 'zod';

export const NIM_EMBEDDING_MODEL = 'nvidia/nemotron-3-embed-1b';
export const NIM_EMBEDDING_DIMENSION = 2048;
export const NIM_EMBEDDINGS_URL = 'https://integrate.api.nvidia.com/v1/embeddings';
export const DEFAULT_MEMORY_COLLECTION = 'discord_user_memory_v1';

const booleanFromEnvironment = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

const optionalSecret = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

export const MemoryConfigSchema = z.object({
  REDIS_URL: z.string().trim().min(1).default('redis://localhost:6379'),
  NIM_API_KEY: optionalSecret,
  QDRANT_API_URL: optionalSecret,
  QDRANT_API_KEY: optionalSecret,
  QDRANT_MEMORY_COLLECTION: z.string().trim().min(1).default(DEFAULT_MEMORY_COLLECTION),
  MEMORY_EMBED_BATCH_SIZE: z.coerce.number().int().min(1).max(64).default(32),
  MEMORY_CHUNK_MAX_MESSAGES: z.coerce.number().int().min(1).max(20).default(10),
  MEMORY_CHUNK_MAX_CHARS: z.coerce.number().int().min(512).max(2000).default(1800),
  MEMORY_CHUNK_MAX_GAP_SECONDS: z.coerce.number().int().min(1).max(900).default(300),
  MEMORY_EXTERNAL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  MEMORY_FEATURE_ENABLED: booleanFromEnvironment.default(false),
  MEMORY_BACKFILL_MAX_AGE_DAYS: z.coerce.number().int().min(1).max(365).default(365),
  MEMORY_BACKFILL_MAX_MESSAGES_PER_CHANNEL: z.coerce
    .number()
    .int()
    .min(1)
    .max(50000)
    .default(50000),
  MEMORY_BACKFILL_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(3),
  MEMORY_LIVE_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  MEMORY_LIVE_FLUSH_DELAY_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  MEMORY_LIVE_BUFFER_MAX_IDS: z.coerce.number().int().min(1).max(1000).default(100),
  MEMORY_CONTEXT_MAX_CHARS: z.coerce.number().int().min(1000).max(20000).default(6000),
});

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

export function getMemoryConfig(env: NodeJS.ProcessEnv = process.env): MemoryConfig {
  return MemoryConfigSchema.parse(env);
}

export function getMemoryConfigError(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const result = MemoryConfigSchema.safeParse(env);
  if (!result.success) {
    return 'MEMORY_CONFIG_INVALID';
  }

  const missing = [
    !result.data.NIM_API_KEY && 'NIM_API_KEY',
    !result.data.QDRANT_API_URL && 'QDRANT_API_URL',
    !result.data.QDRANT_API_KEY && 'QDRANT_API_KEY',
  ].filter(Boolean);

  return missing.length > 0 ? `MEMORY_ENV_MISSING:${missing.join(',')}` : undefined;
}

export function validateMemoryConfig(env: NodeJS.ProcessEnv = process.env): boolean {
  return MemoryConfigSchema.safeParse(env).success;
}
