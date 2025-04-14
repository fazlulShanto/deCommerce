import { MAX_ALLOWED_PAYMENT_METHODS } from '@/utils/constants';
import mongoose from 'mongoose';

const paymentMethodSchema = new mongoose.Schema(
  {
    name: String,
    emoji: { type: String, default: '' },
    qrCodeImage: { type: String, default: '' },
    phoneNumber: { type: String, default: '' },
    guildId: String,
  },
  {
    timestamps: true,
  },
).pre('save', async function (next) {
  const model = this.constructor as typeof PaymentMethodModel;
  const count = await model.countDocuments({ guildId: this.guildId });
  if (count >= MAX_ALLOWED_PAYMENT_METHODS) {
    throw new Error('Maximum number of payment methods reached');
  }
  next();
});

const PaymentMethodModel = mongoose.model<PaymentMethodDocument>(
  'payment_methods',
  paymentMethodSchema,
);

// Interface for the document with Mongoose methods
interface PaymentMethodDocument extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  emoji: string;
  guildId: string;
  qrCodeImage: string;
  phoneNumber: string;
  createdAt: Date;
  updatedAt: Date;
}

// Interface for the data without Mongoose methods
type PaymentMethodData = Omit<
  PaymentMethodDocument,
  keyof mongoose.Document | 'createdAt' | 'updatedAt'
>;

const PaymentMethodDAL = {
  createPaymentMethod: async (paymentMethod: PaymentMethodData): Promise<PaymentMethodDocument> => {
    return PaymentMethodModel.create(paymentMethod);
  },

  updatePaymentMethod: async (
    paymentMethod: Partial<PaymentMethodData> & { _id?: mongoose.Types.ObjectId },
  ): Promise<PaymentMethodDocument | null> => {
    return PaymentMethodModel.findOneAndUpdate(
      { name: paymentMethod.name, guildId: paymentMethod.guildId },
      paymentMethod,
      { new: true },
    );
  },

  updatePaymentMethodById: async (
    paymentMethodId: string,
    paymentMethod: Partial<PaymentMethodData>,
  ): Promise<PaymentMethodDocument | null> => {
    return PaymentMethodModel.findOneAndUpdate({ _id: paymentMethodId }, paymentMethod, {
      new: true,
    });
  },

  getAllPaymentMethods: async (): Promise<PaymentMethodDocument[]> => {
    return PaymentMethodModel.find();
  },

  getPaymentMethodsByGuildId: async (guildId: string): Promise<PaymentMethodDocument[]> => {
    return PaymentMethodModel.find({ guildId });
  },

  getPaymentMethodById: async (id: string): Promise<PaymentMethodDocument | null> => {
    return PaymentMethodModel.findById(id);
  },

  getPaymentMethodByName: async (
    name: string,
    guildId: string,
  ): Promise<PaymentMethodDocument | null> => {
    return PaymentMethodModel.findOne({ name, guildId });
  },

  deleteSinglePaymentMethod: async (
    paymentMethodId: string,
    guildId: string,
  ): Promise<PaymentMethodDocument | null> => {
    return PaymentMethodModel.findOneAndDelete({ _id: paymentMethodId, guildId });
  },

  deletePaymentMethodsByGuildId: async (guildId: string) => {
    return PaymentMethodModel.deleteMany({ guildId });
  },
};

export { PaymentMethodDAL, PaymentMethodModel, type PaymentMethodDocument, type PaymentMethodData };
