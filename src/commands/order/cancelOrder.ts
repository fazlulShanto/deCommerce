import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { OrderDAL } from '../../db/order.dal';
import type { SlashCommand } from '../../config/command-handler';
import { getGenericErrorEmbed } from '@/utils/genericEmbeds';
import { format } from 'date-fns';

const commandName = 'cancel-order';

export const CancelOrderCommand: SlashCommand = {
  name: commandName,
  description: 'Cancel an order',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Cancel an order')
    .addStringOption((option) =>
      option.setName('order-id').setDescription('The ID of the order to cancel').setRequired(true),
    ) as SlashCommandBuilder,

  requiredPermissions: ['BotAdmin', 'GuildOnly', 'PremiumOrTrial'],

  execute: async (interaction: ChatInputCommandInteraction, additionalInfo) => {
    try {
      const guildId = interaction.guildId;
      if (!guildId) {
        throw new Error('Guild ID is required');
      }

      const orderId = interaction.options.getString('order-id');

      if (!orderId) {
        await interaction.reply({
          embeds: [
            getGenericErrorEmbed('No order ID provided', 'Please provide an correct order ID.'),
          ],
        });
        return;
      }

      const order = await OrderDAL.updateOrder(orderId, {
        confirmationStatus: 'cancelled',
        deliveryStatus: 'cancelled',
        paymentStatus: 'failed',
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

      const embed = new EmbedBuilder()
        .setTitle('Order Cancelled')
        .setDescription(`Order from <@${order.customerId}> has been cancelled.`)
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
            value: `${order.price} ${additionalInfo?.currency}`,
          },
          {
            name: 'Payment Method',
            value: order.paymentMethod || 'N/A',
          },
          {
            name: 'Ordered At',
            value: format(order.createdAt, 'MMM d, yyyy h:mm a'),
          },
        ])
        .setColor('Red');

      await interaction.reply({
        embeds: [embed],
      });
    } catch (error) {
      console.error('Error fetching orders:', error);
      await interaction.reply({
        content: 'There was an error while fetching the orders!',
        ephemeral: true,
      });
    }
  },
};
