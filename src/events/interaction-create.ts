/* eslint-disable @typescript-eslint/no-floating-promises -- just a try catch */
import { ActionRowBuilder, StringSelectMenuBuilder, type Interaction } from 'discord.js';
import {
  handleAddOrUpdateProductModal,
  handleAddPaymentMethodModal,
} from '@/handlers/modal-handlers';
import { handlePaymentMethodButton } from '@/handlers/btn-interaction-handlers';

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
    try {
      if (interaction.customId.startsWith('updateProductModal_')) {
        await handleAddOrUpdateProductModal(interaction, true);
        return;
      }

      if (interaction.customId === 'addProductModal') {
        await handleAddOrUpdateProductModal(interaction, false);
        return;
      }

      if (interaction.customId === 'addPaymentMethodModal') {
        await handleAddPaymentMethodModal(interaction);
        return;
      }

      interaction.reply({
        content: 'There was an error while submitting the modal!',
      });
    } catch (error) {
      console.error('Error handling modal submission:', error);
      interaction.reply({
        content: 'There was an error while processing your request.',
        ephemeral: true,
      });
    }
  }

  if (interaction.isStringSelectMenu()) {
    // const command = interaction.client.commands.get(interaction.customId);
    console.log('interaction.values', interaction.values, 'custom_id', interaction.customId);

    // disable the button
    const updatedComponents = interaction.message.components.map((row) => {
      const newComponents = row.components.map((component) => {
        if (component.customId === interaction.customId) {
          return StringSelectMenuBuilder.from(component as unknown as StringSelectMenuBuilder)
            .setDisabled(true)
            .setPlaceholder(interaction.values.join(', '));
        }
        return component;
      });
      return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        newComponents as StringSelectMenuBuilder[],
      );
    });

    await interaction.update({
      content: 'You selected: ' + interaction.values.join(', '),
      components: updatedComponents,
    });

    // Use the correct method to send messages
    if (interaction.channel && 'send' in interaction.channel) {
      await interaction.channel.send({
        content: 'now pay us',
      });
    }
  }
  if (interaction.isButton()) {
    await handlePaymentMethodButton(interaction);
  }
};

export default handleInteractionCreate;
