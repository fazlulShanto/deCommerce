import type { AutocompleteInteraction, ModalActionRowComponentBuilder } from 'discord.js';
import {
  ActionRowBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import type { SlashCommand } from '../../config/command-handler';
import { ProductDAL } from '@/db/product.dal';
import { MAX_AUTOCOMPLETE_CHOICES } from '@/utils/constants';

const commandName = 'update-product';

export const UpdateProductCommand: SlashCommand = {
  name: commandName,
  description: 'Update products in the inventory',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Update products in the inventory')
    .addStringOption((option) =>
      option
        .setName('product-name')
        .setDescription('The name of the product to update')
        .setAutocomplete(true)
        .setRequired(true),
    ) as SlashCommandBuilder,
  autocomplete: async (interaction: AutocompleteInteraction) => {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const guildId = interaction.guildId;
    const productList = await ProductDAL.getProductsByGuildId(guildId + '');
    const products = productList.filter((product) =>
      product.name.toLowerCase().includes(focusedValue),
    );
    // Format choices for Discord
    const choices = products
      .map((product) => ({
        name: product.name,
        value: product._id.toString(), // or product._id if you prefer to use IDs
      }))
      .slice(0, MAX_AUTOCOMPLETE_CHOICES);

    await interaction.respond(choices);
  },
  requiredPermissions: [],

  execute: async (interaction: ChatInputCommandInteraction) => {
    const selectedProductId = interaction.options.getString('product-name');

    const guildId = interaction.guildId;
    if (!selectedProductId) {
      await interaction.reply({
        content: 'Invalid product',
      });
      return;
    }
    if (!guildId) {
      await interaction.reply({
        content: 'Guild ID is required',
      });
      return;
    }

    const product = await ProductDAL.getProductById(selectedProductId);

    if (!product) {
      await interaction.reply({
        content: 'Product not found',
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId('updateProductModal_' + product._id.toString())
      .setTitle('Update Product');

    const nameInput = new TextInputBuilder()
      .setCustomId('name')
      .setLabel('Product Name')
      .setValue(product.name)
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Product Description')
      .setValue(product.description)
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    const priceInput = new TextInputBuilder()
      .setCustomId('price')
      .setLabel('Price')
      .setValue(product.price.toString())
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter price (e.g., 99.99)')
      .setRequired(true);

    // const emojiInput = new TextInputBuilder()
    //   .setCustomId('emoji')
    //   .setLabel('Product Emoji')
    //   .setStyle(TextInputStyle.Short)
    //   .setValue(product?.emoji ? product.emoji + '' : '')
    //   .setPlaceholder('Enter an emoji (e.g., 🎮)')
    //   .setRequired(false);

    const isAvailableInput = new TextInputBuilder()
      .setCustomId('isAvailable')
      .setLabel('Is Available')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter yes or no')
      .setValue(product.isAvailable ? 'yes' : 'no')
      .setRequired(true);

    const nameRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(nameInput);
    const descriptionRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      descriptionInput,
    );
    const priceRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      priceInput,
    );
    // const emojiRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
    //   emojiInput,
    // );

    const isAvailableRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      isAvailableInput,
    );

    modal.addComponents(nameRow, descriptionRow, priceRow, isAvailableRow);

    await interaction.showModal(modal);
  },
};

export default UpdateProductCommand;
