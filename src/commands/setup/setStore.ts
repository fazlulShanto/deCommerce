import {
  Colors,
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { SlashCommand } from '../../config/command-handler';
import { StoreConfigDAL } from '@/db/storeConfig.dal';
import { getGenericErrorEmbed } from '@/utils/genericEmbeds';
import { setStoreConfigInCache } from '@/utils/redis';

const commandName = 'config-store';

export const SetStoreCommand: SlashCommand = {
  name: commandName,
  description: 'Configure the store',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Configure the store')
    .addRoleOption((option) =>
      option
        .setName('bot-admin-role')
        .setDescription('Set the roles for the bot')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('currency').setDescription('Set the store currency').setRequired(true),
    ) as SlashCommandBuilder,
  requiredPermissions: [],

  execute: async (interaction: ChatInputCommandInteraction) => {
    const isServerOwner = interaction.guild?.ownerId === interaction.user.id;
    const isServerAdmin =
      interaction.member?.permissions instanceof PermissionsBitField &&
      interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

    if (!isServerOwner && !isServerAdmin) {
      await interaction.reply({
        embeds: [
          getGenericErrorEmbed(
            'You are not the server owner',
            'Please contact the server owner to set the store configuration',
          ),
        ],
      });
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      throw new Error('Guild ID is required');
    }

    const currency = interaction.options.getString('currency');
    const botAdminRole = interaction.options.getRole('bot-admin-role');
    if (!currency) {
      throw new Error('Currency is required');
    }
    if (!botAdminRole) {
      throw new Error('Bot admin role is required');
    }
    const newConfig = {
      guildId,
      currency,
      botAdminRoleId: botAdminRole.id,
    };
    const storeConfig = await StoreConfigDAL.updateConfig(newConfig);
    await setStoreConfigInCache(guildId, {
      botAdminRoleId: botAdminRole.id,
      currency,
    });
    const embed = new EmbedBuilder()
      .setTitle('Store Configuration')
      .setDescription(`Updated store configuration`)
      .setColor(Colors.Green)
      .setTimestamp()
      .addFields(
        {
          name: 'Currency',
          value: currency,
        },
        {
          name: 'Bot Admin Role',
          value: `<@&${botAdminRole.id}>`,
          inline: true,
        },
      );
    if (storeConfig) {
      await interaction.reply({
        embeds: [embed],
      });
    } else {
      await interaction.reply({
        embeds: [getGenericErrorEmbed('Failed to set store configuration', 'Try again later')],
      });
    }
  },
};

export default SetStoreCommand;
