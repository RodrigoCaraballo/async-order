import { Order } from './order.interface';

export interface IGetOrderUseCase {
  execute(id: string): Promise<Order>;
}

export const IGetOrderUseCase = Symbol('IGetOrderUseCase');
