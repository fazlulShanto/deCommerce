import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type TextChannel,
  type AutocompleteInteraction,
  MessageFlags,
} from 'discord.js';
import type { SlashCommand } from '../../config/command-handler';
import { CommandPermissions } from '../../config/command-handler';
import { getGenericErrorEmbed, getGenericSuccessEmbed } from '../../utils/genericEmbeds';
import { parseDuration } from '../../utils/duration-parser';
import { GiveawayDAL } from '../../db/giveaway.dal';
import { redis } from '../../utils/redis';
import { endGiveaway } from '../../services/giveaway.service';

export const GiveawayCommand: SlashCommand = {
  name: 'giveaway',
  description: 'Manage giveaways',
  isGuildOnly: true,
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Manage giveaways')
    // START Subcommand
    .addSubcommand((subcommand) =>
      subcommand
        .setName('start')
        .setDescription('Start a giveaway')
        .addStringOption((option) =>
          option.setName('prize').setDescription('What are you giving away?').setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('duration')
            .setDescription('Duration (e.g., 10m, 1h, 1d)')
            .setRequired(true),
        )
        .addBooleanOption((option) =>
          option
            .setName('allow_leave')
            .setDescription('Allow users to leave? (Default: true)')
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option.setName('winners').setDescription('Number of winners').setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('start_delay')
            .setDescription('Delay start (e.g., 10m from now)')
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('blacklist_roles')
            .setDescription('Role IDs to exclude (comma separated)')
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('blacklist_users')
            .setDescription('User IDs to exclude (comma separated)')
            .setRequired(false),
        )
        .addStringOption((option) =>
          option
            .setName('description')
            .setDescription('Description/rules for this giveaway')
            .setRequired(false),
        ),
    )
    // END Subcommand
    .addSubcommand((subcommand) =>
      subcommand
        .setName('end')
        .setDescription('End dry giveaway early')
        .addStringOption((option) =>
          option
            .setName('message_id')
            .setDescription('Select the giveaway to end')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ) as SlashCommandBuilder,
  requiredPermissions: ['Administrator', 'GuildOnly', 'BotAdmin'],

  autocomplete: async (interaction: AutocompleteInteraction) => {
    const focusedValue = interaction.options.getFocused();
    const guildId = interaction.guildId;
    if (!guildId) return;

    const giveaways = await GiveawayDAL.getScheduledOrActiveGiveawaysByGuild(guildId);
    const filtered = giveaways
      .filter(
        (g) =>
          g.prize.toLowerCase().includes(focusedValue.toLowerCase()) ||
          g.messageId.includes(focusedValue),
      )
      .slice(0, 25);

    await interaction.respond(
      filtered.map((g) => ({
        name: `${g.prize} (${g.messageId})`,
        value: g.messageId,
      })),
    );
  },

  execute: async (interaction: ChatInputCommandInteraction) => {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'start':
        await handleStart(interaction);
        break;
      case 'end':
        await handleEnd(interaction);
        break;
      default:
        await interaction.reply({ content: 'Unknown command.', ephemeral: true });
    }
  },
};

