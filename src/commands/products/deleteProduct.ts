import type { AutocompleteInteraction } from 'discord.js';
import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { ProductDAL, type ProductDocument } from '../../db/product.dal';
import type { SlashCommand } from '../../config/command-handler';
import { getGenericErrorEmbed } from '@/utils/genericEmbeds';

const commandName = 'delete-product';

export const DeleteProductCommand: SlashCommand = {
  name: commandName,
  description: 'Delete a product from the inventory',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Delete a product from the inventory')
    .addStringOption((option) =>
      option
        .setName('product-name')
        .setDescription('The name of the product to delete')
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
    const choices = products.map((product) => ({
      name: product.name,
      value: product.name, // or product._id if you prefer to use IDs
    }));

    await interaction.respond(choices);
  },

  requiredPermissions: [],

  execute: async (interaction: ChatInputCommandInteraction) => {
    try {
      await interaction.deferReply();
      const guildId = interaction.guildId;
      const productName = interaction.options.getString('product-name');
      if (!guildId) {
        throw new Error('Guild ID is required');
      }
      const productList = await ProductDAL.getProductsByGuildId(guildId);
      const product = productList.find((p) => p.name === productName) as ProductDocument;

      if (!product) {
        await interaction.followUp({
          embeds: [
            getGenericErrorEmbed(
              'No products found',
              'No products found in the inventory. Add some products using `/add-product` command.',
            ),
          ],
        });
        return;
      }

      const deletedProduct = await ProductDAL.deleteSingleProduct(product._id.toString(), guildId);
      if (!deletedProduct) {
        throw new Error('Failed to delete product');
      }

      const embed = new EmbedBuilder()
        .setTitle('Deleted Product: ' + deletedProduct.name)
        .setDescription('Deleted Product details')
        .addFields([
          {
            name: 'Product ID: ' + deletedProduct._id.toString(),
            value:
              '```' +
              'Product Name: ' +
              deletedProduct.name +
              '\n' +
              'Price: ' +
              deletedProduct.price +
              '\n' +
              '```',
          },
        ])
        .setColor('Red');

      await interaction.followUp({
        embeds: [embed],
      });
    } catch (error) {
      console.error('Error fetching products:', error);
      await interaction.reply({
        content: 'There was an error while fetching the products!',
        ephemeral: true,
      });
    }
  },
};
