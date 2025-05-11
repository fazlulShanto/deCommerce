import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommand } from '../../config/command-handler';

export const ServerInfoCommand: SlashCommand = {
  name: 'server-info',
  description: 'Get server information',
  data: new SlashCommandBuilder().setName('server-info').setDescription('Get server information'),
  requiredPermissions: ['Administrator'],
  execute: async (interaction: ChatInputCommandInteraction) => {
    const embed = new EmbedBuilder()
      .setTitle('Server Info')
      .setDescription('Server information')
      .setColor('Blue')
      .addFields(
        {
          name: 'Server Name',
          value: interaction.guild?.name || 'Unknown',
        },
        { name: 'Server ID', value: interaction.guild?.id || 'Unknown' },
        {
          name: 'Total Members',
          value: interaction.guild?.memberCount?.toString() || 'Unknown',
        },
        {
          name: 'Total Channels',
          value: interaction.guild?.channels.cache.size.toString() || 'Unknown',
        },
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  },
};

export default ServerInfoCommand;
