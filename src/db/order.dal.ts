import customNanoid from '@/utils/customNanoId';
import mongoose from 'mongoose';
import { z } from 'zod';
const orderSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true, default: () => customNanoid() },
    productName: { type: String, required: true },
    price: { type: Number, required: true },
    paymentMethod: { type: String, required: false },
    confirmationStatus: {
      type: String,
      enum: ['pending', 'confirmed', 'cancelled'],
      default: 'pending',
    },
    deliveryStatus: {
      type: String,
      enum: ['pending', 'processing', 'delivered', 'cancelled'],
      default: 'pending',
    },
    paymentAmount: { type: Number, required: true },
    paymentStatus: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending',
    },
    guildId: { type: String, required: true },
    customerId: { type: String, required: true }, // Discord user ID
    deliveryInfo: { type: String, required: false, default: '' },
  },
  {
    timestamps: true,
  },
);

const OrderModel = mongoose.model<OrderDocument>('orders', orderSchema);

// Interface for the document with Mongoose methods
interface OrderDocument extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  productName: string;
  price: number;
  paymentMethod: string;
  confirmationStatus: 'pending' | 'confirmed' | 'cancelled';
  deliveryStatus: 'pending' | 'processing' | 'delivered' | 'cancelled';
  paymentAmount: number;
  paymentStatus: 'pending' | 'completed' | 'failed' | 'refunded';
  guildId: string;
  customerId: string; // Discord user ID
  createdAt: Date;
  deliveryInfo?: string;
  updatedAt: Date;
}

// Interface for the data without Mongoose methods
type OrderData = Omit<OrderDocument, keyof mongoose.Document | 'createdAt' | 'updatedAt'>;

const OrderDAL = {
  createOrder: async (order: OrderData): Promise<OrderDocument> => {
    return OrderModel.create(order);
  },

  updateOrder: async (id: string, updates: Partial<OrderData>): Promise<OrderDocument | null> => {
    return OrderModel.findByIdAndUpdate(id, updates, { new: true });
  },

  getOrderById: async (id: string): Promise<OrderDocument | null> => {
    return OrderModel.findById(id);
  },

  getOrdersByGuildId: async (guildId: string): Promise<OrderDocument[]> => {
    return OrderModel.find({ guildId });
  },

  getOrdersByCustomerId: async (customerId: string): Promise<OrderDocument[]> => {
    return OrderModel.find({ customerId });
  },

  getOrdersByCustomerAndGuildId: async (
    customerId: string,
    guildId: string,
  ): Promise<OrderDocument[]> => {
    return OrderModel.find({ customerId, guildId });
  },

  getOrdersByPaymentMethod: async (paymentMethod: string): Promise<OrderDocument[]> => {
    return OrderModel.find({ paymentMethod });
  },

  getOrdersByStatus: async (
    status: {
      confirmationStatus?: OrderDocument['confirmationStatus'];
      deliveryStatus?: OrderDocument['deliveryStatus'];
      paymentStatus?: OrderDocument['paymentStatus'];
    },
    guildId: string,
  ): Promise<OrderDocument[]> => {
    return OrderModel.find({ ...status, guildId });
  },

  deleteOrder: async (id: string): Promise<OrderDocument | null> => {
    return OrderModel.findByIdAndDelete(id);
  },

  deleteOrdersByGuildId: async (guildId: string) => {
    return OrderModel.deleteMany({ guildId });
  },
};

// Zod schema for order
const confirmationStatusSchema = z.enum(['pending', 'confirmed', 'cancelled']).default('pending');
const deliveryStatusSchema = z
  .enum(['pending', 'processing', 'delivered', 'cancelled'])
  .default('pending');
const paymentStatusSchema = z
  .enum(['pending', 'completed', 'failed', 'refunded'])
  .default('pending');

const OrderZodSchema = z.object({
  _id: z.string().min(1),
  productName: z.string().min(1),
  price: z.number().positive(),
  paymentMethod: z.string().optional(),
  confirmationStatus: confirmationStatusSchema,
  deliveryStatus: deliveryStatusSchema,
  paymentAmount: z.number().positive(),
  paymentStatus: paymentStatusSchema,
  guildId: z.string().min(1),
  customerId: z.string().min(1),
  deliveryInfo: z.string().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export { OrderDAL, OrderModel, type OrderDocument, type OrderData, OrderZodSchema };
