/* eslint-disable @typescript-eslint/no-floating-promises -- Discord.js client methods return promises that don't need to be awaited */

import { Client, Events, GatewayIntentBits, type Collection } from 'discord.js';
import * as dotenv from 'dotenv';
import { getCommandCollection, type SlashCommand } from './config/command-handler';
import { registerCommands } from './config/command-register';
import handleInteractionCreate from './events/interaction-create';
import { connectToDatabase } from './db/connection';

dotenv.config();

// Declare module to augment Discord.js types
declare module 'discord.js' {
  export interface Client {
    // globalCacheDb: Redis;
    commands: Collection<string, SlashCommand>;
  }
}

const createAndStartBot = async () => {
  console.clear();
  // const redisUrl = process.env.REDIS_URL;
  // const globalCacheDb = CreateRedisClient(redisUrl);
  const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
  if (!BOT_TOKEN) {
    throw new Error('DISCORD_BOT_TOKEN is not set');
  }

  // Connect to MongoDB first
  await connectToDatabase();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.commands = getCommandCollection();
  // client.globalCacheDb = globalCacheDb;
  // await checkConnection();
  await registerCommands();

  client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user?.tag}!`);
  });

  client.on(Events.InteractionCreate, handleInteractionCreate);

  client.login(BOT_TOKEN);
};

createAndStartBot();
