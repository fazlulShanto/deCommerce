import type { InferRawDocType } from 'mongoose';
import mongoose from 'mongoose';

const storeConfigSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true },
    currency: { type: String, default: '$' },
    botAdminRoleId: { type: String, default: '' },
  },
  {
    timestamps: true,
  },
);

interface StoreConfigDocument extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  guildId: string;
  currency: string;
  botAdminRoleId: string;
  createdAt: Date;
  updatedAt: Date;
}

const StoreConfigModel = mongoose.model<StoreConfigDocument>('store_configs', storeConfigSchema);

const StoreConfigDAL = {
  createConfig: async (
    config: Omit<InferRawDocType<StoreConfigDocument>, 'createdAt' | 'updatedAt' | '_id'>,
  ): Promise<StoreConfigDocument> => {
    return StoreConfigModel.create(config);
  },

  updateConfig: async (
    config: Partial<StoreConfigDocument>,
  ): Promise<StoreConfigDocument | null> => {
    return StoreConfigModel.findOneAndUpdate({ guildId: config.guildId }, config, {
      new: true,
      upsert: true,
    });
  },

  getConfigByGuildId: async (guildId: string): Promise<StoreConfigDocument | null> => {
    return StoreConfigModel.findOne({ guildId });
  },
  getAllConfigs: async (): Promise<StoreConfigDocument[]> => {
    return StoreConfigModel.find();
  },

  deleteConfigByGuildId: async (guildId: string): Promise<StoreConfigDocument | null> => {
    return StoreConfigModel.findOneAndDelete({ guildId });
  },
};

export { StoreConfigDAL, StoreConfigModel, type StoreConfigDocument };
