import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommand } from '../../config/command-handler';
import { PremiumInfoDAL } from '@/db/premium-info.dal';
import { invalidatePremiumCache } from '@/services/premium.service';
import { logger } from '@/utils/logger';

const commandName = 'revoke-premium';

const RevokeSubscriptionCommand: SlashCommand = {
  name: commandName,
  description: 'Revokes premium/trial subscription from a server (Admin only)',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Revokes premium subscription or trial status from a server (Admin only)')
    .addStringOption((option) =>
      option
        .setName('guild_id')
        .setDescription('ID of the guild to revoke subscription from')
        .setRequired(true),
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

    try {
      // Get current premium info
      let premiumInfo = await PremiumInfoDAL.getPremiumInfoByGuildId(guildId);

      if (!premiumInfo) {
        await logger.error('No premium information found for guild ID', new Error(), {
          context: { userId: interaction.user.id, guildId, guildName: interaction.guild?.name },
        });
        // initialize premium info
        premiumInfo = await PremiumInfoDAL.initializeServerPremium(guildId);
      }

      // Determine the current status for the log message
      const currentStatus = premiumInfo.isPremium
        ? 'premium subscription'
        : premiumInfo.isTrial
          ? 'trial status'
          : 'no premium status';

      // Update the premium information to revoke all premium status
      const updatedInfo = await PremiumInfoDAL.updatePremiumInfo(guildId, {
        isTrial: false,
        trialEndDate: new Date(new Date().setDate(new Date().getDate() - 1)),
        isPremium: false,
        hasUsedTrial: true,
        premiumExpiryDate: new Date(new Date().setDate(new Date().getDate() - 1)),
      });

      if (!updatedInfo) {
        await logger.error('Failed to revoke subscription', new Error(), {
          context: { userId: interaction.user.id, guildId, guildName: interaction.guild?.name },
        });
        await interaction.editReply(`❌ Failed to revoke subscription for guild ID: ${guildId}`);
        return;
      }

      // Invalidate cache to reflect changes immediately
      await invalidatePremiumCache(guildId);

      // Log the action
      await logger.info(
        `Subscription revoked for guild ${guildId}. Previous status: ${currentStatus}`,
        {
          context: {
            userId: interaction.user.id,
            guildId,
            guildName: interaction.guild?.name,
          },
        },
      );

      await interaction.editReply(`✅ Successfully revoked ${currentStatus} for guild ${guildId}.`);
    } catch (error) {
      await logger.error('Error revoking subscription', error as Error, {
        context: { userId: interaction.user.id, guildId, guildName: interaction.guild?.name },
      });
      await interaction.editReply(`❌ Failed to revoke subscription: ${(error as Error).message}`);
    }
  },
};

export default RevokeSubscriptionCommand;
