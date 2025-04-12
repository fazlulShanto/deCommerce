import type { AutocompleteInteraction } from 'discord.js';
import {
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} from 'discord.js';
import { PaymentMethodDAL } from '../../db/payment-method.dal';
import type { SlashCommand } from '../../config/command-handler';
import { getGenericErrorEmbed } from '@/utils/genericEmbeds';
import { MAX_AUTOCOMPLETE_CHOICES } from '@/utils/constants';
import { format } from 'date-fns';

const commandName = 'payment-method-details';

export const PaymentMethodDetailsCommand: SlashCommand = {
  name: commandName,
  description: 'Get details of a payment method',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Get details of a payment method')
    .addStringOption((option) =>
      option
        .setName('payment-method-name')
        .setDescription('The name of the payment method to get details of')
        .setAutocomplete(true)
        .setRequired(true),
    ) as SlashCommandBuilder,

  requiredPermissions: [],

  autocomplete: async (interaction: AutocompleteInteraction) => {
    try {
      const focusedValue = interaction.options.getFocused().toLowerCase();
      const guildId = interaction.guildId;

      if (!guildId) {
        await interaction.respond([]);
        return;
      }

      const paymentMethods = await PaymentMethodDAL.getPaymentMethodsByGuildId(guildId + '');
      const filteredMethods = paymentMethods.filter((method) =>
        method.name.toLowerCase().includes(focusedValue),
      );

      const choices = filteredMethods
        .map((method) => ({
          name: method.name,
          value: method._id.toString(),
        }))
        .slice(0, MAX_AUTOCOMPLETE_CHOICES);

      await interaction.respond(choices);
    } catch (error) {
      console.error('Error in autocomplete:', error);
      // If we haven't responded yet, send an empty response
      if (!interaction.responded) {
        await interaction.respond([]);
      }
    }
  },

  execute: async (interaction: ChatInputCommandInteraction) => {
    try {
      await interaction.deferReply();

      const paymentMethodId = interaction.options.getString('payment-method-name', true);
      const guildId = interaction.guildId;

      if (!guildId) {
        await interaction.editReply({
          embeds: [
            getGenericErrorEmbed('Guild not found', 'This command can only be used in a server.'),
          ],
        });
        return;
      }

      const paymentMethod = await PaymentMethodDAL.getPaymentMethodById(paymentMethodId);

      if (!paymentMethod) {
        await interaction.editReply({
          embeds: [
            getGenericErrorEmbed(
              'Payment method not found',
              'The selected payment method no longer exists.',
            ),
          ],
        });
        return;
      }

      const isInvalidNumber = Number.isNaN(Number(paymentMethod?.phoneNumber));

      const embed = new EmbedBuilder()
        .setTitle('Payment Method Details: ' + paymentMethod.name)
        .addFields(
          {
            name: 'Name',
            value: (paymentMethod?.emoji || ' ') + paymentMethod.name,
          },
          {
            name: 'Phone Number',
            value: isInvalidNumber
              ? 'Invalid phone number'
              : '```' + paymentMethod?.phoneNumber + '```',
          },
          {
            name: 'Added At',
            value: format(paymentMethod.createdAt, 'do MMMM yyyy, HH:mm:ss'),
          },
        )
        .setColor('Blue');

      if (paymentMethod?.qrCodeImage?.startsWith('https://')) {
        embed.setImage(paymentMethod.qrCodeImage);
      }

      const copyPhoneNumberButton = new ButtonBuilder()
        .setCustomId('copyPhoneNumber_' + paymentMethod?.phoneNumber)
        .setLabel('Copy Phone Number')
        .setStyle(ButtonStyle.Primary);

      await interaction.editReply({
        embeds: [embed],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(copyPhoneNumberButton)],
      });
      return;
    } catch (error) {
      console.error('Error fetching payment method:', error);
      await interaction.editReply({
        content: 'There was an error while fetching the payment method!',
      });
    }
  },
};

export default PaymentMethodDetailsCommand;
