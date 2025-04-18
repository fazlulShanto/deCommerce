import { logger } from '@/utils/logger';
import type { Guild } from 'discord.js';

export const handleGuildLeave = async (guild: Guild) => {
  try {
    await logger.info(`❌ Removed server ${guild.name} from database`, {
      context: { guildId: guild.id, guildName: guild.name },
    });
  } catch (error) {
    await logger.error(`❌ Failed to remove server ${guild.name} from database:`, error as Error, {
      context: { guildId: guild.id, guildName: guild.name },
    });
  }
};
