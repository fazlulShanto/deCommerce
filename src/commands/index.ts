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
import { ListOrdersCommand } from './order/listOrders';
import { OrderDetailsCommand } from './order/orderDetails';
import { CancelOrderCommand } from './order/cancelOrder';
import { ConfirmOrderCommand } from './order/confirmOrder';
import { DeliveryProductCommand } from './delivery/deliveryProduct';
import SetStoreCommand from './setup/setStore';
import HealthCheckCommand from './utility/healthCheck';
import ViewStoreConfigCommand from './setup/viewStoreConfig';
import UpdatePaymentMethodCommand from './payments/updatePaymentMethod';
import SalesStatsCommand from './utility/salesStats';
import PremiumCommand from './utility/premium';
import ExtendTrialCommand from './admin/extend-trial';
import RevokeSubscriptionCommand from './admin/revoke-subscription';
import MyPendingOrdersCommand from './order/myOrder';
import CreateOrderCommand from './order/createOrder';
import UptimeCommand from './utility/uptime';

export const botCommands = [
  UptimeCommand,
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
  ListOrdersCommand,
  OrderDetailsCommand,
  CancelOrderCommand,
  ConfirmOrderCommand,
  DeliveryProductCommand,
  SetStoreCommand,
  HealthCheckCommand,
  UpdatePaymentMethodCommand,
  ViewStoreConfigCommand,
  SalesStatsCommand,
  PremiumCommand,
  ExtendTrialCommand,
  RevokeSubscriptionCommand,
  MyPendingOrdersCommand,
  CreateOrderCommand,
];
