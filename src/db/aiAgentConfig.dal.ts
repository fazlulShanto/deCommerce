import mongoose, { type InferSchemaType } from 'mongoose';

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
      default: process.env.DEFAULT_EMBEDDING_MODEL,
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
  },
  { timestamps: true },
);

export type AgentConfig = InferSchemaType<typeof agentConfigSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const AgentConfigModel = mongoose.model('AgentConfig', agentConfigSchema);

/**
 * Get or create agent config for a guild.
 */
export async function getOrCreateAgentConfig(guildId: string): Promise<AgentConfig> {
  let config = await AgentConfigModel.findOne({ guildId });
  if (!config) {
    config = await AgentConfigModel.create({ guildId });
  }
  return config as unknown as AgentConfig;
}
