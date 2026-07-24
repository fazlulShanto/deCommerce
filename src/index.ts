/* eslint-disable @typescript-eslint/no-floating-promises -- Discord.js client methods return promises that don't need to be awaited */

import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  type ChatInputCommandInteraction,
  type Collection,
  type EmbedBuilder,
  type Interaction,
} from 'discord.js';
import * as dotenv from 'dotenv';
import { getCommandCollection, type SlashCommand } from './config/command-handler';
import { registerCommands } from './config/command-register';
import handleInteractionCreate from './events/interaction-create';
import { connectToDatabase } from './db/connection';
import {
  connectToRedis,
  getStoreConfigFromCache,
  loadStoreConfigsIntoCache,
  redis,
} from './utils/redis';
import type { Redis } from 'ioredis';
import { getGenericErrorEmbed, upgradeToPremiumEmbed } from './utils/genericEmbeds';
import cronJobs from './utils/cronJobs';
import { hasAccessWithCache } from './services/premium.service';
import { handleGuildCreate } from './events/guild-join';
import { handleGuildLeave } from './events/guild-leave';
import { memoryInfrastructurePreflight } from './services/qdrant-memory.service';
import { logger, flushLogger, closeLogger } from './utils/logger';
import {
  closeMemoryBackfillWorker,
  createMemoryBackfillWorker,
} from './workers/memory-backfill.worker.js';
import { closeMemoryBackfillQueue } from './queues/memory-backfill.queue';
import { getMemoryConfig } from './config/memory';
import mongoose from 'mongoose';
import type { Worker } from 'bullmq';
import type { MemoryBackfillJobData } from './queues/memory-backfill.queue';

dotenv.config();

let runningClient: Client | undefined;
let memoryBackfillWorker: Worker<MemoryBackfillJobData> | undefined;
let isShuttingDown = false;
let memoryInfrastructureAvailable = false;

// Declare module to augment Discord.js types
declare module 'discord.js' {
  export interface Client {
    globalCacheDb: Redis;
    commands: Collection<string, SlashCommand>;
    isBotAdmin: (interaction: Interaction, shouldReply?: boolean) => Promise<boolean>;
    isPremiumOrTrial: (interaction: Interaction, shouldReply?: boolean) => Promise<boolean>;
    isBotDevAdmin: (interaction: Interaction) => boolean;
  }
}

