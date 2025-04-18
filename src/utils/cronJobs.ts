/* eslint-disable @typescript-eslint/no-misused-promises */
import { updatePremiumStatusCache } from '@/services/premium.service';
import cron from 'node-cron';

// Run every hour
const cronJobs = {
  updatePremiumStatusCache: () => {
    cron.schedule('0 * * * *', async (): Promise<void> => {
      try {
        await updatePremiumStatusCache();
        console.log('Premium cache updated successfully');
      } catch (error) {
        console.error('Error updating premium cache:', error);
      }
    });
  },
};

export default cronJobs;
