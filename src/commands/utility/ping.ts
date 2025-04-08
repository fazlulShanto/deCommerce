import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommand } from '../../config/command-handler';

export const PingCommand: SlashCommand = {
  name: 'ping',
  description: 'Ping the bot',
  data: new SlashCommandBuilder().setName('ping').setDescription('Ping the bot'),
  requiredPermissions: ['Administrator'],
  execute: async (interaction: ChatInputCommandInteraction) => {
    await interaction.reply(`Bot is up and running!🚀`);
  },
};

export default PingCommand;
