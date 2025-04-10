import type { AutocompleteInteraction } from 'discord.js';
import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { ProductDAL } from '../../db/product.dal';
import type { SlashCommand } from '../../config/command-handler';
import { getGenericErrorEmbed } from '@/utils/genericEmbeds';
import { MAX_AUTOCOMPLETE_CHOICES } from '@/utils/constants';

const commandName = 'product-details';

export const ProductDetailsCommand: SlashCommand = {
  name: commandName,
  description: 'Get details of a product',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Get details of a product')
    .addStringOption((option) =>
      option
        .setName('product-name')
        .setDescription('The name of the product to get details of')
        .setAutocomplete(true)
        .setRequired(true),
    ) as SlashCommandBuilder,

  requiredPermissions: [],

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
        value: product._id.toString(),
      }))
      .slice(0, MAX_AUTOCOMPLETE_CHOICES);

    await interaction.respond(choices);
  },

  execute: async (interaction: ChatInputCommandInteraction) => {
    try {
      await interaction.deferReply();
      const productId = interaction.options.getString('product-name');

      if (!productId) {
        await interaction.followUp({
          embeds: [getGenericErrorEmbed('No product ID provided', 'Please provide a product ID.')],
        });
        return;
      }
      const guildId = interaction.guildId;
      if (!guildId) {
        throw new Error('Guild ID not found!');
      }
      const product = await ProductDAL.getProductById(productId);
      if (!product) {
        await interaction.followUp({
          embeds: [
            getGenericErrorEmbed('Product not found', 'No product found with the provided ID.'),
          ],
        });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle('Product Details')
        .addFields(
          {
            name: 'Product ID',
            value: product._id.toString(),
          },
          {
            name: 'Product Name',
            value: product.name,
          },
          {
            name: 'Price',
            value: product.price.toString(),
          },
          {
            name: 'Description',
            value: product.description,
          },
          {
            name: 'Availability',
            value: product.isAvailable ? 'Yes' : 'No',
          },
        )
        .setColor('Blue');

      await interaction.followUp({
        embeds: [embed],
      });
    } catch (error) {
      console.error('Error fetching products:', error);
      await interaction.followUp({
        content: 'There was an error while fetching the products!',
        ephemeral: true,
      });
    }
  },
};

export default ProductDetailsCommand;
