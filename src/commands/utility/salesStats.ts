import type { APIEmbedField } from 'discord.js';
import { SlashCommandBuilder, type ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import type { SlashCommand, AdditionalCommandInfo } from '../../config/command-handler';
import { OrderDAL } from '../../db/order.dal';
import { ProductDAL } from '../../db/product.dal';
import { PaymentMethodDAL } from '../../db/payment-method.dal';

export const SalesStatsCommand: SlashCommand = {
  name: 'sales-stats',
  description: 'Get sales stats',
  data: new SlashCommandBuilder().setName('sales-stats').setDescription('Get sales stats'),
  requiredPermissions: [],
  execute: async (
    interaction: ChatInputCommandInteraction,
    additionalInfo: AdditionalCommandInfo = {},
  ) => {
    await interaction.deferReply();

    const isBotAdmin = await interaction.client.isBotAdmin(interaction, false);

    const shouldHideSensitiveData = !isBotAdmin;

    const currency = additionalInfo.currency || '';

    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.editReply('This command can only be used in a server.');
      return;
    }

    try {
      // Fetch all relevant data
      const [orders, products, paymentMethods] = await Promise.all([
        OrderDAL.getOrdersByGuildId(guildId),
        ProductDAL.getProductsByGuildId(guildId),
        PaymentMethodDAL.getPaymentMethodsByGuildId(guildId),
      ]);

      // Calculate basic statistics
      const totalOrders = orders.length;
      const totalRevenue = orders.reduce((sum, order) => sum + order.paymentAmount, 0);
      const completedOrders = orders.filter((order) => order.paymentStatus === 'completed').length;
      const pendingOrders = orders.filter((order) => order.paymentStatus === 'pending').length;
      const failedOrders = orders.filter((order) => order.paymentStatus === 'failed').length;

      // Calculate average order value
      const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      // Calculate most ordered product
      const productStats = orders.reduce(
        (acc, order) => {
          acc[order.productName] = (acc[order.productName] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      const mostOrderedProduct = Object.entries(productStats)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3);

      // Calculate most valuable customers
      const customerStats = orders.reduce(
        (acc, order) => {
          if (!acc[order.customerId]) {
            acc[order.customerId] = {
              totalSpent: 0,
              orderCount: 0,
            };
          }
          acc[order.customerId].totalSpent += order.paymentAmount;
          acc[order.customerId].orderCount += 1;
          return acc;
        },
        {} as Record<string, { totalSpent: number; orderCount: number }>,
      );

      const topCustomers = Object.entries(customerStats)
        .sort(([, a], [, b]) => b.totalSpent - a.totalSpent)
        .slice(0, 3);

      // Create embed
      const embed = new EmbedBuilder()
        .setTitle('📊 Store Statistics')
        .setColor('Green')
        .setTimestamp();

      const embedFields = [
        { name: 'Total Products', value: products.length.toString(), inline: true },
        { name: 'Total Orders', value: totalOrders.toString(), inline: true },
        shouldHideSensitiveData
          ? undefined
          : {
              name: 'Total Revenue',
              value: `${currency} ${totalRevenue.toFixed(2)}`,
              inline: true,
            },
        { name: 'Completed Orders', value: completedOrders.toString(), inline: true },
        { name: 'Pending Orders', value: pendingOrders.toString(), inline: true },
        { name: 'Failed Orders', value: failedOrders.toString(), inline: true },
        shouldHideSensitiveData
          ? undefined
          : {
              name: 'Average Order Value',
              value: `${currency} ${averageOrderValue.toFixed(2)}`,
              inline: false,
            },
        {
          name: 'Available Payment Methods',
          value: paymentMethods.length.toString(),
          inline: true,
        },
      ];

      // Add most ordered products
      if (mostOrderedProduct.length > 0) {
        const topProductsText = mostOrderedProduct
          .map(([product, count]) => `${product}: ${count} orders`)
          .join('\n');

        embedFields.push({
          name: '🏆 Most Ordered Products',
          value: topProductsText,
          inline: false,
        });
      }

      // Add top customers
      if (topCustomers.length > 0) {
        const topCustomersText = topCustomers
          .map(([customerId, stats]) =>
            shouldHideSensitiveData
              ? `<@${customerId}>: ${stats.orderCount} orders`
              : `<@${customerId}>: ${currency} ${stats.totalSpent.toFixed(2)} (${stats.orderCount} orders)`,
          )
          .join('\n');

        embedFields.push({
          name: '👑 Top Customers',
          value: topCustomersText,
          inline: false,
        });
      }

      const formattedFields = embedFields.filter((f) => f) as APIEmbedField[];

      await interaction.editReply({ embeds: [embed.addFields(...formattedFields)] });
    } catch (error) {
      console.error('Error fetching sales stats:', error);
      await interaction.editReply('An error occurred while fetching the sales statistics.');
    }
  },
};

export default SalesStatsCommand;
