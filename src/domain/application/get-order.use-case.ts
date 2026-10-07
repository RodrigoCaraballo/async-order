import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, InternalServiceError } from '../interfaces/errors';
import { IOrderRepository } from '../interfaces/order/order.repository';
import { IGetOrderUseCase } from '../interfaces/order/get-order.use-case';
import { Order } from '../interfaces/order/order.interface';

@Injectable()
export class GetOrderUseCase implements IGetOrderUseCase {
  constructor(
    @Inject(IOrderRepository) private readonly orders: IOrderRepository,
  ) {}

  async execute(id: string, userId: string): Promise<Order> {
    const order = await this.orders.findById(id, userId);
    if (!order) {
      throw new InternalServiceError('Order not found', ErrorCode.NOT_FOUND);
    }
    return order;
  }
}
