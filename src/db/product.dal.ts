import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    name: String,
    description: String,
    price: Number,
    emoji: { type: String, default: '' },
    isAvailable: { type: Boolean, default: true },
    guildId: String,
  },
  {
    timestamps: true,
  },
);

interface ProductDocument extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  description: string;
  price: number;
  emoji: string;
  isAvailable: boolean;
  guildId: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProductModel = mongoose.model<ProductDocument>('products', productSchema);

const ProductDAL = {
  createProduct: async (
    product: Omit<ProductDocument, 'createdAt' | 'updatedAt' | '_id'>,
  ): Promise<ProductDocument> => {
    return ProductModel.create(product);
  },

  updateProduct: async (product: Partial<ProductDocument>): Promise<ProductDocument | null> => {
    return ProductModel.findOneAndUpdate(
      { name: product.name, guildId: product.guildId },
      product,
      { new: true },
    );
  },

  updateProductById: async (product: Partial<ProductDocument>): Promise<ProductDocument | null> => {
    return ProductModel.findOneAndUpdate({ _id: product._id }, product, { new: true });
  },

  getAllProducts: async (): Promise<ProductDocument[]> => {
    return ProductModel.find();
  },

  getProductsByGuildId: async (guildId: string): Promise<ProductDocument[]> => {
    return ProductModel.find({ guildId });
  },

  getProductById: async (id: string): Promise<ProductDocument | null> => {
    return ProductModel.findById(id);
  },

  getProductByName: async (name: string, guildId: string): Promise<ProductDocument | null> => {
    return ProductModel.findOne({ name, guildId });
  },

  deleteSingleProduct: async (
    productId: string,
    guildId: string,
  ): Promise<ProductDocument | null> => {
    return ProductModel.findOneAndDelete({ _id: productId, guildId });
  },

  deleteProductsByGuildId: async (guildId: string) => {
    return ProductModel.deleteMany({ guildId });
  },
};

export { ProductDAL, ProductModel, type ProductDocument };
