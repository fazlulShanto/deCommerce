import PingCommand from './utility/ping';
import ServerInfoCommand from './utility/server-info';
import BuyCommand from './sales/buy';
import AddProductsCommand from './products/addProducts';
import ListProductsCommand from './products/listProducts';
import { DeleteProductCommand } from './products/deleteProduct';
import { UpdateProductCommand } from './products/updateProduct';
import ProductDetailsCommand from './products/productDetails';
import AddPaymentMethodCommand from './payments/addPaymentMethod';
import { DeletePaymentMethodCommand } from './payments/deletePaymentMethod';
import ListPaymentMethodsCommand from './payments/listPaymentMethod';
import PaymentMethodDetailsCommand from './payments/paymentMethodDetails';

export const botCommands = [
  PingCommand,
  ServerInfoCommand,
  BuyCommand,
  AddProductsCommand,
  ListProductsCommand,
  DeleteProductCommand,
  UpdateProductCommand,
  ProductDetailsCommand,
  AddPaymentMethodCommand,
  DeletePaymentMethodCommand,
  ListPaymentMethodsCommand,
  PaymentMethodDetailsCommand,
];
