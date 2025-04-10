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

const commandName = 'create-store';

export const AddProductsCommand: SlashCommand = {
  name: commandName,
  description: 'Create a new store',
  data: new SlashCommandBuilder().setName(commandName).setDescription('Create a new store'),
  requiredPermissions: [],

  execute: async (interaction: ChatInputCommandInteraction) => {
    const modal = new ModalBuilder().setCustomId('createStoreModal').setTitle('Create New Store');

    const nameInput = new TextInputBuilder()
      .setCustomId('name')
      .setLabel('Store Name')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Store Description')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    const currencyInput = new TextInputBuilder()
      .setCustomId('currency')
      .setLabel('Currency')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter currency (e.g., BDT, USD)')
      .setRequired(true);

    const nameRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(nameInput);
    const descriptionRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      descriptionInput,
    );
    const currencyRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      currencyInput,
    );

    modal.addComponents(nameRow, descriptionRow, currencyRow);

    await interaction.showModal(modal);
  },
};

export default AddProductsCommand;
