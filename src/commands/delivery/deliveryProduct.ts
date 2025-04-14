import type { ModalActionRowComponentBuilder } from 'discord.js';
import {
  ModalBuilder,
  SlashCommandBuilder,
  TextInputStyle,
  TextInputBuilder,
  type ChatInputCommandInteraction,
  ActionRowBuilder,
} from 'discord.js';
import { OrderDAL } from '../../db/order.dal';
import type { SlashCommand } from '../../config/command-handler';
import { getGenericErrorEmbed } from '@/utils/genericEmbeds';
import { MODAL_IDS } from '@/utils/constants';

const commandName = 'deliver-product';

export const DeliveryProductCommand: SlashCommand = {
  name: commandName,
  description: 'Deliver a product',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Deliver a product')
    .addStringOption((option) =>
      option
        .setName('order-id')
        .setDescription('The ID of the order to delivery')
        .setRequired(true),
    ) as SlashCommandBuilder,

  requiredPermissions: ['BotAdmin', 'GuildOnly'],

  execute: async (interaction: ChatInputCommandInteraction) => {
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

      const modal = new ModalBuilder()
        .setCustomId([MODAL_IDS.DELIVERY_PRODUCT, orderId].join('_'))
        .setTitle('Delivery Product');

      const descriptionInput = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Product Delivery Info')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      const descriptionRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        descriptionInput,
      );
      modal.addComponents(descriptionRow);
      await interaction.showModal(modal);
    } catch (error) {
      console.error('Error fetching orders:', error);
      await interaction.reply({
        content: 'There was an error while fetching the orders!',
        ephemeral: true,
      });
    }
  },
};
