import {
  EmbedBuilder,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
} from 'discord.js';
import { tool } from 'ai';
import { z } from 'zod';

export interface AnnouncementToolContext {
  guild: Guild;
  requesterId: string;
  defaultChannelId: string;
}

function getChannelId(channel: string): string | null {
  const match = /^(?:<#(\d{17,20})>|(\d{17,20}))$/.exec(channel.trim());
  return match?.[1] ?? match?.[2] ?? null;
}

function canPostAnnouncement(channel: GuildTextBasedChannel, member: GuildMember): boolean {
  const permissions = channel.permissionsFor(member);
  const sendPermission = channel.isThread()
    ? PermissionFlagsBits.SendMessagesInThreads
    : PermissionFlagsBits.SendMessages;

  return (
    permissions.has(PermissionFlagsBits.ViewChannel) &&
    permissions.has(sendPermission) &&
    permissions.has(PermissionFlagsBits.EmbedLinks)
  );
}

function canNotifyEveryone(channel: GuildTextBasedChannel, member: GuildMember): boolean {
  return channel.permissionsFor(member).has(PermissionFlagsBits.MentionEveryone);
}

/**
 * Create an announcement tool bound to the guild, channel, and user handling the request.
 */
export function createAnnouncementTool({
  guild,
  requesterId,
  defaultChannelId,
}: AnnouncementToolContext) {
  let createdAnnouncementUrl: string | undefined;

  return tool({
    description:
      'Create and post a formatted Discord announcement when the user asks for one. Write the ' +
      'title and content from the facts in the user message without inventing details. If the ' +
      'user mentions a channel such as <#123456789012345678>, pass that mention or its numeric ' +
      'ID as channel; otherwise omit channel to use the current channel. Only set a mass ' +
      'notification, color, footer, image, or timestamp preference when requested.',
    inputSchema: z.object({
      title: z.string().trim().min(1).max(256).optional().describe('Optional announcement title'),
      content: z.string().trim().min(1).max(4_096).describe('The announcement body'),
      channel: z
        .string()
        .trim()
        .optional()
        .describe(
          'Optional Discord channel mention such as <#123456789012345678> or numeric channel ID',
        ),
      notification: z
        .enum(['none', 'everyone', 'here'])
        .default('none')
        .describe('Mass notification to send; use none unless explicitly requested'),
      color: z
        .string()
        .trim()
        .regex(/^#?[0-9a-fA-F]{6}$/)
        .default('#5865F2')
        .describe('Embed color as a six-digit hex value'),
      footer: z.string().trim().min(1).max(2_048).optional(),
      imageUrl: z.url().optional().describe('Optional announcement image URL supplied by the user'),
      includeTimestamp: z
        .boolean()
        .default(true)
        .describe('Whether to display the posting timestamp'),
    }),
    execute: async ({
      title,
      content,
      channel,
      notification,
      color,
      footer,
      imageUrl,
      includeTimestamp,
    }) => {
      if (createdAnnouncementUrl) {
        return {
          success: false,
          error: 'An announcement was already posted for this request.',
          messageUrl: createdAnnouncementUrl,
        };
      }

      const channelId = channel ? getChannelId(channel) : defaultChannelId;
      if (!channelId) {
        return {
          success: false,
          error: 'The target channel mention or ID is invalid.',
        };
      }

      const embedCharacterCount = content.length + (title?.length ?? 0) + (footer?.length ?? 0);
      if (embedCharacterCount > 6_000) {
        return {
          success: false,
          error: 'The combined announcement title, content, and footer exceed 6,000 characters.',
        };
      }

      const targetChannel = await guild.channels.fetch(channelId).catch(() => null);
      if (!targetChannel || !targetChannel.isTextBased() || !targetChannel.isSendable()) {
        return {
          success: false,
          error: 'The target channel does not exist or cannot accept announcements.',
        };
      }

      const requester = await guild.members.fetch(requesterId).catch(() => null);
      if (!requester || !canPostAnnouncement(targetChannel, requester)) {
        return {
          success: false,
          error: 'You do not have permission to post announcements in that channel.',
        };
      }

      const botMember = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
      if (!botMember || !canPostAnnouncement(targetChannel, botMember)) {
        return {
          success: false,
          error: 'I do not have permission to post announcements in that channel.',
        };
      }

      if (
        notification !== 'none' &&
        (!canNotifyEveryone(targetChannel, requester) ||
          !canNotifyEveryone(targetChannel, botMember))
      ) {
        return {
          success: false,
          error: `The ${notification} notification is not permitted in that channel.`,
        };
      }

      const embed = new EmbedBuilder()
        .setDescription(content)
        .setColor(Number.parseInt(color.replace('#', ''), 16));

      if (title) embed.setTitle(title);
      if (footer) embed.setFooter({ text: footer });
      if (imageUrl) embed.setImage(imageUrl);
      if (includeTimestamp) embed.setTimestamp();

      const notificationContent =
        notification === 'everyone' ? '@everyone' : notification === 'here' ? '@here' : undefined;

      try {
        const announcementMessage = await targetChannel.send({
          content: notificationContent,
          embeds: [embed],
          allowedMentions: {
            parse: notification === 'none' ? [] : ['everyone'],
          },
        });
        createdAnnouncementUrl = announcementMessage.url;

        return {
          success: true,
          messageId: announcementMessage.id,
          channelId: targetChannel.id,
          channelMention: `<#${targetChannel.id}>`,
          messageUrl: announcementMessage.url,
          title,
          notification,
        };
      } catch (error) {
        console.error('❌ Failed to post Discord announcement:', error);
        return {
          success: false,
          error: 'Discord rejected the announcement. Check its content and channel permissions.',
        };
      }
    },
  });
}
