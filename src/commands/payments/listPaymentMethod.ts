import { SlashCommandBuilder, type ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import type { SlashCommand } from '../../config/command-handler';
import { PaymentMethodDAL } from '@/db/payment-method.dal';
import { MAX_EMBED_FIELDS } from '@/utils/constants';
import { getGenericErrorEmbed } from '@/utils/genericEmbeds';

const commandName = 'list-payment-method';

export const ListPaymentMethodsCommand: SlashCommand = {
  name: commandName,
  description: 'List available payment methods',
  data: new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('List available payment methods'),
  requiredPermissions: ['GuildOnly'],

  execute: async (interaction: ChatInputCommandInteraction) => {
    try {
      const availablePaymentMethods = (
        (await PaymentMethodDAL.getPaymentMethodsByGuildId(interaction.guildId || '')) || []
      ).slice(0, MAX_EMBED_FIELDS);

      if (availablePaymentMethods.length === 0) {
        await interaction.reply('No payment methods available.');
        return;
      }

      // send embeds
      const paymentMethodListEmbed = new EmbedBuilder()
        .setTitle('Available Payment Methods')
        .setDescription('Here are the available payment methods:')
        .setTimestamp()
        .addFields(
          availablePaymentMethods.map((paymentMethod, index) => ({
            name: `Payment Method ${index + 1}:  ` + '```' + paymentMethod.name + '```',
            value:
              '\n**Phone Number:** ' +
              '```json\n' +
              paymentMethod.phoneNumber +
              '```' +
              '\n**QR Code Link:** ' +
              `\u200b [Click here](${paymentMethod?.qrCodeImage || 'None'})` +
              '\n' +
              '-'.repeat(30),
          })),
        )
        .setColor('Green');

      await interaction.reply({ content: 'list of message', embeds: [paymentMethodListEmbed] });
    } catch {
      await interaction.reply({
        embeds: [
          getGenericErrorEmbed(
            'Error listing payment methods',
            'An error occurred while listing payment methods.',
          ),
        ],
      });
    }
  },
};

export default ListPaymentMethodsCommand;
