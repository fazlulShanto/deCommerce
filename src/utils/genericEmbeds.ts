import { EmbedBuilder } from 'discord.js';

const getGenericErrorEmbed = (title: string, description: string) => {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor('Red');
};

const getGenericSuccessEmbed = (title: string, description: string) => {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor('Green');
};

export { getGenericErrorEmbed, getGenericSuccessEmbed };
