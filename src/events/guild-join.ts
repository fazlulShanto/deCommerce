import { PremiumInfoDAL } from '@/db/premium-info.dal';
import { logger } from '@/utils/logger';
import type { Guild } from 'discord.js';

export const handleGuildCreate = async (guild: Guild) => {
  try {
    await PremiumInfoDAL.initializeServerPremium(guild.id);
    await logger.info(
      {
        event: 'guild.joined',
        guildId: guild.id,
        guildName: guild.name,
      },
      `✅ Added server ${guild.name} to database`,
    );
  } catch (error) {
    await logger.error(
      {
        event: 'guild.join.failed',
        guildId: guild.id,
        guildName: guild.name,
        err: error as Error,
      },
      `❌ Failed to add server ${guild.name} to database:`,
    );
  }
};
