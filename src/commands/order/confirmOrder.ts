import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js';
import { OrderDAL } from '../../db/order.dal';
import type { SlashCommand } from '../../config/command-handler';
import { getGenericErrorEmbed } from '@/utils/genericEmbeds';
import { PaymentMethodDAL } from '@/db/payment-method.dal';
import { MAX_AUTOCOMPLETE_CHOICES } from '@/utils/constants';

const commandName = 'confirm-order';

export const ConfirmOrderCommand: SlashCommand = {
  name: commandName,
  description: 'Confirm an order',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Confirm an order')
    .addStringOption((option) =>
      option.setName('order-id').setDescription('The ID of the order to confirm').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('payment-method')
        .setDescription('The payment method to use')
        .setRequired(true)
        .setAutocomplete(true),
    ) as SlashCommandBuilder,

  requiredPermissions: ['BotAdmin', 'GuildOnly', 'PremiumOrTrial'],

  autocomplete: async (interaction: AutocompleteInteraction) => {
    try {
      const focusedValue = interaction.options.getFocused().toLowerCase();
      const guildId = interaction.guildId;

      if (!guildId) {
        await interaction.respond([]);
        return;
      }

      const paymentMethods = await PaymentMethodDAL.getPaymentMethodsByGuildId(guildId);
      const filteredMethods = paymentMethods
        .filter((method) => method.name.toLowerCase().includes(focusedValue))
        .map((method) => ({
          name: method.name,
          value: method._id.toString(),
        }))
        .slice(0, MAX_AUTOCOMPLETE_CHOICES);

      await interaction.respond(filteredMethods);
    } catch (error) {
      console.error('Error in autocomplete:', error);
      await interaction.respond([]);
    }
  },

  execute: async (interaction: ChatInputCommandInteraction) => {
    try {
      const guildId = interaction.guildId;
      if (!guildId) {
        throw new Error('Guild ID is required');
      }

      const orderId = interaction.options.getString('order-id');
      const paymentMethodId = interaction.options.getString('payment-method');

      if (!orderId || !paymentMethodId) {
        await interaction.reply({
          embeds: [
            getGenericErrorEmbed(
              'Missing required fields',
              'Please provide both order ID and payment method.',
            ),
          ],
        });
        return;
      }

      const order = await OrderDAL.updateOrder(orderId, {
        confirmationStatus: 'confirmed',
        deliveryStatus: 'processing',
        paymentStatus: 'completed',
        paymentMethod: paymentMethodId,
      });

      if (!order) {
        await interaction.reply({
          embeds: [
            getGenericErrorEmbed(
              'No orders found',
              'No orders found matching the provided order ID. Create some orders using `/buy` command.',
            ),
          ],
        });
        return;
      }

      const paymentMethod = await PaymentMethodDAL.getPaymentMethodById(paymentMethodId);
      if (!paymentMethod) {
        await interaction.reply({
          embeds: [
            getGenericErrorEmbed(
              'Payment method not found',
              'The selected payment method no longer exists.',
            ),
          ],
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('Order Confirmed')
        .setDescription(`Order from <@${order.customerId}> has been confirmed.`)
        .addFields([
          {
            name: 'Order ID',
            value: order._id.toString(),
          },
          {
            name: 'Product Name',
            value: order.productName,
          },
          {
            name: 'Price',
            value: `${order.price.toFixed(2)}`,
          },
          {
            name: 'Payment Method',
            value: paymentMethod.name,
          },
        ])
        .setColor('Green');

      await interaction.reply({
        embeds: [embed],
      });
    } catch (error) {
      console.error('Error confirming order:', error);
      await interaction.reply({
        content: 'There was an error while confirming the order!',
        ephemeral: true,
      });
    }
  },
};
