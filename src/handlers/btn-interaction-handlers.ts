import { ButtonInteraction } from "discord.js";

export const handlePaymentMethodButton = async (interaction: ButtonInteraction) => {
  const [_, paymentMethodName, paymentMethodId] = interaction.customId.split('_');
  console.log('paymentMethodName', paymentMethodName);
  console.log('paymentMethodId', paymentMethodId);
  interaction.reply({
    content: 'Payment method selected',
    ephemeral: true,
  });
};

