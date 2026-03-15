import { GiveawayDAL } from '@/db/giveaway.dal';
import { PaymentMethodDAL } from '@/db/payment-method.dal';
import { ProductDAL } from '@/db/product.dal';
import { BOT_COMMAND_BUTTON_IDS } from '@/utils/constants';
import { MessageFlags, type ButtonInteraction, EmbedBuilder } from 'discord.js';
import { redis } from '@/utils/redis';

export const handleButtonInteractions = async (interaction: ButtonInteraction) => {
  if (interaction.customId === 'giveaway_join') {
    await handleGiveawayJoinButton(interaction);
    return;
  }
  if (interaction.customId === 'giveaway_leave') {
    await handleGiveawayLeaveButton(interaction);
    return;
  }
  if (interaction.customId.startsWith(BOT_COMMAND_BUTTON_IDS.COPY_PHONE_NUMBER)) {
    await handleCopyPhoneNumberButton(interaction);
  }
  if (interaction.customId.startsWith(BOT_COMMAND_BUTTON_IDS.PAYMENT_METHOD)) {
    await handlePaymentMethodButton(interaction);
  }
};

export const handleGiveawayJoinButton = async (interaction: ButtonInteraction) => {
  const messageId = interaction.message.id;
  const userId = interaction.user.id;

  const lockKey = `giveaway:join:lock:${messageId}:${userId}`;
  const acquired = await redis.set(lockKey, '1', 'EX', 30, 'NX');
  if (acquired !== 'OK') {
    await interaction.reply({
      content: '⚠️ Slow down! You are clicking too fast.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const giveaway = await GiveawayDAL.getGiveawayByMessageId(messageId);
  if (!giveaway) {
    await interaction.reply({
      content: '❌ Giveaway not found in database.',
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

  if (giveaway.participants.includes(userId)) {
    await interaction.reply({
      content: 'ℹ️ You have already entered this giveaway.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const updatedGiveaway = await GiveawayDAL.addParticipant(messageId, userId);
  if (!updatedGiveaway) {
    await interaction.reply({
      content: '❌ Failed to enter giveaway. Please try again.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Update embed
  const embed = interaction.message.embeds[0];
  if (embed) {
    const newEmbed = EmbedBuilder.from(embed);
    // Participants is the 4th field (index 3)
    // Let's verify fields exist
    if (newEmbed.data.fields && newEmbed.data.fields.length > 3) {
      newEmbed.data.fields[3].value = `${updatedGiveaway.participants.length}`;
    }

    await interaction.message.edit({ embeds: [newEmbed] });
  }

  await interaction.reply({
    content: '🎉 You have entered the giveaway!',
    flags: [MessageFlags.Ephemeral],
  });
};

export const handleGiveawayLeaveButton = async (interaction: ButtonInteraction) => {
  const messageId = interaction.message.id;
  const userId = interaction.user.id;

  const lockKey = `giveaway:leave:lock:${messageId}:${userId}`;
  const acquired = await redis.set(lockKey, '1', 'EX', 3, 'NX');
  if (acquired !== 'OK') {
    await interaction.reply({
      content: '⚠️ Slow down! You are clicking too fast.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const giveaway = await GiveawayDAL.getGiveawayByMessageId(messageId);
  if (!giveaway) {
    await interaction.reply({ content: '❌ Giveaway not found.', flags: [MessageFlags.Ephemeral] });
    return;
  }

  if (giveaway.ended) {
    await interaction.reply({
      content: '❌ This giveaway has already ended.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!giveaway.allowLeave) {
    await interaction.reply({
      content: '❌ Leaving is not allowed for this giveaway.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (!giveaway.participants.includes(userId)) {
    await interaction.reply({
      content: 'ℹ️ You have not entered this giveaway.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const updatedGiveaway = await GiveawayDAL.removeParticipant(messageId, userId);
  if (!updatedGiveaway) {
    await interaction.reply({
      content: '❌ Failed to leave giveaway.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  // Update embed
  const embed = interaction.message.embeds[0];
  if (embed) {
    const newEmbed = EmbedBuilder.from(embed);
    if (newEmbed.data.fields && newEmbed.data.fields.length > 3) {
      newEmbed.data.fields[3].value = `${updatedGiveaway.participants.length}`;
    }
    await interaction.message.edit({ embeds: [newEmbed] });
  }

  await interaction.reply({
    content: '🚪 You have left the giveaway.',
    flags: [MessageFlags.Ephemeral],
  });
};

export const handlePaymentMethodButton = async (interaction: ButtonInteraction) => {
  const [_, productId, paymentMethodId, commandUserId, _orderId] = interaction.customId.split('_');

  if (commandUserId !== interaction.user.id) {
    await interaction.reply({
      content: '❌ You are not allowed to use this command.',
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
        name: 'Product Name',
        value: product.name,
      },
      {
        name: 'Account Number',
        value: '```\n' + paymentMethod.phoneNumber + '\n```',
      },
      {
        name: 'Price',
        value: '```\n' + product.price + '\n```',
      },
    ])
    .setTimestamp()
    .setFooter({
      text: 'Order ID:' + _orderId,
    })
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
