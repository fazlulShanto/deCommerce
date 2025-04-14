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
import { MODAL_IDS } from '@/utils/constants';

const commandName = 'add-payment-method';

export const AddPaymentMethodCommand: SlashCommand = {
  name: commandName,
  description: 'Add a payment method to the store',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Add a payment method to the store'),
  requiredPermissions: ['BotAdmin', 'GuildOnly'],

  execute: async (interaction: ChatInputCommandInteraction) => {
    const modal = new ModalBuilder()
      .setCustomId(MODAL_IDS.ADD_PAYMENT_METHOD)
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

    const qrCodeImageInput = new TextInputBuilder()
      .setCustomId('qrCodeImage')
      .setLabel('QR Code Image Link')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter the QR code image URL')
      .setRequired(false);

    const phoneNumberInput = new TextInputBuilder()
      .setCustomId('phoneNumber')
      .setLabel('Phone Number')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter the phone number')
      .setRequired(true);

    const nameRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(nameInput);
    const emojiRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      emojiInput,
    );
    const qrCodeImageRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      qrCodeImageInput,
    );
    const phoneNumberRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      phoneNumberInput,
    );

    modal.addComponents(nameRow, qrCodeImageRow, phoneNumberRow, emojiRow);

    await interaction.showModal(modal);
  },
};

export default AddPaymentMethodCommand;
