/* eslint-disable @typescript-eslint/no-unused-vars */
import { PaymentMethodDAL } from '@/db/payment-method.dal';
import { ProductDAL } from '@/db/product.dal';
import { BOT_COMMAND_BUTTON_IDS } from '@/utils/constants';
import { MessageFlags, type ButtonInteraction, EmbedBuilder } from 'discord.js';

export const handleButtonInteractions = async (interaction: ButtonInteraction) => {
  if (interaction.customId.startsWith(BOT_COMMAND_BUTTON_IDS.COPY_PHONE_NUMBER)) {
    await handleCopyPhoneNumberButton(interaction);
  }
  if (interaction.customId.startsWith(BOT_COMMAND_BUTTON_IDS.PAYMENT_METHOD)) {
    await handlePaymentMethodButton(interaction);
  }
};

export const handlePaymentMethodButton = async (interaction: ButtonInteraction) => {
  const [_, productId, paymentMethodId, commandUserId] = interaction.customId.split('_');

  if (commandUserId !== interaction.user.id) {
    await interaction.reply({
      content: '❌ You are not allowed.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // get product
  const product = await ProductDAL.getProductById(productId);
  if (!product) {
    await interaction.reply({
      content: '```elm\nProduct not found. Please contact the server staffs\n```',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }
  // get payment method
  const paymentMethod = await PaymentMethodDAL.getPaymentMethodById(paymentMethodId);
  if (!paymentMethod) {
    await interaction.reply({
      content: '```elm\nPayment method not found. Please contact the server staffs\n```',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(` ${paymentMethod.name} payment details`)
    .addFields([
      {
        name: 'Phone Number',
        value: paymentMethod.phoneNumber,
      },
      {
        name: 'Product',
        value: '```\n' + product.name + '\n```',
      },
      {
        name: 'Price',
        value: '```\n' + product.price + '\n```',
      },
    ])
    .setTimestamp()
    .setColor('Blue');

  if (paymentMethod.qrCodeImage) {
    embed.setImage(paymentMethod.qrCodeImage);
  }

  await interaction.reply({
    embeds: [embed],
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
