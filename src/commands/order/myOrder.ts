import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { OrderDAL } from '../../db/order.dal';
import type { SlashCommand } from '../../config/command-handler';
import { getGenericErrorEmbed } from '@/utils/genericEmbeds';
// Import OrderDocument type for status validation if needed, or define statuses directly
import type { OrderDocument } from '../../db/order.dal';

const commandName = 'my-orders';

// Define possible payment statuses based on your schema in order.dal.ts
const paymentStatuses: OrderDocument['paymentStatus'][] = [
  'pending',
  'completed',
  'failed',
  'refunded',
];

export const MyOrdersCommand: SlashCommand = {
  // Renamed from MyPendingOrdersCommand
  name: commandName,
  description: 'View your latest orders, optionally filtered by payment status.', // Updated description
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('View your last orders, optionally filtered by payment status.') // Updated description
    .addStringOption(
      (
        option, // Added string option for payment status
      ) =>
        option
          .setName('payment-status')
          .setDescription('Filter orders by payment status.')
          .setRequired(false) // Make it optional
          .addChoices(
            // Add choices based on the defined statuses
            ...paymentStatuses.map((status) => ({ name: status, value: status })),
          ),
    ) as SlashCommandBuilder,
  requiredPermissions: ['GuildOnly'],

  execute: async (interaction: ChatInputCommandInteraction) => {
    try {
      const userId = interaction.user.id;
      const guildId = interaction.guildId;
      if (!guildId) {
        // It's good practice to reply ephemerally if possible for errors like this
        await interaction.reply({
          content: 'This command can only be used in a server.',
          flags: [MessageFlags.Ephemeral],
        });
        return;
        // throw new Error('Guild ID is required'); // Avoid throwing errors directly in command execution
      }

      // Get the optional payment status from the command options
      const selectedStatus = interaction.options.getString('payment-status') as
        | OrderDocument['paymentStatus']
        | null;
      // Default to 'pending' if no status is selected
      const filterStatus = selectedStatus ?? 'pending';

      let orders = await OrderDAL.getOrdersByCustomerAndGuildId(userId, guildId);
      // Filter orders by the selected or default payment status and take the latest 5
      orders = orders
        .filter((order) => order.paymentStatus === filterStatus)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) // Sort by creation date descending
        .slice(0, 5);

      if (orders.length === 0) {
        await interaction.reply({
          embeds: [
            getGenericErrorEmbed(
              `No ${filterStatus} orders found`, // Dynamic title
              `You have no orders with the status "${filterStatus}" at the moment.`, // Dynamic description
            ),
          ],
          ephemeral: true, // Make this ephemeral so only the user sees it
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(`Your ${filterStatus.charAt(0).toUpperCase() + filterStatus.slice(1)} Orders`) // Dynamic title
        .setDescription(`Here are your last 5 orders with status "${filterStatus}"`) // Dynamic description
        .addFields(
          orders.map((order) => ({
            name: `Order ID: ${order._id.toString()}`, // Use name field for Order ID
            value:
              // Simplified value field
              `Product: ${order.productName}\n` +
              `Price: ${order.price}\n` +
              `Payment Status: ${order.paymentStatus}`,
            // Removed the ``` block for better field formatting
          })),
        )
        .setColor('Yellow') // Consider changing color based on status? (Optional)
        .setTimestamp(); // Add timestamp for context

      await interaction.reply({
        embeds: [embed],
      });
    } catch (error) {
      console.error(`Error executing ${commandName}:`, error); // Log specific command name
      await interaction.reply({
        content: 'There was an error while fetching your orders!',
        flags: [MessageFlags.Ephemeral],
      });
    }
  },
};

export default MyOrdersCommand; // Renamed export
