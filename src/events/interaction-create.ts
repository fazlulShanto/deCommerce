/* eslint-disable @typescript-eslint/no-floating-promises -- just a try catch */
import {
  ActionRowBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type Interaction,
} from 'discord.js';
import { handleModalSubmit } from '@/handlers/modal-handlers';
import { handleButtonInteractions } from '@/handlers/btn-interaction-handlers';
import { getStoreConfigFromCache } from '@/utils/redis';
import { logger } from '@/utils/logger';

function discordErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }
  const code = Number(error.code);
  return Number.isInteger(code) ? code : undefined;
}

async function safelyReportCommandError(
  interaction: ChatInputCommandInteraction,
  error: unknown,
): Promise<void> {
  const errorCode = discordErrorCode(error);
  if (errorCode === 10062) {
    logger.warn(
      {
        event: 'discord.interaction.expired',
        commandName: interaction.commandName,
        guildId: interaction.guildId,
        errorCode,
      },
      'Discord interaction expired before it could be acknowledged',
    );
    return;
  }

  const response = {
    content: 'There was an error while executing this command!',
  };
  try {
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply(response);
    } else if (interaction.replied) {
      await interaction.followUp({
        ...response,
        flags: [MessageFlags.Ephemeral],
      });
    } else {
      await interaction.reply({
        ...response,
        flags: [MessageFlags.Ephemeral],
      });
    }
  } catch (responseError) {
    logger.error(
      {
        event: 'discord.command.error_response.failed',
        commandName: interaction.commandName,
        guildId: interaction.guildId,
        errorCode: discordErrorCode(responseError),
        errorName: responseError instanceof Error ? responseError.name : 'UnknownError',
      },
      'Discord command error response failed',
    );
  }
}

const handleInteractionCreate = async (interaction: Interaction) => {
  if (!interaction.guildId || !interaction.member) {
    return;
  }

  if (interaction.isChatInputCommand()) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      if (command.deferBeforePermissionChecks && !interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      }

      const isBotAdminRequired = command.requiredPermissions.includes('BotAdmin');
      const isPremiumOrTrialRequired = command.requiredPermissions.includes('PremiumOrTrial');

      if (isBotAdminRequired) {
        const isBotAdmin = await interaction.client.isBotAdmin(interaction);
        if (!isBotAdmin) {
          return;
        }
      }

      if (isPremiumOrTrialRequired) {
        const hasPremiumOrTrial = await interaction.client.isPremiumOrTrial(interaction);
        if (!hasPremiumOrTrial) {
          return;
        }
      }
      const storeConfig = await getStoreConfigFromCache(interaction.guildId);
      await command.execute(interaction, {
        botAdminRoleId: storeConfig?.botAdminRoleId,
        currency: storeConfig?.currency,
      });
    } catch (error) {
      if (discordErrorCode(error) !== 10062) {
        logger.error(
          {
            event: 'discord.command.execution.failed',
            commandName: interaction.commandName,
            guildId: interaction.guildId,
            errorCode: discordErrorCode(error),
            errorName: error instanceof Error ? error.name : 'UnknownError',
          },
          'Discord command execution failed',
        );
      }
      await safelyReportCommandError(interaction, error);
    }
    return;
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
      logger.error(
        {
          event: 'discord.autocomplete.failed',
          commandName: interaction.commandName,
          guildId: interaction.guildId,
          err: error,
        },
        'Discord autocomplete failed',
      );
    }
  }

  if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction);
    return;
  }

  if (interaction.isStringSelectMenu()) {
    // const command = interaction.client.commands.get(interaction.customId);
    // disable the button
    const updatedComponents = interaction.message.components.flatMap((row) => {
      if (!('components' in row)) return [];
      const newComponents = row.components.map((component) => {
        if ('customId' in component && component.customId === interaction.customId) {
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
