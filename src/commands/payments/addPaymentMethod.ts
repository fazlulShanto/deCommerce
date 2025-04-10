import type { ModalActionRowComponentBuilder } from 'discord.js';
import {
  ActionRowBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import type { SlashCommand } from '../../config/command-handler';

const commandName = 'add-payment-method';

export const AddPaymentMethodCommand: SlashCommand = {
  name: commandName,
  description: 'Add a payment method to the store',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Add a payment method to the store'),
  requiredPermissions: [],

  execute: async (interaction: ChatInputCommandInteraction) => {
    const modal = new ModalBuilder()
      .setCustomId('addPaymentMethodModal')
      .setTitle('Add New Payment Method');

    const nameInput = new TextInputBuilder()
      .setCustomId('name')
      .setLabel('Payment Method Name')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const emojiInput = new TextInputBuilder()
      .setCustomId('emoji')
      .setLabel('Payment Method Emoji')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter an emoji (e.g., :credit_card:)')
      .setRequired(false);

    const nameRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(nameInput);
    const emojiRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      emojiInput,
    );

    modal.addComponents(nameRow, emojiRow);

    await interaction.showModal(modal);
  },
};

export default AddPaymentMethodCommand;
