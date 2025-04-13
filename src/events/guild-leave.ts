import type { Guild } from 'discord.js';

export const handleGuildLeave = (guild: Guild) => {
  try {
    console.log(`❌ Removed server ${guild.name} from database`);
  } catch (error) {
    console.error(`❌ Failed to remove server ${guild.name} from database:`, error);
  }
};
