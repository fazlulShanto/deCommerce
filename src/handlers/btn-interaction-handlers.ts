import { GiveawayDAL } from '@/db/giveaway.dal';
import { PaymentMethodDAL } from '@/db/payment-method.dal';
import { ProductDAL } from '@/db/product.dal';
import { BOT_COMMAND_BUTTON_IDS } from '@/utils/constants';
import {
  MessageFlags,
  type ButtonInteraction,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type TextChannel,
} from 'discord.js';
import { redis } from '@/utils/redis';
import {
  getGiveawayWizardState,
  clearGiveawayWizardState,
} from '@/services/giveaway-wizard.service';
import { parseDuration } from '@/utils/duration-parser';

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

  if (interaction.customId.startsWith('giveaway_v2_')) {
    await handleGiveawayV2Buttons(interaction);
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

export const handleGiveawayV2Buttons = async (interaction: ButtonInteraction) => {
  const userId = interaction.user.id;
  const state = await getGiveawayWizardState(userId);

  if (!state) {
    await interaction.reply({
      content:
        '❌ Setup session expired or not found. Please start over using `/giveaway_v2 start`.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  if (interaction.customId === 'giveaway_v2_cancel') {
    await clearGiveawayWizardState(userId);
    await interaction.update({
      content: '❌ Giveaway setup cancelled.',
      embeds: [],
      components: [],
    });
    return;
  }

  if (interaction.customId === 'giveaway_v2_sub_1') {
    const modal = new ModalBuilder()
      .setCustomId(`giveaway_v2_modal_1:${userId}`)
      .setTitle('Step 1: General Info');

    const prizeInput = new TextInputBuilder()
      .setCustomId('prize')
      .setLabel('Prize')
      .setStyle(TextInputStyle.Short)
      .setValue(state.prize || '')
      .setRequired(true);

    const durationInput = new TextInputBuilder()
      .setCustomId('duration')
      .setLabel('Duration (e.g., 10m, 1h, 1d)')
      .setStyle(TextInputStyle.Short)
      .setValue(state.duration || '')
      .setRequired(true);

    const winnersInput = new TextInputBuilder()
      .setCustomId('winners')
      .setLabel('Winners Count')
      .setStyle(TextInputStyle.Short)
      .setValue(state.winnersCount ? String(state.winnersCount) : '1')
      .setRequired(false);

    const leaveInput = new TextInputBuilder()
      .setCustomId('allowLeave')
      .setLabel('Allow Leave? (Y/N)')
      .setStyle(TextInputStyle.Short)
      .setValue(state.allowLeave ? 'Y' : 'N')
      .setRequired(false);

    const delayInput = new TextInputBuilder()
      .setCustomId('startDelay')
      .setLabel('Start Delay (e.g., 5m - Optional)')
      .setStyle(TextInputStyle.Short)
      .setValue(state.startDelay || '')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(prizeInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(durationInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(winnersInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(leaveInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(delayInput),
    );

    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === 'giveaway_v2_sub_2') {
    const modal = new ModalBuilder()
      .setCustomId(`giveaway_v2_modal_2:${userId}`)
      .setTitle('Step 2: Exclusions');

    const rolesInput = new TextInputBuilder()
      .setCustomId('blacklistedRoles')
      .setLabel('Blacklisted Roles (Comma separated IDs)')
      .setStyle(TextInputStyle.Short)
      .setValue(state.blacklistedRoles ? state.blacklistedRoles.join(',') : '')
      .setRequired(false);

    const usersInput = new TextInputBuilder()
      .setCustomId('blacklistedUsers')
      .setLabel('Blacklisted Users (Comma separated IDs)')
      .setStyle(TextInputStyle.Short)
      .setValue(state.blacklistedUsers ? state.blacklistedUsers.join(',') : '')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(rolesInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(usersInput),
    );

    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === 'giveaway_v2_sub_3') {
    const modal = new ModalBuilder()
      .setCustomId(`giveaway_v2_modal_3:${userId}`)
      .setTitle('Step 3: Description');

    const descInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Long Description / Rules')
      .setStyle(TextInputStyle.Paragraph)
      .setValue(state.description || '')
      .setRequired(false);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(descInput));

    await interaction.showModal(modal);
    return;
  }

  if (
    interaction.customId === 'giveaway_v2_submit_create' ||
    interaction.customId === 'giveaway_v2_submit_edit'
  ) {
    // Submit execution: will be processed by validateAndCreateHandler triggered right here.
    // For cleanly separate execution logic, I will implement handleGiveawayV2Submit(interaction, state)
    await handleGiveawayV2Submit(interaction, state);
  }
};

export const handleGiveawayV2Submit = async (interaction: ButtonInteraction, state: any) => {
  const isEdit = state.mode === 'edit';
  const guildId = state.guildId;
  const channelId = state.channelId;

  if (!state.prize || !state.duration) {
    await interaction.reply({
      content: '❌ Missing Prize or Duration. Please fill Step 1.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  const durationMs = parseDuration(state.duration);
  if (!durationMs) {
    await interaction.reply({
      content: '❌ Invalid Duration format. Use like `10m`, `1h`.',
      flags: [MessageFlags.Ephemeral],
    });
    return;
  }

  let startDelayMs = 0;
  if (state.startDelay && state.startDelay !== 'None') {
    const parsedDelay = parseDuration(state.startDelay);
    if (!parsedDelay) {
      await interaction.reply({
        content: '❌ Invalid Start Delay format.',
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
    startDelayMs = parsedDelay;
  }

  const startTime = new Date(Date.now() + startDelayMs);
  const endTime = new Date(startTime.getTime() + durationMs);
  const isScheduled = startDelayMs > 0;

  const embed = new EmbedBuilder()
    .setTitle(`🎉 GIVEAWAY: ${state.prize} 🎉`)
    .setColor('Blurple')
    .setTimestamp(endTime)
    .setFooter({ text: 'Ends' });

  const baseDesc = isScheduled
    ? `This giveaway starts <t:${Math.floor(startTime.getTime() / 1000)}:R>!`
    : `React with the button below to enter!`;

  embed.setDescription(state.description ? `${state.description}\n\n${baseDesc}` : baseDesc);

  if (isScheduled) {
    embed.addFields([
      { name: 'Winners', value: `${state.winnersCount || 1}`, inline: true },
      { name: 'Starts At', value: `<t:${Math.floor(startTime.getTime() / 1000)}:f>`, inline: true },
      { name: 'Hosted By', value: `${interaction.user}`, inline: true },
    ]);
  } else {
    embed.addFields([
      { name: 'Winners', value: `${state.winnersCount || 1}`, inline: true },
      { name: 'Ends At', value: `<t:${Math.floor(endTime.getTime() / 1000)}:R>`, inline: true },
      { name: 'Hosted By', value: `${interaction.user}`, inline: true },
      { name: 'Participants', value: '0', inline: true },
    ]);
  }

  const row = new ActionRowBuilder<ButtonBuilder>();
  if (isScheduled) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('giveaway_placeholder')
        .setLabel('Not Started')
        .setEmoji('⏳')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    );
  } else {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('giveaway_join')
        .setLabel('Enter')
        .setEmoji('🎉')
        .setStyle(ButtonStyle.Success),
    );
    if (state.allowLeave) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('giveaway_leave')
          .setLabel('Leave')
          .setEmoji('🚪')
          .setStyle(ButtonStyle.Danger),
      );
    }
  }

  await interaction.update({ content: '⏳ Processing giveaway...', embeds: [], components: [] });

  try {
    const channel = interaction.guild?.channels.cache.get(channelId) as TextChannel;
    if (!channel) throw new Error('Channel not found.');

    if (isEdit) {
      const originalMessage = await channel.messages.fetch(state.messageId);
      if (originalMessage) {
        await originalMessage.edit({ embeds: [embed], components: [row] });
      }

      await GiveawayDAL.updateGiveaway(state.messageId, {
        prize: state.prize,
        winnersCount: state.winnersCount || 1,
        startTime,
        endTime,
        allowLeave: !!state.allowLeave,
        blacklistedRoles: state.blacklistedRoles || [],
        blacklistedUsers: state.blacklistedUsers || [],
        description: state.description,
      });

      // Update Redis queues
      await redis.zadd('giveaway:end_queue', endTime.getTime(), state.messageId);
      if (isScheduled) {
        await redis.zadd('giveaway:start_queue', startTime.getTime(), state.messageId);
      } else {
        await redis.zrem('giveaway:start_queue', state.messageId);
      }

      await interaction.followUp({
        content: '✅ Giveaway updated successfully!',
        flags: [MessageFlags.Ephemeral],
      });
    } else {
      const message = await channel.send({ embeds: [embed], components: [row] });

      await GiveawayDAL.createGiveaway({
        guildId,
        channelId,
        messageId: message.id,
        prize: state.prize,
        winnersCount: state.winnersCount || 1,
        startTime,
        endTime,
        participants: [],
        winners: [],
        ended: false,
        allowLeave: !!state.allowLeave,
        blacklistedRoles: state.blacklistedRoles || [],
        blacklistedUsers: state.blacklistedUsers || [],
        description: state.description,
      });

      await redis.zadd('giveaway:end_queue', endTime.getTime(), message.id);
      if (isScheduled) {
        await redis.zadd('giveaway:start_queue', startTime.getTime(), message.id);
      }

      await interaction.followUp({
        content: '✅ Giveaway created successfully!',
        flags: [MessageFlags.Ephemeral],
      });
    }

    await clearGiveawayWizardState(interaction.user.id);
  } catch (error: any) {
    console.error('Error in handleGiveawayV2Submit:', error);
    await interaction.followUp({
      content: `❌ Failed to execute: ${error.message || error}`,
      flags: [MessageFlags.Ephemeral],
    });
  }
};
