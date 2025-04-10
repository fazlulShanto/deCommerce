import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { ProductDAL } from '../../db/product.dal';
import type { SlashCommand } from '../../config/command-handler';
import { getGenericErrorEmbed } from '@/utils/genericEmbeds';
import { MAX_AUTOCOMPLETE_CHOICES } from '@/utils/constants';

const commandName = 'list-products';

export const ListProductsCommand: SlashCommand = {
  name: commandName,
  description: 'List all products in the inventory',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('List all products in the inventory'),
  requiredPermissions: [],

  execute: async (interaction: ChatInputCommandInteraction) => {
    try {
      const guildId = interaction.guildId;
      if (!guildId) {
        throw new Error('Guild ID is required');
      }
      const products = await ProductDAL.getProductsByGuildId(guildId);
      if (products.length === 0) {
        await interaction.reply({
          embeds: [
            getGenericErrorEmbed(
              'No products found',
              'No products found in the inventory. Add some products using `/add-product` command.',
            ),
          ],
        });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle('Product List')
        .setDescription('List of added products')
        .addFields(
          products
            .map((product) => ({
              name: '',
              value:
                '```Product ID: ' +
                product._id.toString() +
                '\n' +
                'Product Name: ' +
                product.name +
                '\n' +
                'Price: ' +
                product.price +
                '\n' +
                '```',
            }))
            .slice(0, MAX_AUTOCOMPLETE_CHOICES),
        )
        .setColor('Blue');

      await interaction.reply({
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

export default ListProductsCommand;
