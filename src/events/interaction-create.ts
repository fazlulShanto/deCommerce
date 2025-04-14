/* eslint-disable @typescript-eslint/no-floating-promises -- just a try catch */
import { ActionRowBuilder, StringSelectMenuBuilder, type Interaction } from 'discord.js';
import { handleModalSubmit } from '@/handlers/modal-handlers';
import { handleButtonInteractions } from '@/handlers/btn-interaction-handlers';
import { getStoreConfigFromCache } from '@/utils/redis';

const handleInteractionCreate = async (interaction: Interaction) => {
  if (!interaction.guildId || !interaction.member) {
    return;
  }

  if (interaction.isChatInputCommand()) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;
    const storeConfig = await getStoreConfigFromCache(interaction.guildId);
    try {
      const isBotAdminRequired = command.requiredPermissions.includes('BotAdmin');
      if (isBotAdminRequired) {
        const isBotAdmin = await interaction.client.isBotAdmin(interaction);
        if (!isBotAdmin) {
          return;
        }
      }
      command.execute(interaction, {
        botAdminRoleId: storeConfig?.botAdminRoleId,
        currency: storeConfig?.currency,
      });
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
    await handleModalSubmit(interaction);
    return;
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
    await handleButtonInteractions(interaction);
  }
};

export default handleInteractionCreate;
