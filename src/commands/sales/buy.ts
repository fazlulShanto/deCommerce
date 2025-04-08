import type { ComponentEmojiResolvable } from 'discord.js';
import {
  ActionRowBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import itemsData from '../../data/items.json';
import type { SlashCommand } from '../../config/command-handler';

export const BuyCommand: SlashCommand = {
  name: 'buy1',
  description: 'Buy an item',
  data: new SlashCommandBuilder().setName('buy1').setDescription('Buy an item'),
  requiredPermissions: [],
  execute: async (interaction: ChatInputCommandInteraction) => {
    const items = itemsData.items;

    const options = items.map((item) => {
      const newOption = new StringSelectMenuOptionBuilder()
        .setLabel(item.name)
        .setDescription(item.description)
        .setValue(item.name);

      if (item.emoji) {
        newOption.setEmoji(item.emoji as ComponentEmojiResolvable);
      }

      return newOption;
    });

    const select = new StringSelectMenuBuilder()
      .setCustomId('buy-item-selector')
      .setPlaceholder('Make a selection!')
      .setOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    await interaction.reply({
      content: 'Select an item to buy!',
      components: [row],
    });
  },
};

export default BuyCommand;
