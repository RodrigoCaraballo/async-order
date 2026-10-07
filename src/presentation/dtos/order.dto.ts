import { UUID } from 'node:crypto';
import { CreateOrder } from '../../domain/interfaces/order/order.interface';

export class CreateOrderDto {
  userId: UUID;
  accountId: UUID;
  amount: number;
  currency: string;
}

export class CreateOrderResponseDto {
  orderId: string;
  status = 'pending';
}

export function mapToDomain(dto: CreateOrderDto): CreateOrder {
  return {
    userId: dto.userId,
    accountId: dto.accountId,
    amount: dto.amount,
    currency: dto.currency,
  };
}
