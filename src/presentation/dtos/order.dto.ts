import { UUID } from 'node:crypto';
import {
  CreateOrder,
  Order,
  OrderStatus,
  OrderProcessingSteps,
} from '../../domain/interfaces/order/order.interface';

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
