import {
  Colors,
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { SlashCommand } from '../../config/command-handler';
import { getGenericErrorEmbed } from '@/utils/genericEmbeds';
import { getStoreConfigFromCache } from '@/utils/redis';

const commandName = 'view-store-config';

export const ViewStoreConfigCommand: SlashCommand = {
  name: commandName,
  description: 'View the store configuration',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('View the store configuration'),
  requiredPermissions: ['BotAdmin', 'GuildOnly'],

  execute: async (interaction: ChatInputCommandInteraction) => {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        embeds: [getGenericErrorEmbed('Failed to view store configuration', 'Try again later')],
      });
      return;
    }

    const storeConfig = await getStoreConfigFromCache(guildId);

    const embed = new EmbedBuilder()
      .setTitle('Store Configuration')
      .setDescription(`Updated store configuration`)
      .setColor(Colors.Green)
      .setTimestamp()
      .addFields(
        {
          name: 'Currency',
          value: storeConfig?.currency,
        },
        {
          name: 'Bot Admin Role',
          value: `<@&${storeConfig?.botAdminRoleId}>`,
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

export default ViewStoreConfigCommand;
