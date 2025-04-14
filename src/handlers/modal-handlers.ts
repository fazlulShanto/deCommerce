import { MessageFlags, type ModalSubmitInteraction, EmbedBuilder } from 'discord.js';
import type { ProductDocument } from '@/db/product.dal';
import { ProductDAL } from '@/db/product.dal';
import { z } from 'zod';
import { getGenericErrorEmbed } from '@/utils/genericEmbeds';
import mongoose from 'mongoose';
import { PaymentMethodDAL, type PaymentMethodData } from '@/db/payment-method.dal';
import { OrderDAL } from '@/db/order.dal';
import { MODAL_IDS } from '@/utils/constants';
import { getPaymentMethodDetailsEmbed } from '@/commands/payments/paymentMethodDetails';

// Define the product schema with Zod
const productSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  description: z.string().min(1, 'Product description is required'),
  price: z.number().positive('Price must be a positive number'),
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

    const embed = new EmbedBuilder()
      .setTitle(`Product ${operationMode} successfully`)
      .addFields(
        {
          name: 'Product Name',
          value: product.name,
        },
        {
          name: 'Price',
          value: `${product.price}`,
        },
        {
          name: 'Description',
          value: product.description,
        },
        {
          name: 'Availability',
          value: product.isAvailable ? 'Yes' : 'No',
        },
      )
      .setColor('Blue');

    await interaction.reply({
      embeds: [embed],
    });
  } catch {
    await interaction.reply({
      content: `There was an error while ${operationMode} the product!`,
    });
  }
};

export const handleAddOrUpdatePaymentMethodModal = async (
  interaction: ModalSubmitInteraction,
  isUpdateOperation: boolean = false,
) => {
  const operationMode = isUpdateOperation ? 'updated' : 'added';
  const name = interaction.fields.getTextInputValue('name');
  const emoji = interaction.fields.getTextInputValue('emoji');
  const qrCodeImage = interaction.fields.getTextInputValue('qrCodeImage');
  const phoneNumber = interaction.fields.getTextInputValue('phoneNumber');
  const guildId = interaction.guildId;

  if (!guildId) {
    throw new Error('Guild ID is required');
  }
  try {
    const paymentMethodData: PaymentMethodData = {
      name,
      emoji,
      phoneNumber,
      guildId,
      qrCodeImage,
    };

    let paymentMethod = undefined;
    if (isUpdateOperation) {
      const paymentMethodId = interaction.customId.split('_')[1];
      if (!paymentMethodId) {
        throw new Error('Payment method ID not found in modal custom ID');
      }
      paymentMethod = await PaymentMethodDAL.updatePaymentMethodById(
        paymentMethodId,
        paymentMethodData,
      );
    } else {
      paymentMethod = await PaymentMethodDAL.createPaymentMethod(paymentMethodData);
    }

    if (!paymentMethod) {
      throw new Error('Failed to add payment method');
    }

    const embed = getPaymentMethodDetailsEmbed(paymentMethod, operationMode);

    await interaction.reply({
      embeds: [embed],
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

export const handleModalSubmit = async (interaction: ModalSubmitInteraction) => {
  const modalCustomId = interaction?.customId || '';

  if (!modalCustomId || !interaction.isModalSubmit()) {
    return;
  }

  try {
    if (interaction.customId.startsWith(MODAL_IDS.UPDATE_PRODUCT)) {
      await handleAddOrUpdateProductModal(interaction, true);
      return;
    }

    if (interaction.customId === MODAL_IDS.ADD_PRODUCT) {
      await handleAddOrUpdateProductModal(interaction, false);
      return;
    }

    if (
      interaction.customId === MODAL_IDS.ADD_PAYMENT_METHOD ||
      interaction.customId.startsWith(MODAL_IDS.UPDATE_PAYMENT_METHOD)
    ) {
      await handleAddOrUpdatePaymentMethodModal(
        interaction,
        modalCustomId !== MODAL_IDS.ADD_PAYMENT_METHOD,
      );
      return;
    }

    if (interaction.customId.startsWith(MODAL_IDS.DELIVERY_PRODUCT)) {
      await handleDeliveryProductModal(interaction);
      return;
    }

    await interaction.reply({
      embeds: [getGenericErrorEmbed('Invalid modal', 'Please try again.')],
    });
  } catch {
    await interaction.reply({
      content: 'There was an error while processing your request.',
      ephemeral: true,
    });
  }
};
