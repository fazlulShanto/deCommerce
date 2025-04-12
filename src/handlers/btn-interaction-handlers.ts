/* eslint-disable @typescript-eslint/no-unused-vars */
import { MessageFlags, type ButtonInteraction } from 'discord.js';

export const handleButtonInteractions = async (interaction: ButtonInteraction) => {
  if (interaction.customId.startsWith('copyPhoneNumber_')) {
    await handleCopyPhoneNumberButton(interaction);
  }
  if (interaction.customId.startsWith('paymentMethod_')) {
    await handlePaymentMethodButton(interaction);
  }
};

export const handlePaymentMethodButton = async (interaction: ButtonInteraction) => {
  const [_, paymentMethodName, paymentMethodId] = interaction.customId.split('_');

  await interaction.reply({
    content: 'Payment method selected',
  });
};

export const handleCopyPhoneNumberButton = async (interaction: ButtonInteraction) => {
  const [_, paymentMethodPhoneNumber] = interaction.customId.split('_');
  const isInvalidNumber = Number.isNaN(Number(paymentMethodPhoneNumber));
  if (!paymentMethodPhoneNumber || paymentMethodPhoneNumber === 'undefined' || isInvalidNumber) {
    await interaction.reply({
      content: 'No phone number found or invalid phone number',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }
  await interaction.reply({
    content: '```' + paymentMethodPhoneNumber + '```',
    flags: [MessageFlags.Ephemeral],
  });
};
