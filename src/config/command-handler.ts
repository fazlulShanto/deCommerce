import {
  Collection,
  type ChatInputCommandInteraction,
  type SlashCommandBuilder,
  type AutocompleteInteraction,
} from 'discord.js';
import { botCommands } from '../commands';

export const CommandPermissions = {
  Administrator: 'Administrator',
  ManageGuild: 'ManageGuild',
  ManageRoles: 'ManageRoles',
  ManageChannels: 'ManageChannels',
  CommandUser: 'CommandUser',
  BotAdmin: 'BotAdmin',
  GuildOnly: 'GuildOnly',
  DMOnly: 'DMOnly',
  PremiumOnly: 'PremiumOnly',
  TrialOnly: 'TrialOnly',
  PremiumOrTrial: 'PremiumOrTrial',
  FreeOnly: 'FreeOnly',
} as const;

export type AdditionalCommandInfo = {
  botAdminRoleId?: string;
  currency?: string;
};

export interface SlashCommand {
  name: string;
  description: string;
  data: SlashCommandBuilder;
  requiredPermissions: (typeof CommandPermissions)[keyof typeof CommandPermissions][];
  execute: (
    interaction: ChatInputCommandInteraction,
    additionalInfo?: AdditionalCommandInfo,
  ) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, SlashCommand>;
  }
}
export const rawBotCommands = botCommands;

export const getCommandCollection = () => {
  const commands = new Collection<string, SlashCommand>();
  for (const command of rawBotCommands) {
    commands.set(command.name, command);
  }
  return commands;
};