async function respondWithEphemeralEmbed(
  interaction: ChatInputCommandInteraction,
  embed: EmbedBuilder,
): Promise<void> {
  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({ embeds: [embed] });
  } else if (interaction.replied) {
    await interaction.followUp({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
  } else {
    await interaction.reply({
      embeds: [embed],
      flags: [MessageFlags.Ephemeral],
    });
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
  if (isBotAdmin) {
    return true;
  }

  if (shouldReply) {
    await respondWithEphemeralEmbed(
      interaction as ChatInputCommandInteraction,
      getGenericErrorEmbed('Failed', "You don't have permission to use this command"),
    );
  }
  return isBotAdmin;
};

const isBotDevAdmin = (interaction: Interaction) => {
  const BOT_DEV_ADMIN_IDS = process.env.BOT_DEV_ADMIN_IDS?.split(',') ?? [];
  return BOT_DEV_ADMIN_IDS.includes(interaction.user.id);
};

const isPremiumOrTrial = async (interaction: Interaction, shouldReply = true) => {
  if (!interaction.guildId || !interaction.member) {
    return false;
  }
  const hasAccess = await hasAccessWithCache(interaction.guildId);
  if (shouldReply && !hasAccess) {
    await respondWithEphemeralEmbed(
      interaction as ChatInputCommandInteraction,
      upgradeToPremiumEmbed(),
    );
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
  await connectToRedis();
  // Memory infrastructure preflight (non-fatal)
  try {
    const status = await memoryInfrastructurePreflight();
    memoryInfrastructureAvailable = status.available;
    if (status.available) {
      logger.info(
        {
          event: 'memory.infrastructure.ready',
          memoryInfrastructure: status.available,
        },
        'Memory infrastructure ready',
      );
    } else {
      logger.warn(
        {
          event: 'memory.infrastructure.unavailable',
          memoryInfrastructure: status.available,
          reason: status.reason,
        },
        `⚠️ Memory infrastructure unavailable: ${status.reason}`,
      );
    }
  } catch (error) {
    memoryInfrastructureAvailable = false;
    logger.error(
      {
        event: 'memory.infrastructure.preflight.failed',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      },
      'Memory preflight error',
    );
  }
  // Update premium status cache
  await cronJobs.refreshPremiumStatusCache();
  // Update premium status cache every 6 hours
  cronJobs.updatePremiumStatusCache();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
  });
  runningClient = client;

  client.on(Events.Error, (error) => {
    logger.error(
      {
        event: 'discord.client.error',
        errorCode:
          'code' in error && Number.isInteger(Number(error.code)) ? Number(error.code) : undefined,
        errorName: error.name,
      },
      'Discord client emitted an error',
    );
  });

  await loadStoreConfigsIntoCache();

  client.globalCacheDb = redis;
  client.isBotAdmin = isBotAdmin;
  client.isPremiumOrTrial = isPremiumOrTrial;
  client.commands = getCommandCollection();
  client.isBotDevAdmin = isBotDevAdmin;
  // await checkConnection();
  await registerCommands();

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info(
      {
        event: 'app.ready',
      },
      `✅ Logged in as ${readyClient.user.tag}!`,
    );

    readyClient.user.setPresence({
      activities: [{ name: 'with your orders', type: 2 }],
      status: 'online',
    });

    cronJobs.checkGiveaways(client);

    if (getMemoryConfig().MEMORY_FEATURE_ENABLED && memoryInfrastructureAvailable) {
      try {
        memoryBackfillWorker = createMemoryBackfillWorker(client);
        logger.info({ event: 'memory.worker.started' }, 'Memory backfill worker started');
      } catch (err) {
        logger.error({ event: 'memory.worker.start.failed', err }, 'Failed to start memory worker');
      }
    } else if (getMemoryConfig().MEMORY_FEATURE_ENABLED) {
      logger.warn(
        { event: 'memory.worker.not_started', reason: 'preflight_unavailable' },
        'Memory worker was not started because infrastructure preflight failed',
      );
    }
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteractionCreate(interaction).catch((error) => {
      logger.error(
        {
          event: 'discord.interaction.handler.failed',
          interactionType: interaction.type,
          guildId: interaction.guildId,
          errorCode:
            error &&
            typeof error === 'object' &&
            'code' in error &&
            Number.isInteger(Number(error.code))
              ? Number(error.code)
              : undefined,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
        'Discord interaction handler failed',
      );
    });
  });

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  client.on(Events.GuildCreate, handleGuildCreate);

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  client.on(Events.GuildDelete, handleGuildLeave);

  // Plan 005's live worker/retrieval lifecycle is not complete. Do not register
  // message mutation producers until a consumer can safely reconcile them.
  await client.login(BOT_TOKEN);
};

void createAndStartBot().catch(async (error) => {
  logger.fatal(
    {
      event: 'app.startup.failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    },
    'Application startup failed',
  );
  try {
    await shutdown('startup_error');
  } finally {
    process.exitCode = 1;
  }
});

async function shutdown(signal: NodeJS.Signals | 'startup_error'): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ event: 'app.shutdown.started', signal }, 'App shutdown started');
  try {
    await cronJobs.stopAll();
    await closeMemoryBackfillWorker(memoryBackfillWorker);
    await closeMemoryBackfillQueue();
    runningClient?.destroy();
    if (redis.status !== 'end') await redis.quit();
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    logger.info({ event: 'app.shutdown.completed', signal }, 'App shutdown completed');
    await flushLogger();
  } finally {
    await closeLogger();
  }
}

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
