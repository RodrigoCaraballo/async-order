import { ListOrdersQuery, OrderPage } from './order.interface';

export interface IListOrdersUseCase {
  execute(query: ListOrdersQuery): Promise<OrderPage>;
}

export const IListOrdersUseCase = Symbol('IListOrdersUseCase');
