/* eslint-disable @typescript-eslint/no-misused-promises */
import { checkGiveaways } from '@/services/giveaway.service';
import { updatePremiumStatusCache } from '@/services/premium.service';
import type { Client } from 'discord.js';
import cron from 'node-cron';
import { logger } from './logger';

// Run every hour
const cronJobs = {
  updatePremiumStatusCache: () => {
    cron.schedule('0 */6 * * *', async (): Promise<void> => {
      try {
        await updatePremiumStatusCache();
        await logger.info('Premium cache updated successfully' + '@' + new Date().toISOString());
      } catch (error) {
        await logger.error('Error updating premium cache', error as Error);
      }
    });
  },
  checkGiveaways: (client: Client) => {
    cron.schedule('* * * * *', async (): Promise<void> => {
      try {
        await checkGiveaways(client);
      } catch (error) {
        await logger.error('Error checking giveaways', error as Error);
      }
    });
  },
};

export default cronJobs;
