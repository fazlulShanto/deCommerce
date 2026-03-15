import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { redis } from '@/utils/redis';

export interface GiveawayWizardState {
    mode: 'create' | 'edit';
    messageId?: string; // Only needed for edit mode
    guildId?: string;
    channelId?: string;
    prize?: string;
    winnersCount?: number;
    duration?: string;
    startDelay?: string;
    allowLeave?: boolean;
    blacklistedRoles?: string[];
    blacklistedUsers?: string[];
    description?: string;
}

export const getGiveawayWizardState = async (userId: string): Promise<GiveawayWizardState | null> => {
    const data = await redis.get(`giveaway_v2:setup:${userId}`);
    if (!data) return null;
    try {
        return JSON.parse(data) as GiveawayWizardState;
    } catch {
        return null;
    }
};

export const saveGiveawayWizardState = async (userId: string, state: GiveawayWizardState) => {
    await redis.set(`giveaway_v2:setup:${userId}`, JSON.stringify(state), 'EX', 300); // 5 minutes expiry
};

export const clearGiveawayWizardState = async (userId: string) => {
    await redis.del(`giveaway_v2:setup:${userId}`);
};

export const generateGiveawayDashboard = (state: GiveawayWizardState) => {
    const isEdit = state.mode === 'edit';

    const embed = new EmbedBuilder()
        .setTitle(isEdit ? '✏️ Edit Giveaway (v2)' : '🎉 Create Giveaway (v2)')
        .setDescription(isEdit 
            ? 'Use the buttons below to **modify** components of your giveaway before saving.' 
            : 'Use the buttons below to **set up** your giveaway wizard stepper.')
        .setColor(isEdit ? 'Yellow' : 'Blurple')
        .addFields([
            {
                name: '📝 General Setup',
                value: `**Prize**: ${state.prize || '`Not Set`'}
**Winners**: ${state.winnersCount || '`1`'}
**Duration**: ${state.duration || '`Not Set`'}
**Delay**: ${state.startDelay || '`None`'}
**Allow Leave**: ${state.allowLeave !== undefined ? (state.allowLeave ? 'Yes' : 'No') : '`Not Set`'}`,
                inline: false
            },
            {
                name: '🚫 Exclusions',
                value: `**Blacklisted Roles**: ${state.blacklistedRoles && state.blacklistedRoles.length > 0 ? state.blacklistedRoles.map(r => `<@&${r}>`).join(', ') : '`None`'}
**Blacklisted Users**: ${state.blacklistedUsers && state.blacklistedUsers.length > 0 ? state.blacklistedUsers.map(u => `<@${u}>`).join(', ') : '`None`'}`,
                inline: false
            },
            {
                name: '📖 Description',
                value: state.description ? (state.description.length > 100 ? state.description.substring(0, 97) + '...' : state.description) : '`None`',
                inline: false
            }
        ]);

    const row1 = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('giveaway_v2_sub_1')
                .setLabel('General Info')
                .setEmoji('📝')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('giveaway_v2_sub_2')
                .setLabel('Exclusions')
                .setEmoji('🚫')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('giveaway_v2_sub_3')
                .setLabel('Description')
                .setEmoji('📖')
                .setStyle(ButtonStyle.Primary)
        );

    const isReady = state.prize && state.duration && (state.allowLeave !== undefined);

    const row2 = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(isEdit ? 'giveaway_v2_submit_edit' : 'giveaway_v2_submit_create')
                .setLabel(isEdit ? 'Update Giveaway' : 'Create Giveaway')
                .setEmoji(isEdit ? '🔄' : '✅')
                .setStyle(isReady ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(!isReady),
            new ButtonBuilder()
                .setCustomId('giveaway_v2_cancel')
                .setLabel('Cancel')
                .setEmoji('❌')
                .setStyle(ButtonStyle.Danger)
        );

    return { embeds: [embed], components: [row1, row2] };
};
