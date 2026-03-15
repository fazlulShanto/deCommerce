import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  TextChannel,
  MessageFlags,
} from 'discord.js';
import type { SlashCommand } from '../../config/command-handler';

import { getOrCreateAgentConfig } from '@/db/aiAgentConfig.dal.js';
import { ChatMessage, handleChatMessageGeneration, UserContext } from '@/services/chat.service.js';

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
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        content: '❌ This command can only be used in a server.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const userMessage = interaction.options.getString('message', true);

    // Defer reply since AI generation may take a while
    await interaction.deferReply();

    try {
      // Load per-server agent config
      const config = await getOrCreateAgentConfig(guildId);

      // Build user context from the invoking member
      const member = interaction.member;
      const userContext: UserContext = {
        name: interaction.user.globalName ?? interaction.user.username,
        roles:
          member && 'roles' in member && typeof member.roles === 'object' && 'cache' in member.roles
            ? [...member.roles.cache.values()]
                .filter((r) => r.name !== '@everyone')
                .map((r) => r.name)
            : [],
      };

      // Fetch prior channel messages as typed user/assistant history
      let chatHistory: ChatMessage[] = [];
      if (interaction.channel instanceof TextChannel) {
        // Fetch recent messages; slash-command interactions don't create
        // a real channel message, so no need to exclude by ID.
        const fetched = await interaction.channel.messages.fetch({
          limit: 20,
        });

        // Messages arrive newest-first; reverse to chronological order.
        const chronological = [...fetched.values()].reverse();

        // Build user/assistant pairs.
        // A "user" message is any non-bot message.
        // An "assistant" message is a bot reply that immediately follows a user message.
        for (let i = 0; i < chronological.length; i++) {
          const msg = chronological[i]!;
          if (msg.author.bot) continue; // skip standalone bot messages

          // This is a human message
          const next = chronological[i + 1];
          const botReply = next && next.author.bot ? next.content : null;

          chatHistory.push({ role: 'user', content: msg.content });
          if (botReply) {
            chatHistory.push({
              role: 'assistant',
              content: botReply,
            });
          }
        }

        // Keep last 10 turns (user+assistant counted separately) to
        // avoid bloating the context window.
        chatHistory = chatHistory.slice(-10);
      }

      // Generate response
      const response = await handleChatMessageGeneration({
        model: config.chatModel,
        fallbackModel: config.fallbackModel,
        systemPrompt: config.systemPrompt,
        userMessage,
        userContext,
        serverContext: {
          name: interaction.guild?.name,
          description: interaction.guild?.description,
          owner: interaction.guild
            ?.fetchOwner()
            .then((owner) => owner.user.tag)
            .catch(() => undefined), // Example of fetching additional server context
        },
        chatHistory,
        temperature: config.temperature,
      });

      // Discord has a 2000 char limit
      if (response.length > 2000) {
        const chunks = splitMessage(response, 2000);
        await interaction.editReply(chunks[0]!);
        for (let i = 1; i < chunks.length; i++) {
          await interaction.followUp(chunks[i]!);
        }
      } else {
        await interaction.editReply(response || '_(No response generated)_');
      }
    } catch (error) {
      console.error('❌ Chat command error:', error);
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
