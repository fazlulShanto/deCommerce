import { MessageFlags, type ModalSubmitInteraction, EmbedBuilder } from 'discord.js';
import type { ProductDocument } from '@/db/product.dal';
import { ProductDAL } from '@/db/product.dal';
import { z } from 'zod';
import { getGenericErrorEmbed, getGenericSuccessEmbed } from '@/utils/genericEmbeds';
import mongoose from 'mongoose';
import { PaymentMethodDAL, type PaymentMethodData } from '@/db/payment-method.dal';
import { OrderDAL } from '@/db/order.dal';

// Define the product schema with Zod
const productSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  description: z.string().min(1, 'Product description is required'),
  price: z.number().positive('Price must be a positive number'),
  emoji: z.string().optional(),
  isAvailable: z.boolean(),
  guildId: z.string().min(1, 'Guild ID is required'),
});

// Helper function to convert yes/no string to boolean
const yesNoToBoolean = (value: string): boolean => {
  const normalized = value.toLowerCase().trim();
  if (normalized === 'yes') return true;
  if (normalized === 'no') return false;
  throw new Error('Availability must be "yes" or "no"');
};

export const handleAddOrUpdateProductModal = async (
  interaction: ModalSubmitInteraction,
  isUpdating: boolean = false,
) => {
  const operationMode = isUpdating ? 'updated' : 'added';
  const modalCustomId = interaction?.customId || '';
  const name = interaction.fields.getTextInputValue('name');
  const description = interaction.fields.getTextInputValue('description');
  const priceInput = interaction.fields.getTextInputValue('price');
  const emoji = interaction.fields.getTextInputValue('emoji');
  const isAvailableInput = interaction.fields.getTextInputValue('isAvailable');
  const guildId = interaction.guildId;
  if (!guildId) {
    throw new Error('Guild ID is required');
  }
  try {
    // Parse price to number
    const price = parseFloat(priceInput);

    // Convert isAvailable input to boolean with validation
    let isAvailable: boolean;
    try {
      isAvailable = yesNoToBoolean(isAvailableInput);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Invalid availability value';
      await interaction.reply({
        content: `Validation error: ${errorMessage}`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    // Validate the data with Zod
    const validationResult = productSchema.safeParse({
      name,
      description,
      price,
      emoji,
      isAvailable,
      guildId,
    });

    if (!validationResult.success) {
      const errorMessage = validationResult.error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join('\n');

      await interaction.reply({
        content: `Validation error:\n${errorMessage}`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }

    const product = validationResult.data as ProductDocument;

    let result = undefined;
    if (isUpdating) {
      const productId = modalCustomId.split('_')[1];
      if (!productId) {
        throw new Error('Product ID not found in modal custom ID');
      }
      result = await ProductDAL.updateProductById({
        ...product,
        _id: new mongoose.Types.ObjectId(productId),
      });
    } else {
      result = await ProductDAL.createProduct(product);
    }

    if (!result) {
      throw new Error(`Failed to ${operationMode} product.`);
    }

    await interaction.reply({
      embeds: [
        getGenericSuccessEmbed(
          `Product ${operationMode} successfully`,
          `Successfully ${operationMode} product: ${emoji} ${name}`,
        ),
      ],
    });
  } catch {
    await interaction.reply({
      content: `There was an error while ${operationMode} the product!`,
    });
  }
};

export const handleAddPaymentMethodModal = async (interaction: ModalSubmitInteraction) => {
  const name = interaction.fields.getTextInputValue('name');
  const emoji = interaction.fields.getTextInputValue('emoji');
  const qrCodeImage = interaction.fields.getTextInputValue('qrCodeImage');
  const phoneNumber = interaction.fields.getTextInputValue('phoneNumber');
  const guildId = interaction.guildId;

  if (!guildId) {
    throw new Error('Guild ID is required');
  }
  const operationMode = 'added';
  try {
    const paymentMethodData: PaymentMethodData = {
      name,
      emoji,
      phoneNumber,
      guildId,
      qrCodeImage,
    };

    const paymentMethod = await PaymentMethodDAL.createPaymentMethod(paymentMethodData);

    if (!paymentMethod) {
      throw new Error('Failed to add payment method');
    }

    await interaction.reply({
      embeds: [
        getGenericSuccessEmbed(
          `Payment method ${operationMode} successfully`,
          `Successfully ${operationMode} payment method: ${emoji} ${name}`,
        ),
      ],
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await interaction.reply({
      embeds: [
        getGenericErrorEmbed(`Failed`, errorMessage).addFields([
          {
            name: '\u200b',
            value: 'user ```/list-payment-methods``` to see your payment methods',
          },
        ]),
      ],
    });
  }
};

export const handleDeliveryProductModal = async (interaction: ModalSubmitInteraction) => {
  console.log('handleDeliveryProductModal');
  const modalCustomId = interaction?.customId || '';
  const orderId = modalCustomId.split('_')[1];

  const description = interaction.fields.getTextInputValue('description');

  if (!orderId || !description) {
    throw new Error('Missing required fields');
  }

  const order = await OrderDAL.getOrderById(orderId);

  if (!order) {
    throw new Error('Order not found');
  }
  const productName = order?.productName;
  const productPrice = order?.price;

  // update order status to delivered
  await OrderDAL.updateOrder(orderId, {
    deliveryStatus: 'delivered',
    confirmationStatus: 'confirmed',
    paymentStatus: 'completed',
    deliveryInfo: description,
  });

  const embed = new EmbedBuilder()
    .setTitle(`Delivery Product`)
    .setDescription('```' + description + '```')
    .addFields([
      { name: 'Order ID', value: orderId },
      { name: 'Product Name', value: productName },
      { name: 'Product Price', value: productPrice.toString() },
    ])
    .setTimestamp()
    .setColor('DarkGreen');
  await interaction.reply({ embeds: [embed] });
};
