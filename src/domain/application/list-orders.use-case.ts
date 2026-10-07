import { Inject, Injectable } from '@nestjs/common';
import { IOrderRepository } from '../interfaces/order/order.repository';
import { IListOrdersUseCase } from '../interfaces/order/list-orders.use-case';
import {
  ListOrdersQuery,
  OrderPage,
} from '../interfaces/order/order.interface';

@Injectable()
export class ListOrdersUseCase implements IListOrdersUseCase {
  constructor(
    @Inject(IOrderRepository) private readonly orders: IOrderRepository,
  ) {}

  execute(query: ListOrdersQuery): Promise<OrderPage> {
    return this.orders.findAll(query);
  }
}
