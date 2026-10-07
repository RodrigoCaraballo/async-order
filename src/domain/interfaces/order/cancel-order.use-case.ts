import { Order } from './order.interface';

export type CancelOrderResult = Pick<Order, 'id' | 'status' | 'processingStep'>;

export interface ICancelOrderUseCase {
  execute(id: string, userId: string): Promise<CancelOrderResult>;
}

export const ICancelOrderUseCase = Symbol('ICancelOrderUseCase');
