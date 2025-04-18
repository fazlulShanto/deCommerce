import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { OrderDAL } from '../../db/order.dal';
import type { SlashCommand } from '../../config/command-handler';
import { getGenericErrorEmbed } from '@/utils/genericEmbeds';

const commandName = 'order-details';

export const OrderDetailsCommand: SlashCommand = {
  name: commandName,
  description: 'Get details of an order',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Get details of an order')
    .addStringOption((option) =>
      option
        .setName('order-id')
        .setDescription('The ID of the order to get details of')
        .setRequired(true),
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

      const order = await OrderDAL.getOrderById(orderId);

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

      const deliveryInfo = order?.deliveryInfo ? '```' + order.deliveryInfo + '```' : '\u200b';

      const embed = new EmbedBuilder()
        .setTitle('Order Details')
        .setDescription(deliveryInfo)
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
            value: '```json\n' + order.price.toString() + additionalInfo?.currency + '```',
          },
          {
            name: 'Payment Method',
            value: order.paymentMethod,
          },
          {
            name: 'Confirmation Status',
            value: order.confirmationStatus,
          },
          {
            name: 'Delivery Status',
            value: order.deliveryStatus,
          },
          {
            name: 'Payment Status',
            value: '```elm\n' + order.paymentStatus + '\n```',
          },
          {
            name: 'Customer ID',
            value: order.customerId,
          },
        ])
        .setColor('Green');

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
