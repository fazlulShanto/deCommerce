import PingCommand from './utility/ping';
import ServerInfoCommand from './utility/server-info';
import BuyCommand from './sales/buy';
import AddProductsCommand from './products/addProducts';
import ListProductsCommand from './products/listProducts';
import { DeleteProductCommand } from './products/deleteProduct';
import { UpdateProductCommand } from './products/updateProduct';
import ProductDetailsCommand from './products/productDetails';
export const botCommands = [
  PingCommand,
  ServerInfoCommand,
  BuyCommand,
  AddProductsCommand,
  ListProductsCommand,
  DeleteProductCommand,
  UpdateProductCommand,
  ProductDetailsCommand,
];
