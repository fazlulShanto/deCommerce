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
import { getGenericErrorEmbed, getGenericSuccessEmbed } from '@/utils/genericEmbeds';
import { BOT_COMMAND_BUTTON_IDS, MAX_AUTOCOMPLETE_CHOICES } from '@/utils/constants';
import { PaymentMethodDAL } from '@/db/payment-method.dal';

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
      const paymentMethods = await PaymentMethodDAL.getPaymentMethodsByGuildId(
        interaction.guildId + '',
      );
      if (!paymentMethods || !Array.isArray(paymentMethods) || paymentMethods.length === 0) {
        await interaction.followUp({
          embeds: [
            getGenericSuccessEmbed(
              'Payment Method',
              'Please contact the server owner to  about the payment method.',
            ),
          ],
        });
        return;
      }
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
        .setDescription(
          'Please select the payment method you would like to use to buy the product.',
        )
        .addFields([
          {
            name: 'Product Name',
            value: '```' + product.name + '```',
          },
          {
            name: 'Product Price',
            value: '```elm\n' + product.price.toString() + '\n```',
          },
        ])
        .setTimestamp()
        .setColor('Blue');

      const paymentMethodsButtons = paymentMethods.map((paymentMethod) => {
        return new ButtonBuilder()
          .setCustomId(
            [
              BOT_COMMAND_BUTTON_IDS.PAYMENT_METHOD,
              product._id.toString(),
              paymentMethod._id.toString(),
              interaction.user.id,
            ].join('_'),
          )
          .setLabel(paymentMethod.name)
          .setStyle(ButtonStyle.Primary);
      });

      const paymentMethodsButtonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...paymentMethodsButtons,
      );

      await interaction.followUp({
        embeds: [embed],
        components: [paymentMethodsButtonRow],
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
