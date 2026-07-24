/* eslint-disable @typescript-eslint/no-misused-promises */
import { checkGiveaways } from '@/services/giveaway.service';
import { updatePremiumStatusCache } from '@/services/premium.service';
import type { Client } from 'discord.js';
import cron from 'node-cron';
import { logger } from './logger';

const scheduledTasks = new Set<cron.ScheduledTask>();
const activeExecutions = new Set<Promise<void>>();
let isStopping = false;

function track(task: cron.ScheduledTask): void {
  if (isStopping) {
    task.stop();
    return;
  }

  scheduledTasks.add(task);
}

function trackExecution(execution: () => Promise<void>): Promise<void> {
  if (isStopping) {
    return Promise.resolve();
  }

  const executionPromise = execution();
  activeExecutions.add(executionPromise);

  return executionPromise.finally(() => {
    activeExecutions.delete(executionPromise);
  });
}

async function refreshPremiumStatusCache(): Promise<void> {
  try {
    await updatePremiumStatusCache();
    logger.info(
      {
        event: 'premium.cache.refresh.completed',
        guildId: undefined, // since cron is server wide
      },
      'Premium cache updated successfully',
    );
  } catch (error) {
    logger.error(
      {
        event: 'premium.cache.refresh.failed',
        err: error as Error,
      },
      'Error updating premium cache',
    );
  }
}

const cronJobs = {
  refreshPremiumStatusCache: (): Promise<void> => trackExecution(refreshPremiumStatusCache),
  updatePremiumStatusCache: () => {
    track(
      cron.schedule('0 */6 * * *', (): Promise<void> => trackExecution(refreshPremiumStatusCache)),
    );
  },
  checkGiveaways: (client: Client) => {
    track(
      cron.schedule(
        '* * * * *',
        (): Promise<void> =>
          trackExecution(async () => {
            try {
              await checkGiveaways(client);
            } catch (error) {
              logger.error(
                {
                  event: 'giveaway.scheduler.failed',
                  err: error as Error,
                },
                'Error checking giveaways',
              );
            }
          }),
      ),
    );
  },
  stopAll: async (): Promise<void> => {
    isStopping = true;
    scheduledTasks.forEach((task) => task.stop());
    scheduledTasks.clear();

    await Promise.allSettled(Array.from(activeExecutions));
  },
};

export default cronJobs;
