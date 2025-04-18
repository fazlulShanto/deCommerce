import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import type { SlashCommand } from '../../config/command-handler';
import { getStoreConfigFromCache } from '@/utils/redis';

export const HealthCheckCommand: SlashCommand = {
  name: 'health-check',
  description: 'Check the health of the bot',
  data: new SlashCommandBuilder()
    .setName('health-check')
    .setDescription('Check the health of the bot'),
  requiredPermissions: ['Administrator', 'PremiumOrTrial'],
  execute: async (interaction: ChatInputCommandInteraction) => {
    const storeConfig = await getStoreConfigFromCache(interaction.guildId ?? '');

    const embed = new EmbedBuilder()
      .setTitle('Health Check')
      .setDescription(`Store config: ${JSON.stringify(storeConfig)}`)
      .addFields(
        {
          name: 'Bot Admin Role ID',
          value: storeConfig.botAdminRoleId,
          inline: true,
        },
        {
          name: 'Currency',
          value: storeConfig.currency,
          inline: true,
        },
      )
      .setColor(Colors.Green);
    await interaction.reply({ embeds: [embed] });
  },
};

export default HealthCheckCommand;
