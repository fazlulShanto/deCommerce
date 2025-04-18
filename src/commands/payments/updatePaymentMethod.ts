import type { AutocompleteInteraction, ModalActionRowComponentBuilder } from 'discord.js';
import {
  ActionRowBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import type { SlashCommand } from '../../config/command-handler';
import { PaymentMethodDAL } from '@/db/payment-method.dal';
import { MAX_AUTOCOMPLETE_CHOICES, MODAL_IDS } from '@/utils/constants';

const commandName = 'update-payment-method';

export const UpdatePaymentMethodCommand: SlashCommand = {
  name: commandName,
  description: 'Update payment methods in the store',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Update payment methods in the store')
    .addStringOption((option) =>
      option
        .setName('payment-method-name')
        .setDescription('The name of the payment method to update')
        .setAutocomplete(true)
        .setRequired(true),
    ) as SlashCommandBuilder,
  autocomplete: async (interaction: AutocompleteInteraction) => {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const guildId = interaction.guildId;
    const paymentMethodList = await PaymentMethodDAL.getPaymentMethodsByGuildId(guildId + '');
    const paymentMethods = paymentMethodList.filter((method) =>
      method.name.toLowerCase().includes(focusedValue),
    );
    // Format choices for Discord
    const choices = paymentMethods
      .map((method) => ({
        name: method.name,
        value: method._id.toString(),
      }))
      .slice(0, MAX_AUTOCOMPLETE_CHOICES);

    await interaction.respond(choices);
  },
  requiredPermissions: ['BotAdmin', 'GuildOnly', 'PremiumOrTrial'],

  execute: async (interaction: ChatInputCommandInteraction) => {
    const selectedPaymentMethodId = interaction.options.getString('payment-method-name');

    const guildId = interaction.guildId;
    if (!selectedPaymentMethodId) {
      await interaction.reply({
        content: 'Invalid payment method',
      });
      return;
    }
    if (!guildId) {
      await interaction.reply({
        content: 'Guild ID is required',
      });
      return;
    }

    const paymentMethod = await PaymentMethodDAL.getPaymentMethodById(selectedPaymentMethodId);

    if (!paymentMethod) {
      await interaction.reply({
        content: 'Payment method not found',
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId([MODAL_IDS.UPDATE_PAYMENT_METHOD, paymentMethod._id.toString()].join('_'))
      .setTitle('Update Payment Method');

    const nameInput = new TextInputBuilder()
      .setCustomId('name')
      .setLabel('Payment Method Name')
      .setValue(paymentMethod.name)
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const emojiInput = new TextInputBuilder()
      .setCustomId('emoji')
      .setLabel('Payment Method Emoji')
      .setStyle(TextInputStyle.Short)
      .setValue(paymentMethod.emoji || '')
      .setPlaceholder('Enter an emoji (e.g., :credit_card:)')
      .setRequired(false);

    const qrCodeImageInput = new TextInputBuilder()
      .setCustomId('qrCodeImage')
      .setLabel('QR Code Image Link')
      .setStyle(TextInputStyle.Short)
      .setValue(paymentMethod.qrCodeImage || '')
      .setPlaceholder('Enter the QR code image URL')
      .setRequired(false);

    const phoneNumberInput = new TextInputBuilder()
      .setCustomId('phoneNumber')
      .setLabel('Phone Number')
      .setStyle(TextInputStyle.Short)
      .setValue(paymentMethod.phoneNumber || '')
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

    modal.addComponents(nameRow, emojiRow, qrCodeImageRow, phoneNumberRow);

    await interaction.showModal(modal);
  },
};

export default UpdatePaymentMethodCommand;
