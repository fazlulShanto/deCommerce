import type { ModalActionRowComponentBuilder } from 'discord.js';
import {
  ActionRowBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import type { SlashCommand } from '../../config/command-handler';

const commandName = 'add-product';

export const AddProductsCommand: SlashCommand = {
  name: commandName,
  description: 'Add products to the inventory',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Add products to the inventory'),
  requiredPermissions: ['BotAdmin', 'GuildOnly', 'PremiumOrTrial'],

  execute: async (interaction: ChatInputCommandInteraction) => {
    const modal = new ModalBuilder().setCustomId('addProductModal').setTitle('Add New Product');

    const nameInput = new TextInputBuilder()
      .setCustomId('name')
      .setLabel('Product Name')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Product Description')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    const priceInput = new TextInputBuilder()
      .setCustomId('price')
      .setLabel('Price')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter price (e.g., 99.99)')
      .setRequired(true);

    const isAvailableInput = new TextInputBuilder()
      .setCustomId('isAvailable')
      .setLabel('Is Available')
      .setStyle(TextInputStyle.Short)
      .setMinLength(2)
      .setMaxLength(3)
      .setPlaceholder('Enter yes or no')
      .setRequired(true);

    const nameRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(nameInput);
    const descriptionRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      descriptionInput,
    );
    const priceRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      priceInput,
    );

    const isAvailableRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      isAvailableInput,
    );

    modal.addComponents(nameRow, descriptionRow, priceRow, isAvailableRow);

    await interaction.showModal(modal);
  },
};

export default AddProductsCommand;
