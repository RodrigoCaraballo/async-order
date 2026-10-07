import {
  CreateOrder,
  Order,
  ListOrdersQuery,
  OrderPage,
} from './order.interface';

export interface IOrderRepository {
  createOrder(order: CreateOrder): Promise<Order>;
  lookUpIdempotence(idempotencyId: string): Promise<Order | null>;
  findById(id: string): Promise<Order | null>;
  findAll(query: ListOrdersQuery): Promise<OrderPage>;
  updateStartProcessing(id: string): Promise<Order | null>;
  updateOrderStatus(
    order: Order,
    update: Pick<Order, 'status' | 'processingStep'>,
  ): Promise<Order | null>;
  cancelPending(id: string): Promise<boolean>;
}

export const IOrderRepository = Symbol('IOrderRepository');
