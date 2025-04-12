import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { OrderDAL } from '../../db/order.dal';
import type { SlashCommand } from '../../config/command-handler';
import { getGenericErrorEmbed } from '@/utils/genericEmbeds';
import { MAX_AUTOCOMPLETE_CHOICES } from '@/utils/constants';

const commandName = 'list-orders';

export const ListOrdersCommand: SlashCommand = {
  name: commandName,
  description: 'List all orders in the server',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('List all orders in the server')
    .addStringOption((option) =>
      option
        .setName('payment-status')
        .setDescription('Filter orders by payment status')
        .addChoices(
          { name: 'Pending', value: 'pending' },
          { name: 'Completed', value: 'completed' },
          { name: 'Failed', value: 'failed' },
          { name: 'Refunded', value: 'refunded' },
        )
        .setRequired(true),
    ) as SlashCommandBuilder,
  requiredPermissions: [],

  execute: async (interaction: ChatInputCommandInteraction) => {
    try {
      const guildId = interaction.guildId;
      if (!guildId) {
        throw new Error('Guild ID is required');
      }

      const paymentStatus = interaction.options.getString('payment-status') || 'all';

      let orders = await OrderDAL.getOrdersByGuildId(guildId);

      orders = orders.filter((order) => order.paymentStatus === paymentStatus);

      if (orders.length === 0) {
        await interaction.reply({
          embeds: [
            getGenericErrorEmbed(
              'No orders found',
              'No orders found matching the selected filters. Create some orders using `/buy` command.',
            ),
          ],
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('Order List')
        .setDescription(`List of all orders`)
        .addFields(
          orders
            .map((order) => ({
              name: '',
              value:
                '```Order ID: ' +
                order._id.toString() +
                '\n' +
                'Product Name: ' +
                order.productName +
                '\n' +
                'Price: ' +
                order.price +
                '\n' +
                'Payment Method: ' +
                order.paymentMethod +
                '\n' +
                'Payment Status: ' +
                order.paymentStatus +
                '\n' +
                'Customer ID: ' +
                order.customerId +
                '\n' +
                '```',
            }))
            .slice(0, MAX_AUTOCOMPLETE_CHOICES),
        )
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

export default ListOrdersCommand;
