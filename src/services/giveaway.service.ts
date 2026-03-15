import { type Client, EmbedBuilder, type TextChannel, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { GiveawayDAL, type GiveawayDocument } from '@/db/giveaway.dal';
import { redis } from '@/utils/redis';

export const checkGiveaways = async (client: Client) => {
    try {
        const now = Date.now();

        // 1. Start Scheduled Giveaways
        const toStart = await redis.zrangebyscore('giveaway:start_queue', 0, now);
        for (const messageId of toStart) {
            const giveaway = await GiveawayDAL.getGiveawayByMessageId(messageId);
            if (giveaway && !giveaway.ended) {
                await startGiveaway(client, giveaway);
            }
            await redis.zrem('giveaway:start_queue', messageId);
        }

        // 2. End Expired Giveaways
        const toEnd = await redis.zrangebyscore('giveaway:end_queue', 0, now);
        for (const messageId of toEnd) {
            const giveaway = await GiveawayDAL.getGiveawayByMessageId(messageId);
            if (giveaway && !giveaway.ended) {
                await endGiveaway(client, giveaway);
            }
            await redis.zrem('giveaway:end_queue', messageId);
        }

    } catch (error) {
        console.error('Error checking giveaways queue:', error);
    }
};

export const startGiveaway = async (client: Client, giveaway: GiveawayDocument) => {
    try {
        const channel = (await client.channels.fetch(giveaway.channelId)) as TextChannel | null;
        if (!channel) return;

        const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
        if (!message) return;

        const embed = message.embeds[0];
        if (!embed) return;

        const newEmbed = EmbedBuilder.from(embed)
            .setDescription(`React with the button below to enter!`)
            // Re-create fields to add End Time safely
            // Fields order: 0: Winners, 1: Starts At, 2: Hosted By -> replace 1
            .setFields([]);

        const fields = embed.fields;
        newEmbed.addFields([
            { name: 'Winners', value: fields[0].value, inline: true },
            { name: 'Ends At', value: `<t:${Math.floor(giveaway.endTime.getTime() / 1000)}:R>`, inline: true },
            { name: 'Hosted By', value: fields[2].value, inline: true },
            { name: 'Participants', value: '0', inline: true }
        ]);

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('giveaway_join')
                    .setLabel('Enter')
                    .setEmoji('🎉')
                    .setStyle(ButtonStyle.Success)
            );

        if (giveaway.allowLeave) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('giveaway_leave')
                    .setLabel('Leave')
                    .setEmoji('🚪')
                    .setStyle(ButtonStyle.Danger)
            );
        }

        await message.edit({ embeds: [newEmbed], components: [row] });

    } catch (error) {
        console.error(`Error starting scheduled giveaway ${giveaway.messageId}:`, error);
    }
};

export const endGiveaway = async (client: Client, giveaway: GiveawayDocument) => {
    try {
        const channel = (await client.channels.fetch(giveaway.channelId)) as TextChannel | null;
        if (!channel) {
            console.warn(`Channel ${giveaway.channelId} not found for giveaway ${giveaway.messageId}`);
            await GiveawayDAL.updateGiveaway(giveaway.messageId, { ended: true });
            return;
        }

        const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
        if (!message) {
            console.warn(`Message ${giveaway.messageId} not found for giveaway`);
            await GiveawayDAL.updateGiveaway(giveaway.messageId, { ended: true });
            return;
        }

        const participants = giveaway.participants;

        // Filter Blacklisted Users prior to selecting winner
        const eligibleParticipants: string[] = [];
        for (const uId of participants) {
            if (giveaway.blacklistedUsers.includes(uId)) continue;
            const member = await channel.guild.members.fetch(uId).catch(() => null);
            if (member) {
                const hasBlacklistedRole = member.roles.cache.some(r => giveaway.blacklistedRoles.includes(r.id));
                if (hasBlacklistedRole) continue;
            }
            eligibleParticipants.push(uId);
        }

        let winners: string[] = [];
        if (eligibleParticipants.length > 0) {
            const winnersCount = Math.min(giveaway.winnersCount, eligibleParticipants.length);
            const shuffled = [...eligibleParticipants].sort(() => 0.5 - Math.random());
            winners = shuffled.slice(0, winnersCount);
        }

        // Update DB first to prevent re-processing
        await GiveawayDAL.updateGiveaway(giveaway.messageId, {
            ended: true,
            winners: winners
        });

        // Update Embed
        const embed = message.embeds[0];
        if (embed) {
            const newEmbed = EmbedBuilder.from(embed)
                .setColor('Red')
                .setDescription('**GIVEAWAY ENDED**')
                .setFooter({ text: 'Ended' })
                .setTimestamp(new Date());

            if (newEmbed.data.fields) {
                newEmbed.data.fields = newEmbed.data.fields.filter(f => f.name !== 'Ends At');
                const winnersList = winners.length > 0
                    ? winners.map(w => `<@${w}>`).join(', ')
                    : 'No eligible participants won';
                
                newEmbed.addFields({ name: 'Winners', value: winnersList, inline: false });
            }

            await message.edit({ embeds: [newEmbed], components: [] });
        }

        if (winners.length > 0) {
            const winnersMentions = winners.map(w => `<@${w}>`).join(', ');
            await channel.send({
                content: `🎉 Congratulations ${winnersMentions}! You won **${giveaway.prize}**! 🎁`
            });
        } else {
            await channel.send({
                content: `ℹ️ The giveaway for **${giveaway.prize}** ended, but there were no eligible winners.`
            });
        }

    } catch (error) {
        console.error(`Error ending giveaway ${giveaway.messageId}:`, error);
    }
};
