import type { TextChannel } from 'discord.js';
import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  type BaseInteraction,
  type APIEmbedField,
} from 'discord.js';

const getGenericErrorEmbed = (title: string, description: string, fields?: APIEmbedField[]) => {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor('Red')
    .addFields(fields || []);
};

const getGenericSuccessEmbed = (title: string, description: string, fields?: APIEmbedField[]) => {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor('Green')
    .addFields(fields || []);
};

const sendEmbed = async ({
  channel,
  actionType,
  embed,
  interaction,
}: {
  channel: TextChannel;
  actionType: 'followUp' | 'reply' | 'send';
  embed: EmbedBuilder;
  interaction?: BaseInteraction;
}) => {
  const isCommandInteraction = interaction instanceof ChatInputCommandInteraction;
  if (actionType === 'followUp' && isCommandInteraction) {
    await interaction.followUp({ embeds: [embed] });
  } else if (actionType === 'reply' && isCommandInteraction) {
    await interaction.reply({ embeds: [embed] });
  } else if (actionType === 'send') {
    await channel.send({ embeds: [embed] });
  }
};

export { getGenericErrorEmbed, getGenericSuccessEmbed, sendEmbed };
