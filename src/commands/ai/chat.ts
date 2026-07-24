import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  GuildMember,
} from 'discord.js';
import type { SlashCommand } from '../../config/command-handler';

import { createAnnouncementTool } from '@/ai-tools/announcement.js';
import { createPollTool } from '@/ai-tools/poll.js';
import { getMemoryConfig } from '@/config/memory.js';
import { getOrCreateAgentConfig } from '@/db/aiAgentConfig.dal.js';
import {
  getNormalizedAgentConfig,
  normalizeAgentConfig,
  type NormalizedAgentConfig,
} from '@/services/agent-config.service.js';
import {
  handleChatMessageGeneration,
  type ChatMessage,
  type UserContext,
} from '@/services/chat.service.js';
import { fetchRecentHumanChatHistory } from '@/services/chat-history.service.js';
import { retrieveUserMemories, type RetrievedMemory } from '@/services/user-memory.service.js';
import { logger } from '@/utils/logger.js';

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('MEMORY_CONFIG_TIMEOUT')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function getDiscordErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'number' ? error.code : undefined;
}

async function acknowledgeChatInteraction(
  interaction: ChatInputCommandInteraction,
  privateReply: boolean,
): Promise<boolean> {
  if (interaction.deferred || interaction.replied) return true;

  try {
    if (privateReply) {
      await interaction.deferReply();
    } else {
      await interaction.deferReply();
    }
    return true;
  } catch (error) {
    const errorCode = getDiscordErrorCode(error);
    if (errorCode !== 40060 && errorCode !== 10062) throw error;

    logger.warn(
      {
        event: 'discord.chat.acknowledgement.unavailable',
        commandName: 'chat',
        guildId: interaction.guildId,
        errorCode,
      },
      'Chat command yielded because the interaction was already acknowledged or expired',
    );
    return false;
  }
}

export const ChatCommand: SlashCommand = {
  name: 'chat',
  description: 'Chat with the AI agent',
  data: new SlashCommandBuilder()
    .setName('chat')
    .setDescription('Chat with the AI agent')
    .addStringOption((option) =>
      option.setName('message').setDescription('Your message to the AI').setRequired(true),
    ) as SlashCommandBuilder,
  requiredPermissions: ['PremiumOrTrial'],
  async execute(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: '❌ This command can only be used in a server.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const userMessage = interaction.options.getString('message', true);
    const deploymentMemoryEnabled = getMemoryConfig().MEMORY_FEATURE_ENABLED;
    let runtimeMemoryConfig: NormalizedAgentConfig | undefined;
    let memoryStateKnown = !deploymentMemoryEnabled;
    if (deploymentMemoryEnabled) {
      try {
        runtimeMemoryConfig = await withTimeout(getNormalizedAgentConfig(guild.id), 1000);
        memoryStateKnown = true;
      } catch (error) {
        logger.warn(
          {
            event: 'memory.config.command_read.degraded',
            guildId: guild.id,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          },
          'Memory configuration was unavailable before chat acknowledgement',
        );
      }
    }
    const privateReply = false;

    if (!(await acknowledgeChatInteraction(interaction, privateReply))) return;

    try {
      // Load per-server agent config
      const config = await getOrCreateAgentConfig(guild.id);
      runtimeMemoryConfig ??= normalizeAgentConfig(config);

      // Build user context from the invoking member
      const member =
        interaction.member instanceof GuildMember
          ? interaction.member
          : await guild.members.fetch(interaction.user.id).catch(() => undefined);
      const userContext: UserContext = {
        name: interaction.user.globalName ?? interaction.user.username,
        roles: member
          ? Array.from(member.roles.cache.values())
              .filter((role) => role.name !== '@everyone')
              .map((role) => role.name)
          : [],
      };

      // Fetch prior channel messages as the six latest eligible human messages (user role only)
      let chatHistory: ChatMessage[] = [];
      try {
        chatHistory = await fetchRecentHumanChatHistory(interaction.channel);
      } catch (error) {
        logger.warn(
          {
            event: 'chat.history.degraded',
            guildId: guild.id,
            channelId: interaction.channelId,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          },
          'Recent channel history was unavailable',
        );
        chatHistory = [];
      }

      let retrievedMemories: RetrievedMemory[] = [];
      if (deploymentMemoryEnabled && runtimeMemoryConfig.memoryEnabled && member) {
        const retrievalStartedAt = Date.now();
        try {
          retrievedMemories = await retrieveUserMemories({
            guild,
            member,
            userId: interaction.user.id,
            query: userMessage,
            config: runtimeMemoryConfig,
          });
          logger.info(
            {
              event: 'memory.retrieval.completed',
              guildId: guild.id,
              userId: interaction.user.id,
              memoryCount: retrievedMemories.length,
              durationMs: Date.now() - retrievalStartedAt,
            },
            'Relevant user memory retrieved',
          );
        } catch (error) {
          logger.warn(
            {
              event: 'memory.retrieval.degraded',
              guildId: guild.id,
              userId: interaction.user.id,
              durationMs: Date.now() - retrievalStartedAt,
              errorName: error instanceof Error ? error.name : 'UnknownError',
            },
            'Chat is continuing without long-term memory',
          );
        }
      }

      const owner = await guild
        .fetchOwner()
        .then((guildOwner) => guildOwner.user.tag)
        .catch(() => undefined);

      const tools = {
        postAnnouncement: createAnnouncementTool({
          guild,
          requesterId: interaction.user.id,
          defaultChannelId: interaction.channelId,
        }),
        createPoll: createPollTool({
          guild,
          requesterId: interaction.user.id,
          defaultChannelId: interaction.channelId,
        }),
      };

      // Generate a response and retain the complete AI SDK result for usage/metadata access.
      const result = await handleChatMessageGeneration({
        systemPrompt: config.systemPrompt,
        userMessage,
        userContext,
        serverContext: {
          name: guild.name,
          description: guild.description,
          owner,
        },
        chatHistory,
        retrievedMemories,
        memoryContextMaxChars: getMemoryConfig().MEMORY_CONTEXT_MAX_CHARS,
        temperature: config.temperature,
        maxOutputTokens: 5000,
        tools,
      });
      const response = result.text;

      // Discord has a 2000 char limit
      if (response.length > 2000) {
        const chunks = splitMessage(response, 2000);
        await interaction.editReply(chunks[0]);
        for (let i = 1; i < chunks.length; i++) {
          await interaction.followUp(
            privateReply
              ? {
                  content: chunks[i],
                  //  flags: [MessageFlags.Ephemeral]
                }
              : { content: chunks[i] },
          );
        }
      } else {
        await interaction.editReply(response || '_(No response generated)_');
      }
    } catch (error) {
      logger.error(
        {
          event: 'chat.command.failed',
          guildId: guild.id,
          userId: interaction.user.id,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
        'Chat command failed',
      );
      await interaction.editReply(
        '❌ Something went wrong while generating a response. Please try again.',
      );
    }
  },
};

/**
 * Split a message into chunks respecting a max length.
 */
function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitIndex = remaining.lastIndexOf('\n', maxLength);
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      // Fall back to splitting at a space
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}
export default ChatCommand;
