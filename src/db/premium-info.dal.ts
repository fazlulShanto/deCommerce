import customNanoid from '@/utils/customNanoId';
import mongoose from 'mongoose';
import { z } from 'zod';

const premiumInfoSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true, default: () => customNanoid() },
    guildId: { type: String, required: true, unique: true },
    isPremium: { type: Boolean, default: false },
    isTrial: { type: Boolean, default: false },
    trialDays: { type: Number, default: 0 },
    trialStartDate: { type: Date, default: null },
    trialEndDate: { type: Date, default: null },
    premiumExpiryDate: { type: Date, default: null },
    hasUsedTrial: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  },
);

const PremiumInfoModel = mongoose.model<PremiumInfoDocument>('premiumInfo', premiumInfoSchema);

// Interface for the document with Mongoose methods
interface PremiumInfoDocument extends mongoose.Document {
  _id: string;
  guildId: string;
  isPremium: boolean;
  isTrial: boolean;
  trialDays: number;
  trialStartDate: Date | null;
  trialEndDate: Date | null;
  premiumExpiryDate: Date | null;
  hasUsedTrial: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Interface for the data without Mongoose methods
type PremiumInfoData = Omit<
  PremiumInfoDocument,
  keyof mongoose.Document | 'createdAt' | 'updatedAt'
>;

const PremiumInfoDAL = {
  createPremiumInfo: async (
    premiumInfo: Partial<PremiumInfoData>,
  ): Promise<PremiumInfoDocument> => {
    return PremiumInfoModel.create(premiumInfo);
  },

  updatePremiumInfo: async (
    guildId: string,
    updates: Partial<PremiumInfoData>,
  ): Promise<PremiumInfoDocument | null> => {
    return PremiumInfoModel.findOneAndUpdate({ guildId }, updates, { new: true });
  },

  getPremiumInfoByGuildId: async (guildId: string): Promise<PremiumInfoDocument | null> => {
    return PremiumInfoModel.findOne({ guildId });
  },

  // Check if a server has premium status
  hasPremium: async (guildId: string): Promise<boolean> => {
    const premiumInfo = await PremiumInfoModel.findOne({ guildId });
    if (!premiumInfo) return false;

    if (premiumInfo.isPremium && premiumInfo.premiumExpiryDate) {
      return premiumInfo.premiumExpiryDate > new Date();
    }

    return false;
  },

  // Check if a server has an active trial
  hasActiveTrial: async (guildId: string): Promise<boolean> => {
    const premiumInfo = await PremiumInfoModel.findOne({ guildId });
    if (!premiumInfo) return false;

    if (premiumInfo.isTrial && premiumInfo.trialEndDate) {
      return premiumInfo.trialEndDate > new Date();
    }

    return false;
  },

  // Start a trial for a server
  startTrial: async (guildId: string, trialDays: number): Promise<PremiumInfoDocument | null> => {
    const premiumInfo = await PremiumInfoModel.findOne({ guildId });

    // If server already used trial, don't allow starting a new one
    if (premiumInfo?.hasUsedTrial) return premiumInfo;

    const trialStartDate = new Date();
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + trialDays);

    return PremiumInfoModel.findOneAndUpdate(
      { guildId },
      {
        isTrial: true,
        trialDays,
        trialStartDate,
        trialEndDate,
        hasUsedTrial: true,
      },
      { new: true, upsert: true },
    );
  },

  // Set premium status for a server
  setPremiumStatus: async (
    guildId: string,
    isPremium: boolean,
    expiryDays: number = 0,
  ): Promise<PremiumInfoDocument | null> => {
    const updates: Partial<PremiumInfoData> = { isPremium };

    if (isPremium && expiryDays > 0) {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + expiryDays);
      updates.premiumExpiryDate = expiryDate;
    } else if (!isPremium) {
      updates.premiumExpiryDate = null;
    }

    return PremiumInfoModel.findOneAndUpdate({ guildId }, updates, { new: true, upsert: true });
  },

  // Initialize premium info when bot joins a server
  initializeServerPremium: async (
    guildId: string,
    defaultTrialDays: number = 1,
  ): Promise<PremiumInfoDocument> => {
    // Check if premium info already exists for this guild
    const existingInfo = await PremiumInfoModel.findOne({ guildId });
    if (existingInfo) return existingInfo;

    // Create new premium info with default trial
    const trialStartDate = new Date();
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + defaultTrialDays);

    return PremiumInfoModel.create({
      guildId,
      isPremium: false,
      isTrial: true,
      trialDays: defaultTrialDays,
      trialStartDate,
      trialEndDate,
      hasUsedTrial: true,
    });
  },

  // Check if a server has access (either premium or active trial)
  hasAccess: async (guildId: string): Promise<boolean> => {
    const premiumInfo = await PremiumInfoModel.findOne({ guildId });
    if (!premiumInfo) return false;

    // Check premium status
    if (premiumInfo.isPremium && premiumInfo.premiumExpiryDate) {
      if (premiumInfo.premiumExpiryDate > new Date()) return true;
    }

    // Check trial status
    if (premiumInfo.isTrial && premiumInfo.trialEndDate) {
      if (premiumInfo.trialEndDate > new Date()) return true;
    }

    return false;
  },

  // End trial for a server
  endTrial: async (guildId: string): Promise<PremiumInfoDocument | null> => {
    return PremiumInfoModel.findOneAndUpdate({ guildId }, { isTrial: false }, { new: true });
  },
};

// Zod schema for premium info
const PremiumInfoZodSchema = z.object({
  _id: z.string().min(1),
  guildId: z.string().min(1),
  isPremium: z.boolean().default(false),
  isTrial: z.boolean().default(false),
  trialDays: z.number().nonnegative().default(0),
  trialStartDate: z.date().nullable().default(null),
  trialEndDate: z.date().nullable().default(null),
  premiumExpiryDate: z.date().nullable().default(null),
  hasUsedTrial: z.boolean().default(false),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export {
  PremiumInfoDAL,
  PremiumInfoModel,
  type PremiumInfoDocument,
  type PremiumInfoData,
  PremiumInfoZodSchema,
};
