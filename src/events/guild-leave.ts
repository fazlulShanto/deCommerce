import type { Guild } from "discord.js";
import { ServerDal } from "@taskcord/database";

export const handleGuildLeave = async (guild: Guild) => {
  try {
    await ServerDal.createServer({
      serverId: guild.id,
      ownerId: guild.ownerId,
      serverLogo: guild.iconURL() || guild.icon,
      serverName: guild.name,
      isBotInServer: false,
    });
  } catch (error) {
    console.error(
      `❌ Failed to update server ${guild.name} to database:`,
      error
    );
  }
};
