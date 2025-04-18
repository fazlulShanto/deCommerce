import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
} from 'discord.js';
import type { SlashCommand } from '../../config/command-handler';
import { getStoreConfigFromCache } from '@/utils/redis';
import { PremiumInfoDAL } from '@/db/premium-info.dal';
import { format, formatDuration, intervalToDuration } from 'date-fns';

export const HealthCheckCommand: SlashCommand = {
  name: 'health-check',
  description: 'Check the health of the bot',
  data: new SlashCommandBuilder()
    .setName('health-check')
    .setDescription('Check the health of the bot'),
  requiredPermissions: ['Administrator', 'PremiumOrTrial'],
  execute: async (interaction: ChatInputCommandInteraction) => {
    const storeConfig = await getStoreConfigFromCache(interaction.guildId ?? '');
    const premiumInfo = await PremiumInfoDAL.getPremiumInfoByGuildId(interaction.guildId ?? '');
    const isPremium = premiumInfo?.isPremium;
    const isTrial = premiumInfo?.isTrial;
    const statusText = isPremium ? 'Premium' : isTrial ? 'Trial' : 'Free';
    const expiryDate = premiumInfo?.isPremium
      ? premiumInfo.premiumExpiryDate
        ? new Date(premiumInfo.premiumExpiryDate)
        : 'None'
      : premiumInfo?.trialEndDate
        ? new Date(premiumInfo.trialEndDate)
        : 'None';
    const embed = new EmbedBuilder()
      .setTitle('Server Health Check')
      .setDescription(`**Premium status: ${statusText}**`)
      .addFields(
        {
          name: 'Bot Admin Role',
          value: `<@&${storeConfig.botAdminRoleId}>`,
          inline: true,
        },
        {
          name: 'Currency',
          value: storeConfig.currency,
          inline: true,
        },
        {
          name: `${statusText} Expiry Date`,
          value: expiryDate ? format(expiryDate, 'MM/dd/yyyy HH:mm:ss') : 'None',
          inline: true,
        },
        {
          name: `${statusText} Remaining`,
          value:
            isPremium || isTrial
              ? `\`${formatDuration(intervalToDuration({ start: new Date(), end: expiryDate }), { format: ['months', 'days', 'hours', 'minutes'] })}\``
              : 'None',
          inline: true,
        },
      )
      .setColor(Colors.Green);
    await interaction.reply({ embeds: [embed] });
  },
};

export default HealthCheckCommand;
