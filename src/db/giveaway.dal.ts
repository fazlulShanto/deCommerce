import mongoose from "mongoose";

const giveawaySchema = new mongoose.Schema(
    {
        guildId: { type: String, required: true },
        channelId: { type: String, required: true },
        messageId: { type: String, required: true, unique: true },
        prize: { type: String, required: true },
        winnersCount: { type: Number, default: 1 },
        startTime: { type: Date, default: Date.now },
        endTime: { type: Date, required: true },
        participants: { type: [String], default: [] },
        winners: { type: [String], default: [] },
        ended: { type: Boolean, default: false },
        allowLeave: { type: Boolean, default: false },
        blacklistedRoles: { type: [String], default: [] },
        blacklistedUsers: { type: [String], default: [] },
        description: { type: String },
    },
    {
        timestamps: true,
    },
);

export interface GiveawayDocument extends mongoose.Document {
    _id: mongoose.Types.ObjectId;
    guildId: string;
    channelId: string;
    messageId: string;
    prize: string;
    winnersCount: number;
    startTime: Date;
    endTime: Date;
    participants: string[];
    winners: string[];
    ended: boolean;
    allowLeave: boolean;
    blacklistedRoles: string[];
    blacklistedUsers: string[];
    description?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface GiveawayInput {
    guildId: string;
    channelId: string;
    messageId: string;
    prize: string;
    winnersCount: number;
    startTime?: Date;
    endTime: Date;
    participants?: string[];
    winners?: string[];
    ended?: boolean;
    allowLeave?: boolean;
    blacklistedRoles?: string[];
    blacklistedUsers?: string[];
    description?: string;
}

const GiveawayModel =
    mongoose.models.giveaways ||
    mongoose.model<GiveawayDocument>("giveaways", giveawaySchema);

const GiveawayDAL = {
    createGiveaway: async (
        giveaway: GiveawayInput,
    ): Promise<GiveawayDocument> => {
        return GiveawayModel.create(giveaway);
    },

    getGiveawayByMessageId: async (
        messageId: string,
    ): Promise<GiveawayDocument | null> => {
        return GiveawayModel.findOne({ messageId });
    },

    getScheduledOrActiveGiveawaysByGuild: async (
        guildId: string,
    ): Promise<GiveawayDocument[]> => {
        return GiveawayModel.find({
            guildId,
            ended: false,
        });
    },

    addParticipant: async (
        messageId: string,
        userId: string,
    ): Promise<GiveawayDocument | null> => {
        return GiveawayModel.findOneAndUpdate(
            { messageId, ended: false },
            { $addToSet: { participants: userId } },
            { new: true },
        );
    },

    removeParticipant: async (
        messageId: string,
        userId: string,
    ): Promise<GiveawayDocument | null> => {
        return GiveawayModel.findOneAndUpdate(
            { messageId, ended: false },
            { $pull: { participants: userId } },
            { new: true }
        );
    },

    getExpiredGiveaways: async (): Promise<GiveawayDocument[]> => {
        return GiveawayModel.find({
            endTime: { $lte: new Date() },
            ended: false,
        });
    },

    updateGiveaway: async (
        messageId: string,
        update: Partial<GiveawayDocument>,
    ): Promise<GiveawayDocument | null> => {
        return GiveawayModel.findOneAndUpdate({ messageId }, update, { new: true });
    },

    deleteGiveawaysByGuildId: async (guildId: string) => {
        return GiveawayModel.deleteMany({ guildId });
    },
};

export { GiveawayDAL, GiveawayModel };
