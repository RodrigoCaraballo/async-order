import { CreateOrder } from './order.interface';

export interface ICreateOrderUseCase {
  execute(
    order: CreateOrder,
    idempotencyKey: string,
    traceId: string,
  ): Promise<string>;
}

export const ICreateOrderUseCase = Symbol('ICreateOrderUseCase');
