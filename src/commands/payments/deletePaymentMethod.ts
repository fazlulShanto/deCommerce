import type { AutocompleteInteraction } from 'discord.js';
import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommand } from '../../config/command-handler';
import { getGenericErrorEmbed } from '@/utils/genericEmbeds';
import { MAX_AUTOCOMPLETE_CHOICES } from '@/utils/constants';
import { PaymentMethodDAL } from '@/db/payment-method.dal';

const commandName = 'delete-payment-method';

export const DeletePaymentMethodCommand: SlashCommand = {
  name: commandName,
  description: 'Delete a payment method',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Delete a payment method')
    .addStringOption((option) =>
      option
        .setName('payment-method-name')
        .setDescription('The name of the product to delete')
        .setAutocomplete(true)
        .setRequired(true),
    ) as SlashCommandBuilder,
  autocomplete: async (interaction: AutocompleteInteraction) => {
    const focusedValue = interaction.options.getFocused().toLowerCase();
    const guildId = interaction.guildId;
    const paymentMethodList = await PaymentMethodDAL.getPaymentMethodsByGuildId(guildId + '');
    if (!paymentMethodList) {
      throw new Error('No payment methods found');
    }
    const filteredPaymentMethods = paymentMethodList
      .filter((paymentMethod) => paymentMethod.name.toLowerCase().includes(focusedValue))
      .map((product) => ({
        name: product.name,
        value: product.name, // or product._id if you prefer to use IDs
      }))
      .slice(0, MAX_AUTOCOMPLETE_CHOICES);

    await interaction.respond(filteredPaymentMethods);
  },

  requiredPermissions: ['BotAdmin', 'GuildOnly'],

  execute: async (interaction: ChatInputCommandInteraction) => {
    try {
      await interaction.deferReply();
      const guildId = interaction.guildId;
      const paymentMethodName = interaction.options.getString('payment-method-name');
      if (!guildId) {
        throw new Error('Guild ID is required');
      }
      const paymentList = await PaymentMethodDAL.getPaymentMethodsByGuildId(guildId);
      const selectedPayment = paymentList.find((p) => p.name === paymentMethodName);

      if (!selectedPayment) {
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

      const deletedPaymentMethod = await PaymentMethodDAL.deleteSinglePaymentMethod(
        selectedPayment._id.toString(),
        guildId,
      );
      if (!deletedPaymentMethod) {
        throw new Error('Failed to delete product');
      }

      const embed = new EmbedBuilder()
        .setTitle('Deleted Payment Method: ' + deletedPaymentMethod.name)
        .setDescription('Deleted Product details')
        .addFields([
          {
            name: 'Payment method ID: ' + deletedPaymentMethod._id.toString(),
            value: '```' + 'Pyament method Name: ' + deletedPaymentMethod.name + '```',
          },
        ])
        .setColor('Red');

      await interaction.followUp({
        embeds: [embed],
      });
    } catch (error) {
      console.error('Error fetching payment methods:', error);
      await interaction.reply({
        content: 'There was an error while fetching the payment methods!',
        ephemeral: true,
      });
    }
  },
};