const handleStart = async (interaction: ChatInputCommandInteraction) => {
  const prize = interaction.options.getString('prize', true);
  const durationStr = interaction.options.getString('duration', true);
  const winnersCount = interaction.options.getInteger('winners') || 1;
  const allowLeave = interaction.options.getBoolean('allow_leave') || false;
  const startDelayStr = interaction.options.getString('start_delay');
  const blacklistRolesStr = interaction.options.getString('blacklist_roles');
  const blacklistUsersStr = interaction.options.getString('blacklist_users');
  const description = interaction.options.getString('description');

  const blacklistedRoles = blacklistRolesStr
    ? blacklistRolesStr.split(',').map((s) => s.trim())
    : [];
  const blacklistedUsers = blacklistUsersStr
    ? blacklistUsersStr.split(',').map((s) => s.trim())
    : [];

  const durationMs = parseDuration(durationStr);
  if (!durationMs) {
    await interaction.reply({
      embeds: [
        getGenericErrorEmbed('Invalid Duration', 'Please use format like `10m`, `1h`, `1d`.'),
      ],
      ephemeral: true,
    });
    return;
  }

  let startDelayMs = 0;
  if (startDelayStr) {
    const parsedDelay = parseDuration(startDelayStr);
    if (!parsedDelay) {
      await interaction.reply({
        embeds: [getGenericErrorEmbed('Invalid Delay', 'Please use format like `10m`, `1h`.')],
        ephemeral: true,
      });
      return;
    }
    startDelayMs = parsedDelay;
  }

  const startTime = new Date(Date.now() + startDelayMs);
  const endTime = new Date(startTime.getTime() + durationMs);

  const isScheduled = startDelayMs > 0;

  const embed = new EmbedBuilder()
    .setTitle(`🎉 GIVEAWAY: ${prize} 🎉`)
    .setColor('Blurple')
    .setTimestamp(endTime)
    .setFooter({ text: 'Ends' });

  const baseDesc = isScheduled
    ? `This giveaway starts <t:${Math.floor(startTime.getTime() / 1000)}:R>!`
    : `React with the button below to enter!`;

  embed.setDescription(description ? `${description}\n\n${baseDesc}` : baseDesc);

  if (isScheduled) {
    embed.addFields([
      { name: 'Winners', value: `${winnersCount}`, inline: true },
      {
        name: 'Starts At',
        value: `<t:${Math.floor(startTime.getTime() / 1000)}:f>`,
        inline: true,
      },
      { name: 'Hosted By', value: `${interaction.user}`, inline: true },
    ]);
  } else {
    embed.addFields([
      { name: 'Winners', value: `${winnersCount}`, inline: true },
      { name: 'Ends At', value: `<t:${Math.floor(endTime.getTime() / 1000)}:R>`, inline: true },
      { name: 'Hosted By', value: `${interaction.user}`, inline: true },
      { name: 'Participants', value: '0', inline: true },
    ]);
  }

  const row = new ActionRowBuilder<ButtonBuilder>();

  if (isScheduled) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('giveaway_placeholder')
        .setLabel('Not Started')
        .setEmoji('⏳')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    );
  } else {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('giveaway_join')
        .setLabel('Enter')
        .setEmoji('🎉')
        .setStyle(ButtonStyle.Success),
    );

    if (allowLeave) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('giveaway_leave')
          .setLabel('Leave')
          .setEmoji('🚪')
          .setStyle(ButtonStyle.Danger),
      );
    }
  }

  await interaction.reply({ content: 'Creating giveaway...', ephemeral: true });

  const channel = interaction.channel as TextChannel;
  const message = await channel.send({
    embeds: [embed],
    components: [row],
  });

  if (!message) {
    await interaction.editReply({ content: 'Failed to create giveaway message.' });
    return;
  }

  try {
    await GiveawayDAL.createGiveaway({
      guildId: interaction.guildId || '',
      channelId: interaction.channelId || '',
      messageId: message.id,
      prize,
      winnersCount,
      startTime,
      endTime,
      participants: [],
      winners: [],
      ended: false,
      allowLeave,
      blacklistedRoles,
      blacklistedUsers,
      description: description ?? undefined,
    });

    // Add to Redis Queue for Ending
    await redis.zadd('giveaway:end_queue', endTime.getTime(), message.id);

    if (isScheduled) {
      // Add to Redis Queue for Starting
      await redis.zadd('giveaway:start_queue', startTime.getTime(), message.id);
    }

    await interaction.editReply({
      content: `Giveaway created successfully! ${isScheduled ? 'Scheduled to start later.' : 'Started now.'}`,
    });
  } catch (error) {
    console.error('Error creating giveaway:', error);
    await message.delete().catch(() => {});
    await interaction.editReply({ content: 'Failed to save giveaway to database.' });
  }
};

const handleEnd = async (interaction: ChatInputCommandInteraction) => {
  const messageId = interaction.options.getString('message_id', true);

  await interaction.reply({ content: 'Ending giveaway...', ephemeral: true });

  const giveaway = await GiveawayDAL.getGiveawayByMessageId(messageId);
  if (!giveaway) {
    await interaction.editReply({ content: '❌ Giveaway not found.' });
    return;
  }

  if (giveaway.ended) {
    await interaction.editReply({ content: '❌ This giveaway has already ended.' });
    return;
  }

  try {
    await endGiveaway(interaction.client, giveaway);
    // Remove from Redis queue just in case
    await redis.zrem('giveaway:end_queue', messageId);
    await interaction.editReply({ content: '✅ Giveaway ended successfully early!' });
  } catch (error) {
    console.error('Error ending giveaway early:', error);
    await interaction.editReply({ content: '❌ Failed to end giveaway early.' });
  }
};

export default GiveawayCommand;
