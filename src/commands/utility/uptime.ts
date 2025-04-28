import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import type { SlashCommand } from '../../config/command-handler';
import { formatDistanceToNow } from 'date-fns';

const commandName = 'uptime';

export const UptimeCommand: SlashCommand = {
  name: commandName,
  description: 'Shows how long the bot has been online',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Shows how long the bot has been online'),

  requiredPermissions: ['GuildOnly'],

  execute: async (interaction) => {
    const uptime = process.uptime();
    const startDate = new Date(Date.now() - uptime * 1000);

    const formattedStartDate = formatDistanceToNow(startDate, { addSuffix: true });
    const embed = new EmbedBuilder()
      .setTitle('Bot Uptime')
      .setDescription("Here's how long I've been online:")
      .addFields([
        {
          name: 'Uptime',
          value: `\`\`\`elm\n${formattedStartDate}\n\`\`\``,
        },
      ])
      .setColor('Green')
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

export default UptimeCommand;
