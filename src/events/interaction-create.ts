/* eslint-disable @typescript-eslint/no-floating-promises -- just a try catch */
import type { Interaction } from 'discord.js';
import { handleAddOrUpdateProductModal } from '@/handlers/modal-handlers';

const handleInteractionCreate = async (interaction: Interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      command.execute(interaction);
    } catch (error) {
      console.error(error);
      interaction.reply({
        content: 'There was an error while executing this command!',
        ephemeral: true,
      });
    }
  }

  if (interaction.isAutocomplete()) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command?.autocomplete) return;
    try {
      if (typeof command?.autocomplete === 'function') {
        await command.autocomplete(interaction);
      }
      return;
    } catch (error) {
      console.error('Error handling autocomplete:', error);
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('updateProductModal_')) {
      await handleAddOrUpdateProductModal(interaction, true);
      return;
    }

    if (interaction.customId === 'addProductModal') {
      await handleAddOrUpdateProductModal(interaction, false);
      return;
    }

    interaction.reply({
      content: 'There was an error while submitting the modal!',
    });
  }

  if (interaction.isStringSelectMenu()) {
    // const command = interaction.client.commands.get(interaction.customId);
    console.log('interaction.values', interaction.values, 'custom_id', interaction.customId);
    // if (!command) return;
    // try {
    //   command.execute(interaction as unknown as ChatInputCommandInteraction);
    // } catch (error) {
    // console.error(error);
    interaction.reply({
      content: 'You selected: ' + interaction.values.join(', '),
      //   ephemeral: true,
    });
    // }
  }
};

export default handleInteractionCreate;
