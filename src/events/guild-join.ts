import type { Guild } from 'discord.js';
import { ServerDal } from '@taskcord/database';

export const handleGuildCreate = async (guild: Guild) => {
  try {
    console.log(`✅ Added server ${guild.name} to database`);
  } catch (error) {
    console.error(`❌ Failed to add server ${guild.name} to database:`, error);
  }
};
