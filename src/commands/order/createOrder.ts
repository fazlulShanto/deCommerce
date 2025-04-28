import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  MessageFlags,
} from 'discord.js';
import type { SlashCommand } from '../../config/command-handler';
import { OrderDAL } from '@/db/order.dal';
import { ProductDAL } from '@/db/product.dal';
import { getGenericErrorEmbed } from '@/utils/genericEmbeds';
import { MAX_AUTOCOMPLETE_CHOICES } from '@/utils/constants';

const commandName = 'create-order';

export const CreateOrderCommand: SlashCommand = {
  name: commandName,
  description: 'Create an order for a customer manually',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Create an order for a customer manually')
    .addUserOption((option) =>
      option
        .setName('customer')
        .setDescription('The customer to create the order for')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('product-name')
        .setDescription('The name of the product')
        .setAutocomplete(true)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('payment-status')
        .setDescription('The payment status of the order')
        .addChoices(
          { name: 'Pending', value: 'pending' },
          { name: 'Completed', value: 'completed' },
          { name: 'Failed', value: 'failed' },
          { name: 'Refunded', value: 'refunded' },
        )
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('confirmation-status')
        .setDescription('The confirmation status of the order')
        .addChoices(
          { name: 'Pending', value: 'pending' },
          { name: 'Confirmed', value: 'confirmed' },
          { name: 'Cancelled', value: 'cancelled' },
        )
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('delivery-status')
        .setDescription('The delivery status of the order')
        .addChoices(
          { name: 'Pending', value: 'pending' },
          { name: 'Processing', value: 'processing' },
          { name: 'Delivered', value: 'delivered' },
          { name: 'Cancelled', value: 'cancelled' },
        )
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('delivery-info')
        .setDescription('Additional delivery information')
        .setRequired(false),
    ) as SlashCommandBuilder,

  requiredPermissions: ['BotAdmin', 'GuildOnly', 'PremiumOrTrial'],

  autocomplete: async (interaction: AutocompleteInteraction) => {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const guildId = interaction.guildId;
    const productList = await ProductDAL.getProductsByGuildId(guildId + '');
    const products = productList.filter((product) =>
      product.name.toLowerCase().includes(focusedValue),
    );
    const choices = products
      .map((product) => ({
        name: product.name,
        value: product._id.toString(),
      }))
      .slice(0, MAX_AUTOCOMPLETE_CHOICES);

    await interaction.respond(choices);
  },

  execute: async (interaction: ChatInputCommandInteraction, additionalInfo) => {
    try {
      const guildId = interaction.guildId;
      if (!guildId) {
        throw new Error('Guild ID is required');
      }

      const customer = interaction.options.getUser('customer') || '';
      const productId = interaction.options.getString('product-name') || '';
      const paymentStatus = interaction.options.getString('payment-status') || '';
      const confirmationStatus = interaction.options.getString('confirmation-status') || '';
      const deliveryStatus = interaction.options.getString('delivery-status') || '';
      const deliveryInfo = interaction.options.getString('delivery-info') || '';

      if (!customer || !productId) {
        await interaction.reply({
          embeds: [
            getGenericErrorEmbed('Missing required fields', 'Please provide all required fields.'),
          ],
        });
        return;
      }

      const product = await ProductDAL.getProductById(productId);
      if (!product) {
        await interaction.reply({
          embeds: [
            getGenericErrorEmbed('Product not found', 'The selected product does not exist.'),
          ],
        });
        return;
      }

      const order = await OrderDAL.createOrder({
        productName: product.name,
        price: product.price,
        paymentMethod: '',
        customerId: customer.id,
        guildId: guildId,
        confirmationStatus: confirmationStatus as 'pending' | 'confirmed' | 'cancelled',
        deliveryStatus: deliveryStatus as 'pending' | 'processing' | 'delivered' | 'cancelled',
        paymentAmount: product.price,
        paymentStatus: paymentStatus as 'pending' | 'completed' | 'failed' | 'refunded',
        deliveryInfo,
      });

      if (!order) {
        throw new Error('Failed to create order!');
      }

      const embed = new EmbedBuilder()
        .setTitle('Order Created')
        .setDescription(`Order created for customer <@${customer.id}>`)
        .addFields([
          {
            name: 'Order ID',
            value: order._id.toString(),
          },
          {
            name: 'Product Name',
            value: product.name,
          },
          {
            name: 'Price',
            value:
              '```elm\n' + product.price.toString() + ' ' + additionalInfo?.currency + '' + '\n```',
          },
          {
            name: 'Payment Status',
            value: paymentStatus,
          },
          {
            name: 'Confirmation Status',
            value: confirmationStatus,
          },
          {
            name: 'Delivery Status',
            value: deliveryStatus,
          },
          {
            name: 'Delivery Info',
            value: deliveryInfo || 'N/A',
          },
        ])
        .setTimestamp()
        .setColor('Green');

      await interaction.reply({
        embeds: [embed],
      });
    } catch (error) {
      console.error('Error creating order:', error);
      await interaction.reply({
        content: 'There was an error while creating the order!',
        flags: [MessageFlags.Ephemeral],
      });
    }
  },
};

export default CreateOrderCommand;
