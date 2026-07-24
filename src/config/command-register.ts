/* eslint-disable @typescript-eslint/no-non-null-assertion -- we know the env is set */
import { REST, Routes } from 'discord.js';
import { logger } from '@/utils/logger';
import { rawBotCommands, type SlashCommand } from './command-handler';

export async function registerCommands(): Promise<void> {
  const shouldRegisterCommands = process.env.DISCORD_SHOULD_REGISTER_COMMANDS;

  if (shouldRegisterCommands === 'false') {
    return;
  }

  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN!);
  try {
    logger.info(
      {
        event: 'discord.commands.registration.started',
        commandCount: rawBotCommands.length,
      },
      `Started refreshing ${rawBotCommands.length} application (/) commands.`,
    );

    const commandsJson = rawBotCommands.map((command) => command.data.toJSON());

    // The put method is used to fully refresh all commands in the guild with the current set
    const data = (await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!), {
      body: commandsJson,
    })) as SlashCommand[];

    logger.info(
      {
        event: 'discord.commands.registration.completed',
        commandCount: data.length,
      },
      `Successfully reloaded ${data.length} slash(/) commands.`,
    );
  } catch (error) {
    // And of course, make sure you catch and log any errors!
    logger.error({
      event: 'discord.commands.registration.failed',
      err: error as Error,
    }, 'Failed to register commands');
  }
}
