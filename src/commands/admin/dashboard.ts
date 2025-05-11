/* eslint-disable */
import {
  MessageFlags,
  SlashCommandBuilder,
  ContainerBuilder,
  type ChatInputCommandInteraction,
  ButtonBuilder,
  ButtonStyle,
  TextDisplayBuilder,
  SectionBuilder,
  SeparatorSpacingSize,
} from 'discord.js';
import type { SlashCommand } from '../../config/command-handler';
import { SignJWT } from 'jose';
import customNanoid from '@/utils/customNanoId';

const commandName = 'dashboard';
export const DashboardCommand: SlashCommand = {
  name: commandName,
  description: 'Get link of your dashboard',
  data: new SlashCommandBuilder().setName(commandName).setDescription('Get dynamic Dashboard Link'),
  requiredPermissions: ['BotAdmin', 'GuildOnly', 'PremiumOrTrial'],
  execute: async (interaction: ChatInputCommandInteraction) => {
    await interaction.deferReply({
      // flags: [MessageFlags.Ephemeral]
    });
    const tokenKey = 'dashboard:' + customNanoid(8);
    const jwtPayload = {
      tokenKey: tokenKey,
      userId: interaction.user.id,
      role: 'BotAdmin',
      guildId: interaction.guildId,
      guildName: interaction.guild?.name,
    };

    const jwtSecret = process.env.JWT_SECRET;
    const dashboardUrl = process.env.DASHBOARD_URL;

    if (!jwtSecret || !dashboardUrl) {
      await interaction.editReply({
        content: 'Failed to generate token',
      });
      return;
    }

    const token = await new SignJWT(jwtPayload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer('bot:user:' + interaction.user.id)
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(jwtSecret));

    // set it to redis
    await interaction.client.globalCacheDb.setex(tokenKey, 1 * 3600, token);
    // attach to url
    const dashboardUrlWithToken = new URL(dashboardUrl + '/dashboard');
    dashboardUrlWithToken.searchParams.set('token', token);

    const container = new ContainerBuilder().setAccentColor([192, 132, 252]);

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## :bar_chart: Store Dashboard\nThis is your store dashboard where you can see all the data of your orders/products/customers and query about it. Helpful for monitoring & analytics.`,
      ),
    );

    container.addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Large));

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [`### :link: Dashboard Link(Valid for 1 hour)\n`].join('\n'),
      ),
    );

    const visitDashboardButton = new ButtonBuilder()
      .setLabel('Visit Dashboard')
      .setStyle(ButtonStyle.Link)
      .setURL(dashboardUrlWithToken.toString());

    container.addActionRowComponents((row) => row.addComponents(visitDashboardButton));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          '\n\n',
          `- :closed_lock_with_key:  ${tokenKey}`,
          '- :clock: ' + Date.now().toString(),
        ].join('\n'),
      ),
    );

    await interaction.editReply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};

export default DashboardCommand;
