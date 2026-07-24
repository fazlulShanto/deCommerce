import { logger } from '@/utils/logger';
import type { Guild } from 'discord.js';

export const handleGuildLeave = async (guild: Guild) => {
  try {
    await logger.info(
      {
        event: 'guild.left',
        guildId: guild.id,
        guildName: guild.name,
      },
      `❌ Removed server ${guild.name} from database`,
    );
  } catch (error) {
    await logger.error(
      {
        event: 'guild.leave.failed',
        guildId: guild.id,
        guildName: guild.name,
        err: error as Error,
      },
      `❌ Failed to remove server ${guild.name} from database:`,
    );
  }
};
