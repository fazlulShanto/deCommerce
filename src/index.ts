/* eslint-disable @typescript-eslint/no-floating-promises -- Discord.js client methods return promises that don't need to be awaited */

import type { ChatInputCommandInteraction, Interaction } from 'discord.js';
import { Client, Events, GatewayIntentBits, type Collection } from 'discord.js';
import * as dotenv from 'dotenv';
import { getCommandCollection, type SlashCommand } from './config/command-handler';
import { registerCommands } from './config/command-register';
import handleInteractionCreate from './events/interaction-create';
import { connectToDatabase } from './db/connection';
import { getStoreConfigFromCache, loadStoreConfigsIntoCache, redis } from './utils/redis';
import type { Redis } from 'ioredis';
import { getGenericErrorEmbed } from './utils/genericEmbeds';
import cronJobs from './utils/cronJobs';
import { updatePremiumStatusCache, hasAccessWithCache } from './services/premium.service';

dotenv.config();

// Declare module to augment Discord.js types
declare module 'discord.js' {
  export interface Client {
    globalCacheDb: Redis;
    commands: Collection<string, SlashCommand>;
    isBotAdmin: (interaction: Interaction, shouldReply?: boolean) => Promise<boolean>;
    isPremiumOrTrial: (interaction: Interaction) => Promise<boolean>;
  }
}

const isBotAdmin = async (interaction: Interaction, shouldReply = true) => {
  if (!interaction.guildId || !interaction.member) {
    return false;
  }
  const storeConfig = await getStoreConfigFromCache(interaction.guildId);

  const userRoleIds =
    interaction.member.roles instanceof Array
      ? interaction.member.roles
      : Array.from(interaction.member.roles.cache.keys());
  const isBotAdmin = userRoleIds.includes(storeConfig?.botAdminRoleId);

  if (shouldReply) {
    await (interaction as ChatInputCommandInteraction).reply({
      embeds: [getGenericErrorEmbed('Failed', "You don't have permission to use this command")],
    });
  }
  return isBotAdmin;
};

const isPremiumOrTrial = async (interaction: Interaction, shouldReply = true) => {
  if (!interaction.guildId || !interaction.member) {
    return false;
  }
  const hasAccess = await hasAccessWithCache(interaction.guildId);
  if (shouldReply && !hasAccess) {
    await (interaction as ChatInputCommandInteraction).reply({
      embeds: [
        getGenericErrorEmbed(
          'Failed',
          'This command is only available to premium or trial subscribers',
          [
            {
              name: 'Check your premium status',
              value: '`/premium`',
              inline: true,
            },
            {
              name: 'Join our support server',
              value: '`https://discord.gg/sTG9X4VJ9x`',
              inline: true,
            },
          ],
        ),
      ],
    });
  }
  return hasAccess;
};

const createAndStartBot = async () => {
  console.clear();

  const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
  if (!BOT_TOKEN) {
    throw new Error('DISCORD_BOT_TOKEN is not set');
  }

  // Connect to MongoDB first
  await connectToDatabase();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  await loadStoreConfigsIntoCache();

  client.globalCacheDb = redis;
  client.isBotAdmin = isBotAdmin;
  client.isPremiumOrTrial = isPremiumOrTrial;
  client.commands = getCommandCollection();
  // await checkConnection();
  await registerCommands();

  client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user?.tag}!`);
  });

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  client.on(Events.InteractionCreate, handleInteractionCreate);

  client.login(BOT_TOKEN);
};
updatePremiumStatusCache();

cronJobs.updatePremiumStatusCache();

createAndStartBot();
