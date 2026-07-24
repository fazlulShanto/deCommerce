import mongoose, { type InferSchemaType } from 'mongoose';
import { NIM_EMBEDDING_MODEL } from '@/config/memory';

export const MEMORY_STATES = [
  'disabled',
  'queued',
  'backfilling',
  'ready',
  'ready_with_warnings',
  'purging',
  'purge_failed',
  'failed',
] as const;

export type MemoryState = (typeof MEMORY_STATES)[number];

const agentConfigSchema = new mongoose.Schema(
  {
    guildId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    systemPrompt: {
      type: String,
      default:
        'You are a helpful AI assistant in a Discord server. Be friendly, concise, and helpful. Use the provided memory context about users to personalize your responses.',
    },
    chatModel: {
      type: String,
      default: process.env.DEFAULT_CHAT_MODEL,
    },
    embeddingModel: {
      type: String,
      default: NIM_EMBEDDING_MODEL,
    },
    fallbackModel: {
      type: String,
      default: 'cogito-2.1:671b',
    },
    temperature: {
      type: Number,
      default: 0.7,
      min: 0,
      max: 2,
    },
    topP: {
      type: Number,
      default: 0.5,
      min: 0,
      max: 2,
    },
    retriverScroreThreshold: {
      type: Number,
      default: 0.5,
      min: 0,
      max: 1,
    },
    retriverTopK: {
      type: Number,
      default: 4,
      min: 0,
      max: 10,
    },
    retrieverScoreThreshold: {
      type: Number,
      default: 0.5,
      min: 0,
      max: 1,
    },
    retrieverTopK: {
      type: Number,
      default: 4,
      min: 0,
      max: 10,
    },
    memoryEnabled: {
      type: Boolean,
      default: false,
    },
    memoryState: {
      type: String,
      enum: MEMORY_STATES,
      default: 'disabled',
    },
    memoryEnabledAt: {
      type: Date,
      default: null,
    },
    memoryDisabledAt: {
      type: Date,
      default: null,
    },
    initialBackfillVersion: {
      type: Number,
      default: 0,
    },
    initialBackfillCompletedAt: {
      type: Date,
      default: null,
    },
    memoryGeneration: {
      type: Number,
      default: 1,
    },
    memoryLastErrorCode: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

export type AgentConfig = InferSchemaType<typeof agentConfigSchema> & {
  _id: mongoose.Types.ObjectId;
};

type NullableAgentConfigField =
  | 'memoryEnabledAt'
  | 'memoryDisabledAt'
  | 'initialBackfillCompletedAt'
  | 'memoryLastErrorCode';

export type AgentConfigUpdate = Omit<Partial<AgentConfig>, NullableAgentConfigField> & {
  memoryEnabledAt?: Date | null;
  memoryDisabledAt?: Date | null;
  initialBackfillCompletedAt?: Date | null;
  memoryLastErrorCode?: string | null;
};

export const AgentConfigModel = mongoose.model('AgentConfig', agentConfigSchema);

/**
 * Normalized get-or-create for agent config.
 */
export async function getOrCreateAgentConfig(guildId: string): Promise<AgentConfig> {
  const defaults = {
    systemPrompt:
      'You are a helpful AI assistant in a Discord server. Be friendly, concise, and helpful. Use the provided memory context about users to personalize your responses.',
    embeddingModel: NIM_EMBEDDING_MODEL,
    fallbackModel: 'cogito-2.1:671b',
    temperature: 0.7,
    topP: 0.5,
    memoryEnabled: false,
    memoryState: 'disabled' as const,
    memoryEnabledAt: null,
    memoryDisabledAt: null,
    initialBackfillVersion: 0,
    initialBackfillCompletedAt: null,
    memoryGeneration: 1,
    memoryLastErrorCode: null,
  };

  const config = await AgentConfigModel.findOneAndUpdate(
    { guildId },
    [
      {
        $set: {
          systemPrompt: { $ifNull: ['$systemPrompt', defaults.systemPrompt] },
          embeddingModel: { $ifNull: ['$embeddingModel', defaults.embeddingModel] },
          fallbackModel: { $ifNull: ['$fallbackModel', defaults.fallbackModel] },
          temperature: { $ifNull: ['$temperature', defaults.temperature] },
          topP: { $ifNull: ['$topP', defaults.topP] },
          retrieverScoreThreshold: {
            $ifNull: ['$retrieverScoreThreshold', { $ifNull: ['$retriverScroreThreshold', 0.5] }],
          },
          retrieverTopK: {
            $ifNull: ['$retrieverTopK', { $ifNull: ['$retriverTopK', 4] }],
          },
          memoryEnabled: { $ifNull: ['$memoryEnabled', defaults.memoryEnabled] },
          memoryState: { $ifNull: ['$memoryState', defaults.memoryState] },
          memoryEnabledAt: { $ifNull: ['$memoryEnabledAt', defaults.memoryEnabledAt] },
          memoryDisabledAt: { $ifNull: ['$memoryDisabledAt', defaults.memoryDisabledAt] },
          initialBackfillVersion: {
            $ifNull: ['$initialBackfillVersion', defaults.initialBackfillVersion],
          },
          initialBackfillCompletedAt: {
            $ifNull: ['$initialBackfillCompletedAt', defaults.initialBackfillCompletedAt],
          },
          memoryGeneration: { $ifNull: ['$memoryGeneration', defaults.memoryGeneration] },
          memoryLastErrorCode: {
            $ifNull: ['$memoryLastErrorCode', defaults.memoryLastErrorCode],
          },
        },
      },
    ],
    { upsert: true, new: true },
  );
  return config as unknown as AgentConfig;
}

/**
 * Compare-and-set lifecycle update.
 */
export async function compareAndSetAgentConfig(
  guildId: string,
  set: AgentConfigUpdate,
  condition: Partial<AgentConfig>,
): Promise<AgentConfig | null> {
  const config = await AgentConfigModel.findOneAndUpdate(
    { guildId, ...condition },
    { $set: set },
    { new: true },
  );
  return config as unknown as AgentConfig | null;
}

/**
 * Enable/disable memory with sanitized state.
 */
export async function setMemoryEnabled(
  guildId: string,
  enabled: boolean,
  state: MemoryState = 'disabled',
): Promise<AgentConfig> {
  const updates: AgentConfigUpdate = {
    memoryEnabled: enabled,
    memoryState: state,
  };
  if (enabled) {
    updates.memoryEnabledAt = new Date();
    updates.memoryDisabledAt = null;
  } else {
    updates.memoryDisabledAt = new Date();
    updates.memoryEnabledAt = null;
  }
  const config = await AgentConfigModel.findOneAndUpdate(
    { guildId },
    { $set: updates },
    { upsert: true, new: true },
  );
  return config as unknown as AgentConfig;
}

/**
 * Mark initial backfill version and completion.
 */
export async function markBackfillVersion(
  guildId: string,
  version: number,
  completedAt: Date | null,
): Promise<AgentConfig> {
  const config = await AgentConfigModel.findOneAndUpdate(
    { guildId },
    {
      $set: {
        initialBackfillVersion: version,
        initialBackfillCompletedAt: completedAt,
      },
    },
    { upsert: true, new: true },
  );
  return config as unknown as AgentConfig;
}
