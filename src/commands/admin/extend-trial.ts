import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommand } from '../../config/command-handler';
import { PremiumInfoDAL } from '@/db/premium-info.dal';
import {
  invalidatePremiumCache,
  updatePremiumStatusCacheForGuild,
} from '@/services/premium.service';
import { logger } from '@/utils/logger';
import { addDays } from 'date-fns';

const ExtendTrialCommand: SlashCommand = {
  name: 'extend-trial',
  description: "Extends a server's trial period (Admin only)",
  data: new SlashCommandBuilder()
    .setName('extend-trial')
    .setDescription("Extends a server's trial period (Admin only)")
    .addStringOption((option) =>
      option
        .setName('guild_id')
        .setDescription('ID of the guild to extend trial for')
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('days')
        .setDescription('Number of days to extend the trial')
        .setRequired(true)
        .setMinValue(1),
    ) as SlashCommandBuilder,

  requiredPermissions: [],

  execute: async (interaction: ChatInputCommandInteraction): Promise<void> => {
    // Check if user is admin
    if (!interaction.client.isBotDevAdmin(interaction)) {
      await logger.error('User is not an admin', new Error(), {
        context: { userId: interaction.user.id, guildId: interaction.guildId ?? undefined },
      });

      await interaction.reply({
        content: '❌ This command is restricted to bot administrators only.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.options.getString('guild_id', true);
    const daysToExtend = interaction.options.getInteger('days', true);

    try {
      // Get current premium info
      let premiumInfo = await PremiumInfoDAL.getPremiumInfoByGuildId(guildId);
      if (!premiumInfo) {
        // initialize server premium info
        premiumInfo = await PremiumInfoDAL.initializeServerPremium(guildId);
      }

      // Calculate new end date
      const currentEndDate = premiumInfo?.trialEndDate || new Date();
      let newEndDate = addDays(new Date(currentEndDate), daysToExtend);

      // Update the trial information
      const updatedInfo = await PremiumInfoDAL.updatePremiumInfo(guildId, {
        isTrial: true,
        trialEndDate: newEndDate,
        premiumExpiryDate: null,
        isPremium: false,
      });

      if (!updatedInfo) {
        await interaction.editReply(`❌ Failed to update trial info for guild ID: ${guildId}`);
        return;
      }

      // Invalidate cache to reflect changes immediately
      await invalidatePremiumCache(guildId);
      await updatePremiumStatusCacheForGuild(guildId);

      // Log the action
      await logger.info(
        `Trial extended for guild ${guildId} by ${daysToExtend} days. New end date: ${newEndDate.toISOString()}`,
        {
          context: {
            userId: interaction.user.id,
            guildId,
            guildName: interaction.guild?.name,
          },
        },
      );

      await interaction.editReply(
        `✅ Trial extended for guild ${guildId} by ${daysToExtend} days. New end date: ${newEndDate.toLocaleDateString()}`,
      );
    } catch (error) {
      console.error('Error extending trial:', error);
      await interaction.editReply(`❌ Failed to extend trial: ${(error as Error).message}`);
    }
  },
};

export default ExtendTrialCommand;
