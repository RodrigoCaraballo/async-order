import { CreateOrder, Order } from './order.interface';

export interface IOrderRepository {
  createOrder(order: CreateOrder): Promise<Order>;
  lookUpIdempotence(idempotencyId: string): Promise<Order | null>;
  lookUpActiveOrder(userId: string): Promise<Order | null>;
}

export const IOrderRepository = Symbol('IOrderRepository');
