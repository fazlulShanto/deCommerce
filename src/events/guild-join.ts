import { PremiumInfoDAL } from '@/db/premium-info.dal';
import { logger } from '@/utils/logger';
import type { Guild } from 'discord.js';

export const handleGuildCreate = async (guild: Guild) => {
  try {
    await PremiumInfoDAL.initializeServerPremium(guild.id);
    await logger.info(`✅ Added server ${guild.name} to database`, {
      context: { guildId: guild.id, guildName: guild.name },
    });
  } catch (error) {
    await logger.error(`❌ Failed to add server ${guild.name} to database:`, error as Error, {
      context: { guildId: guild.id, guildName: guild.name },
    });
  }
};
