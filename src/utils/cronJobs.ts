/* eslint-disable @typescript-eslint/no-misused-promises */
import { updatePremiumStatusCache } from '@/services/premium.service';
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
};

export default cronJobs;
