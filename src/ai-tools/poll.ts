import {
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
} from 'discord.js';
import { tool } from 'ai';
import { z } from 'zod';

export interface PollToolContext {
  guild: Guild;
  requesterId: string;
  defaultChannelId: string;
}

function getChannelId(channel: string): string | null {
  const match = /^(?:<#(\d{17,20})>|(\d{17,20}))$/.exec(channel.trim());
  return match?.[1] ?? match?.[2] ?? null;
}

function canCreatePoll(channel: GuildTextBasedChannel, member: GuildMember): boolean {
  const permissions = channel.permissionsFor(member);
  const sendPermission = channel.isThread()
    ? PermissionFlagsBits.SendMessagesInThreads
    : PermissionFlagsBits.SendMessages;

  return (
    permissions.has(PermissionFlagsBits.ViewChannel) &&
    permissions.has(sendPermission) &&
    permissions.has(PermissionFlagsBits.SendPolls)
  );
}

/**
 * Create a poll tool bound to the guild, channel, and user handling the current request.
 */
export function createPollTool({ guild, requesterId, defaultChannelId }: PollToolContext) {
  let createdPollUrl: string | undefined;

  return tool({
    description:
      'Create and post a Discord poll when the user asks for one. Extract the question and ' +
      'answer options from the message. If the user mentions a channel such as ' +
      '<#123456789012345678>, pass ' +
      'that mention or its numeric ID as channel. Otherwise omit channel to post in the ' +
      'current channel. Infer durationHours and allowMultiselect only when the user specifies them.',
    inputSchema: z.object({
      question: z.string().trim().min(1).max(300).describe('The poll question'),
      options: z
        .array(z.string().trim().min(1).max(55))
        .min(2)
        .max(10)
        .describe('Between 2 and 10 poll answer options'),
      channel: z
        .string()
        .trim()
        .optional()
        .describe(
          'Optional Discord channel mention such as <#123456789012345678> or numeric channel ID',
        ),
      durationHours: z
        .number()
        .int()
        .min(1)
        .max(768)
        .default(24)
        .describe('How long the poll remains open, in hours; defaults to 24'),
      allowMultiselect: z
        .boolean()
        .default(false)
        .describe('Whether voters may select multiple answers; defaults to false'),
    }),
    execute: async ({ question, options, channel, durationHours, allowMultiselect }) => {
      if (createdPollUrl) {
        return {
          success: false,
          error: 'A poll was already created for this request.',
          messageUrl: createdPollUrl,
        };
      }

      const channelId = channel ? getChannelId(channel) : defaultChannelId;
      if (!channelId) {
        return {
          success: false,
          error: 'The target channel mention or ID is invalid.',
        };
      }

      const normalizedOptions = options.map((option) => option.trim());
      const uniqueOptions = new Set(normalizedOptions.map((option) => option.toLowerCase()));
      if (uniqueOptions.size !== normalizedOptions.length) {
        return {
          success: false,
          error: 'Poll answer options must be unique.',
        };
      }

      const targetChannel = await guild.channels.fetch(channelId).catch(() => null);
      if (!targetChannel || !targetChannel.isTextBased() || !targetChannel.isSendable()) {
        return {
          success: false,
          error: 'The target channel does not exist or cannot accept polls.',
        };
      }

      const requester = await guild.members.fetch(requesterId).catch(() => null);
      if (!requester || !canCreatePoll(targetChannel, requester)) {
        return {
          success: false,
          error: 'You do not have permission to create polls in that channel.',
        };
      }

      const botMember = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
      if (!botMember || !canCreatePoll(targetChannel, botMember)) {
        return {
          success: false,
          error: 'I do not have permission to create polls in that channel.',
        };
      }

      try {
        const pollMessage = await targetChannel.send({
          poll: {
            question: { text: question },
            answers: normalizedOptions.map((option) => ({ text: option })),
            duration: durationHours,
            allowMultiselect,
          },
        });
        createdPollUrl = pollMessage.url;

        return {
          success: true,
          messageId: pollMessage.id,
          channelId: targetChannel.id,
          channelMention: `<#${targetChannel.id}>`,
          messageUrl: pollMessage.url,
          question,
          durationHours,
          allowMultiselect,
        };
      } catch (error) {
        console.error('❌ Failed to create Discord poll:', error);
        return {
          success: false,
          error: 'Discord rejected the poll. Check the poll values and channel permissions.',
        };
      }
    },
  });
}
