import {
  CreateOrder,
  Order,
  ListOrdersQuery,
  OrderPage,
} from './order.interface';

export interface IOrderRepository {
  createOrder(order: CreateOrder): Promise<Order>;
  lookUpIdempotence(idempotencyId: string): Promise<Order | null>;
  findById(id: string, userId: string): Promise<Order | null>;
  findAll(userId: string, query: ListOrdersQuery): Promise<OrderPage>;
  cancelPending(id: string, userId: string): Promise<boolean>;
}

export const IOrderRepository = Symbol('IOrderRepository');
