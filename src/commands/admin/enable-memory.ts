import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { SlashCommand } from '@/config/command-handler';
import { BACKFILL_VERSION, getOrCreateRun, updateRun } from '@/db/memoryBackfill.dal';
import { getMemoryConfig } from '@/config/memory';
import { enqueueInitialBackfill, getMemoryBackfillJobId } from '@/queues/memory-backfill.queue';
import { beginMemoryEnable, rollbackFirstMemoryEnable } from '@/services/agent-config.service';
import { memoryInfrastructurePreflight } from '@/services/qdrant-memory.service';
import { logger } from '@/utils/logger';

const commandName = 'enable-memory';
const commandDescription = 'Enable memory for this server';

export interface EnableMemoryDependencies {
  now(): Date;
  preflight: typeof memoryInfrastructurePreflight;
  beginEnable: typeof beginMemoryEnable;
  rollbackEnable: typeof rollbackFirstMemoryEnable;
  createRun: typeof getOrCreateRun;
  enqueue: typeof enqueueInitialBackfill;
  updateRun: typeof updateRun;
}

const defaultDependencies: EnableMemoryDependencies = {
  now: () => new Date(),
  preflight: memoryInfrastructurePreflight,
  beginEnable: beginMemoryEnable,
  rollbackEnable: rollbackFirstMemoryEnable,
  createRun: getOrCreateRun,
  enqueue: enqueueInitialBackfill,
  updateRun,
};

export type EnableMemoryOutcome =
  | { kind: 'unavailable'; reason: string }
  | { kind: 'already_enabled'; state: string }
  | { kind: 're_enabled' }
  | { kind: 'conflict'; state: string }
  | { kind: 'queued'; jobId: string }
  | { kind: 'queue_failed' };

export async function enableGuildMemory(
  guildId: string,
  dependencies: EnableMemoryDependencies = defaultDependencies,
): Promise<EnableMemoryOutcome> {
  const preflight = await dependencies.preflight();
  if (!preflight.available) {
    return {
      kind: 'unavailable',
      reason: preflight.reason ?? 'MEMORY_INFRASTRUCTURE_UNAVAILABLE',
    };
  }

  const transition = await dependencies.beginEnable(guildId, dependencies.now());
  if (transition.kind === 'already_enabled') {
    return {
      kind: 'already_enabled',
      state: transition.config.memoryState,
    };
  }
  if (transition.kind === 'conflict') {
    return { kind: 'conflict', state: transition.config.memoryState };
  }
  if (transition.kind === 're_enabled') {
    return { kind: 're_enabled' };
  }

  const config = getMemoryConfig();
  const generation = transition.config.memoryGeneration;
  const enabledAtValue = transition.config.memoryEnabledAt;
  const enabledAt =
    enabledAtValue instanceof Date
      ? enabledAtValue
      : new Date(enabledAtValue ?? dependencies.now());
  const jobId = getMemoryBackfillJobId(guildId, generation, BACKFILL_VERSION);
  let activationStage: 'checkpoint' | 'queue' = 'checkpoint';
  try {
    const run = await dependencies.createRun({
      guildId,
      generation,
      version: BACKFILL_VERSION,
      jobId,
      enabledAt,
      cutoffAt: new Date(
        enabledAt.getTime() - config.MEMORY_BACKFILL_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
      ),
      maxScannedMessagesPerChannel: config.MEMORY_BACKFILL_MAX_MESSAGES_PER_CHANNEL,
    });
    activationStage = 'queue';
    await dependencies.enqueue(guildId, generation, BACKFILL_VERSION);
    return { kind: 'queued', jobId: run.jobId };
  } catch (error) {
    const errorCode = activationStage === 'queue' ? 'queue_unavailable' : 'checkpoint_unavailable';
    const [rollbackResult, runUpdateResult] = await Promise.allSettled([
      dependencies.rollbackEnable(guildId, generation, errorCode),
      dependencies.updateRun(
        { guildId, generation, version: BACKFILL_VERSION },
        { status: 'failed', lastErrorCode: errorCode },
      ),
    ]);
    logger.error(
      {
        event: 'memory.enable.activation.failed',
        guildId,
        generation,
        activationStage,
        errorCode,
        rollbackSucceeded: rollbackResult.status === 'fulfilled' && rollbackResult.value,
        runUpdateSucceeded: runUpdateResult.status === 'fulfilled',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      },
      'Memory activation failed',
    );
    return { kind: 'queue_failed' };
  }
}

export async function handleEnableMemory(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  }

  const config = getMemoryConfig();
  if (!config.MEMORY_FEATURE_ENABLED) {
    await interaction.editReply('Memory is disabled by deployment configuration.');
    return;
  }

  if (!interaction.guildId) {
    await interaction.editReply('This command can only be used in a server.');
    return;
  }

  try {
    const outcome = await enableGuildMemory(interaction.guildId);
    switch (outcome.kind) {
      case 'unavailable':
        await interaction.editReply(`Memory infrastructure is unavailable (${outcome.reason}).`);
        return;
      case 'already_enabled':
        await interaction.editReply(
          `Memory is already enabled (state: ${outcome.state}). Use /memory-status for progress.`,
        );
        return;
      case 're_enabled':
        await interaction.editReply(
          'Memory was re-enabled. Historical backfill will not be repeated.',
        );
        return;
      case 'conflict':
        await interaction.editReply(
          `Memory cannot be enabled while state is ${outcome.state}. Use /memory-status for details.`,
        );
        return;
      case 'queue_failed':
        await interaction.editReply(
          'Memory could not be queued. The enablement was rolled back; please retry.',
        );
        return;
      case 'queued':
        await interaction.editReply(
          `Memory enabled and initial backfill queued (${outcome.jobId}). Use /memory-status for progress.`,
        );
    }
  } catch (error) {
    logger.error(
      {
        event: 'memory.enable.failed',
        guildId: interaction.guildId,
        err: error,
      },
      'Memory enable failed',
    );
    await interaction.editReply(
      'Memory could not be enabled. The failure was logged without message content.',
    );
  }
}

const EnableMemoryCommand: SlashCommand = {
  name: commandName,
  description: commandDescription,
  data: new SlashCommandBuilder().setName(commandName).setDescription(commandDescription),
  isGuildOnly: true,
  deferBeforePermissionChecks: true,
  requiredPermissions: ['GuildOnly', 'PremiumOrTrial'],
  execute: handleEnableMemory,
};

export default EnableMemoryCommand;
