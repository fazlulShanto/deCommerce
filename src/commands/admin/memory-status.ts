import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { SlashCommand } from '@/config/command-handler';
import { BACKFILL_VERSION, findRun } from '@/db/memoryBackfill.dal';
import { getInitialBackfillJob } from '@/queues/memory-backfill.queue';
import { getNormalizedAgentConfig } from '@/services/agent-config.service';
import { logger } from '@/utils/logger';

const commandName = 'memory-status';
const commandDescription = 'Check memory and backfill status';

function displayDate(value: Date | string | null | undefined): string {
  if (!value) return 'Not available';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Not available'
    : `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

function displayDuration(
  startedAt: Date | string | null | undefined,
  completedAt: Date | string | null | undefined,
): string {
  if (!startedAt) return 'Not started';
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return 'Unavailable';
  }
  const seconds = Math.floor((end - start) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m ${seconds % 60}s`;
}

export async function handleMemoryStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
  }

  if (!interaction.guildId) {
    await interaction.editReply('This command can only be used in a server.');
    return;
  }

  try {
    const config = await getNormalizedAgentConfig(interaction.guildId);
    const run = await findRun(interaction.guildId, config.memoryGeneration, BACKFILL_VERSION);

    let queueState = 'Not queued';
    if (run) {
      try {
        queueState =
          (await (
            await getInitialBackfillJob(
              interaction.guildId,
              config.memoryGeneration,
              BACKFILL_VERSION,
            )
          )?.getState()) ?? 'Missing';
      } catch {
        queueState = 'Unavailable';
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('Memory Status')
      .setColor(config.memoryEnabled ? 0x2ecc71 : 0xe74c3c)
      .addFields(
        { name: 'Enabled', value: config.memoryEnabled ? 'Yes' : 'No', inline: true },
        { name: 'State', value: config.memoryState, inline: true },
        {
          name: 'Generation',
          value: String(config.memoryGeneration),
          inline: true,
        },
        {
          name: 'Backfill Version',
          value: String(config.initialBackfillVersion),
          inline: true,
        },
        {
          name: 'Run',
          value: run?.status ?? 'Not started',
          inline: true,
        },
        { name: 'Queue', value: queueState, inline: true },
        {
          name: 'Channels',
          value: run
            ? `${run.completedChannelCount}/${run.discoveredChannelCount} completed · ${run.skippedChannelCount} skipped · ${run.failedChannelCount} failed`
            : '0/0',
        },
        {
          name: 'Messages',
          value: run
            ? `${run.scannedCount} scanned · ${run.eligibleMessageCount} eligible`
            : '0 scanned · 0 eligible',
        },
        {
          name: 'Indexed Chunks',
          value: String(run?.indexedChunkCount ?? 0),
          inline: true,
        },
        {
          name: 'Last Heartbeat',
          value: displayDate(run?.lastHeartbeatAt),
          inline: true,
        },
        {
          name: 'Elapsed',
          value: displayDuration(run?.startedAt, run?.completedAt),
          inline: true,
        },
        {
          name: 'Remaining Upper Bound',
          value: run
            ? `≤ ${
                Math.max(
                  0,
                  run.discoveredChannelCount -
                    run.completedChannelCount -
                    run.skippedChannelCount -
                    run.failedChannelCount,
                ) * run.maxScannedMessagesPerChannel
              } messages · ETA unavailable`
            : '0 messages · ETA unavailable',
        },
        {
          name: 'Error',
          value: run?.lastErrorCode ?? config.memoryLastErrorCode ?? 'None',
        },
      );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error(
      {
        event: 'memory.status.failed',
        guildId: interaction.guildId,
        err: error,
      },
      'Memory status failed',
    );
    await interaction.editReply('Failed to retrieve memory status.');
  }
}

const MemoryStatusCommand: SlashCommand = {
  name: commandName,
  description: commandDescription,
  data: new SlashCommandBuilder().setName(commandName).setDescription(commandDescription),
  isGuildOnly: true,
  deferBeforePermissionChecks: true,
  requiredPermissions: ['GuildOnly'],
  execute: handleMemoryStatus,
};

export default MemoryStatusCommand;
