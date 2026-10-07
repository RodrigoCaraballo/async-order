import type { UUID } from 'node:crypto';
import { IsUUID, IsNumber, IsPositive, Max, Matches } from 'class-validator';
import {
  CreateOrder,
  Order,
  OrderStatus,
  OrderProcessingSteps,
} from '../../domain/interfaces/order/order.interface';

export class CreateOrderDto {
  @IsUUID()
  userId: UUID;
  @IsUUID()
  accountId: UUID;
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @IsPositive()
  @Max(9_999_999_999.99)
  amount: number;
  @Matches(/^[A-Z]{3}$/, {
    message: 'currency must be three uppercase letters',
  })
  currency: string;
}

export class CreateOrderResponseDto {
  orderId: string;
  status = 'pending';
}

export class OrderResponseDto {
  id: string;
  accountId: string;
  status: OrderStatus;
  processingStep: OrderProcessingSteps;
  amount: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export class ListOrdersResponseDto {
  items: OrderResponseDto[];
  page: number;
  limit: number;
  total: number;
}

export function mapToResponse(order: Order): OrderResponseDto {
  return {
    id: order.id,
    accountId: order.accountId,
    status: order.status,
    processingStep: order.processingStep,
    amount: Number(order.amount),
    currency: order.currency,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

export function mapToDomain(dto: CreateOrderDto): CreateOrder {
  return {
    userId: dto.userId,
    accountId: dto.accountId,
    amount: dto.amount,
    currency: dto.currency,
  };
}
