import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, CacheType } from 'discord.js';
import type { SlashCommand, AdditionalCommandInfo } from '../../config/command-handler';
import { PremiumInfoDAL } from '../../db/premium-info.dal';
import { intervalToDuration, formatDuration } from 'date-fns';

export const PremiumCommand: SlashCommand = {
  name: 'premium',
  description: 'Check server premium status and information',
  data: new SlashCommandBuilder()
    .setName('premium')
    .setDescription('Check server premium status and information'),
  requiredPermissions: ['GuildOnly'],
  execute: async (
    interaction: ChatInputCommandInteraction<CacheType>,
    _additionalInfo?: AdditionalCommandInfo,
  ): Promise<void> => {
    const guildId = interaction.guild?.id;

    if (!guildId) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Get premium info or initialize if not found
    let premiumInfo = await PremiumInfoDAL.getPremiumInfoByGuildId(guildId);

    if (!premiumInfo) {
      // Initialize premium info with default trial (7 days)
      await interaction.deferReply();
      premiumInfo = await PremiumInfoDAL.initializeServerPremium(guildId);
    }

    const isPremiumActive = await PremiumInfoDAL.hasPremium(guildId);
    const isTrialActive = await PremiumInfoDAL.hasActiveTrial(guildId);

    // Format time remaining using date-fns
    let premiumTimeRemaining = '';
    let trialTimeRemaining = '';

    if (premiumInfo.premiumExpiryDate && premiumInfo.premiumExpiryDate > new Date()) {
      const duration = intervalToDuration({
        start: new Date(),
        end: premiumInfo.premiumExpiryDate,
      });

      premiumTimeRemaining = formatDuration(duration, {
        format: ['days', 'hours', 'minutes'],
        delimiter: ', ',
      });

      // Handle case when less than a day is left
      if (!premiumTimeRemaining) {
        premiumTimeRemaining = 'less than a minute';
      }
    }

    if (premiumInfo.trialEndDate && premiumInfo.trialEndDate > new Date()) {
      const duration = intervalToDuration({
        start: new Date(),
        end: premiumInfo.trialEndDate,
      });

      trialTimeRemaining = formatDuration(duration, {
        format: ['days', 'hours', 'minutes'],
        delimiter: ', ',
      });

      // Handle case when less than a day is left
      if (!trialTimeRemaining) {
        trialTimeRemaining = 'less than a minute';
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('Premium Status')
      .setDescription(
        `Premium information for ${interaction.guild.name}(ID: ${interaction.guild.id})`,
      )
      .setColor(isPremiumActive || isTrialActive ? 'Green' : 'Red')
      .addFields(
        {
          name: 'Premium Status',
          value: isPremiumActive ? `✅ Active (${premiumTimeRemaining} remaining)` : '❌ Inactive',
          inline: false,
        },
        {
          name: 'Trial Status',
          value: isTrialActive
            ? `✅ Active (${trialTimeRemaining} remaining)`
            : premiumInfo.hasUsedTrial
              ? '❌ Expired'
              : '❌ Not Started',
          inline: true,
        },
      );

    // Add more detailed information
    if (premiumInfo.isPremium && premiumInfo.premiumExpiryDate) {
      embed.addFields({
        name: 'Premium Expiry Date',
        value: `<t:${Math.floor(premiumInfo.premiumExpiryDate.getTime() / 1000)}:F>`,
        inline: false,
      });
    }

    if (premiumInfo.isTrial) {
      if (premiumInfo.trialStartDate) {
        embed.addFields({
          name: 'Trial Start Date',
          value: `<t:${Math.floor(premiumInfo.trialStartDate.getTime() / 1000)}:F>`,
          inline: true,
        });
      }

      if (premiumInfo.trialEndDate) {
        embed.addFields({
          name: 'Trial End Date',
          value: `<t:${Math.floor(premiumInfo.trialEndDate.getTime() / 1000)}:F>`,
          inline: true,
        });
      }
    }

    embed.setFooter({ text: 'Premium benefits include access to all features' });
    embed.setTimestamp();

    if (interaction.deferred) {
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.reply({ embeds: [embed] });
    }
  },
};

export default PremiumCommand;
