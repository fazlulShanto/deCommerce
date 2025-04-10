import type { AutocompleteInteraction } from 'discord.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { SlashCommand } from '../../config/command-handler';
import { ProductDAL } from '@/db/product.dal';
import { getGenericErrorEmbed } from '@/utils/genericEmbeds';
import { MAX_AUTOCOMPLETE_CHOICES } from '@/utils/constants';

const commandName = 'buy';

export const BuyCommand: SlashCommand = {
  name: commandName,
  description: 'Buy a product',
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
      .filter((product) => product.isAvailable)
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
          embeds: [getGenericErrorEmbed('No product found', 'Please provide a valid product ID.')],
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
      if (!product.isAvailable) {
        await interaction.followUp({
          embeds: [getGenericErrorEmbed('Product not available', 'The product is not available.')],
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('Select Payment Method')
        .setDescription('Please select the payment method you would like to use.')
        .setColor('Blue');

      const confirm = new ButtonBuilder()
        .setCustomId('confirm')
        .setLabel('Confirm Ban')
        .setStyle(ButtonStyle.Danger);

      const cancel = new ButtonBuilder()
        .setCustomId('cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(cancel, confirm);

      await interaction.followUp({
        embeds: [embed],
        components: [row],
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

export default BuyCommand;
