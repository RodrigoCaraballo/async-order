import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, InternalServiceError } from '../interfaces/errors';
import { IOrderRepository } from '../interfaces/order/order.repository';
import {
  ICancelOrderUseCase,
  CancelOrderResult,
} from '../interfaces/order/cancel-order.use-case';
import {
  OrderStatus,
  OrderProcessingSteps,
} from '../interfaces/order/order.interface';

@Injectable()
export class CancelOrderUseCase implements ICancelOrderUseCase {
  constructor(
    @Inject(IOrderRepository) private readonly orders: IOrderRepository,
  ) {}

  async execute(id: string, userId: string): Promise<CancelOrderResult> {
    if (await this.orders.cancelPending(id, userId)) {
      return {
        id,
        status: OrderStatus.CANCELED,
        processingStep: OrderProcessingSteps.CANCELLED_BY_USER,
      };
    }
    if (!(await this.orders.findById(id, userId))) {
      throw new InternalServiceError('Order not found', ErrorCode.NOT_FOUND);
    }
    throw new InternalServiceError(
      'Only pending orders can be cancelled',
      ErrorCode.CONFLICT,
    );
  }
}
