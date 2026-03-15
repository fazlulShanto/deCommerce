import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  MessageFlags,
} from 'discord.js';
import type { SlashCommand } from '../../config/command-handler';
import { CommandPermissions } from '../../config/command-handler';
import { GiveawayDAL } from '../../db/giveaway.dal';
import {
  generateGiveawayDashboard,
  saveGiveawayWizardState,
} from '../../services/giveaway-wizard.service';

export const GiveawayV2Command: SlashCommand = {
  name: 'giveaway_v2',
  description: 'Manage giveaways with Stepper Wizard (v2)',
  isGuildOnly: true,
  data: new SlashCommandBuilder()
    .setName('giveaway_v2')
    .setDescription('Manage giveaways with Stepper Wizard (v2)')
    // START Subcommand
    .addSubcommand((subcommand) =>
      subcommand.setName('start').setDescription('Start a giveaway configuration wizard'),
    )
    // EDIT Subcommand
    .addSubcommand((subcommand) =>
      subcommand
        .setName('edit')
        .setDescription('Edit an active giveaway')
        .addStringOption((option) =>
          option
            .setName('message_id')
            .setDescription('Select the giveaway to edit')
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ) as SlashCommandBuilder,
  requiredPermissions: ['Administrator', 'GuildOnly', 'BotAdmin'],

  autocomplete: async (interaction: AutocompleteInteraction) => {
    const focusedValue = interaction.options.getFocused();
    const guildId = interaction.guildId;
    if (!guildId) return;

    const giveaways = await GiveawayDAL.getScheduledOrActiveGiveawaysByGuild(guildId);
    const filtered = giveaways
      .filter(
        (g) =>
          g.prize.toLowerCase().includes(focusedValue.toLowerCase()) ||
          g.messageId.includes(focusedValue),
      )
      .slice(0, 25);

    await interaction.respond(
      filtered.map((g) => ({
        name: `${g.prize} (${g.messageId})`,
        value: g.messageId,
      })),
    );
  },

  execute: async (interaction: ChatInputCommandInteraction) => {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    switch (subcommand) {
      case 'start': {
        const initialState = {
          mode: 'create' as const,
          guildId: interaction.guildId || '',
          channelId: interaction.channelId || '',
        };
        await saveGiveawayWizardState(userId, initialState);
        const dashboard = generateGiveawayDashboard(initialState);
        await interaction.reply({ ...dashboard, flags: [MessageFlags.Ephemeral] });
        break;
      }
      case 'edit': {
        const messageId = interaction.options.getString('message_id', true);
        const giveaway = await GiveawayDAL.getGiveawayByMessageId(messageId);

        if (!giveaway) {
          await interaction.reply({
            content: '❌ Giveaway not found.',
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }

        if (giveaway.ended) {
          await interaction.reply({
            content: '❌ This giveaway has already ended.',
            flags: [MessageFlags.Ephemeral],
          });
          return;
        }

        const initialState = {
          mode: 'edit' as const,
          messageId: messageId,
          guildId: giveaway.guildId,
          channelId: giveaway.channelId,
          prize: giveaway.prize,
          winnersCount: giveaway.winnersCount,
          duration: 'Manual Edit', // Cannot reverse parse Date back to 1h accurately easily
          allowLeave: giveaway.allowLeave,
          blacklistedRoles: giveaway.blacklistedRoles,
          blacklistedUsers: giveaway.blacklistedUsers,
          description: giveaway.description,
        };

        await saveGiveawayWizardState(userId, initialState);
        const dashboard = generateGiveawayDashboard(initialState);
        await interaction.reply({ ...dashboard, flags: [MessageFlags.Ephemeral] });
        break;
      }
      default:
        await interaction.reply({
          content: 'Unknown subcommand.',
          flags: [MessageFlags.Ephemeral],
        });
    }
  },
};

export default GiveawayV2Command;
