import { IOrderRepository } from '../../domain/interfaces/order/order.repository';
import {
  CreateOrder,
  Order,
  OrderStatus,
  OrderProcessingSteps,
  ListOrdersQuery,
  OrderPage,
} from '../../domain/interfaces/order/order.interface';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OrderEntity } from '../entities/order.entity';
import { In, QueryFailedError, Repository } from 'typeorm';
import {
  ErrorCode,
  InternalServiceError,
} from '../../domain/interfaces/errors';
import { v4 as uuid4 } from 'uuid';

@Injectable()
export class OrderTypeOrmRepository implements IOrderRepository {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly repository: Repository<OrderEntity>,
  ) {}

  async createOrder(order: CreateOrder): Promise<Order> {
    const created = this.repository.create({
      id: uuid4(),
      ...order,
    });
    try {
      return await this.repository.save(created);
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const driverError = error.driverError as {
          code?: string;
          constraint?: string;
        };
        if (
          driverError.code === '23505' &&
          driverError.constraint === 'unique_active_order_idempotency_key'
        ) {
          throw new InternalServiceError(
            'An identical order is still being processed',
            ErrorCode.CONFLICT,
          );
        }
      }
      throw error;
    }
  }

  async lookUpIdempotence(idempotencyKey: string): Promise<Order | null> {
    return await this.repository.findOneBy({
      idempotencyKey,
      status: In([OrderStatus.PENDING, OrderStatus.PROCESSING]),
    });
  }

  findById(id: string, userId: string): Promise<Order | null> {
    return this.repository.findOneBy({ id, userId });
  }

  async findAll(userId: string, query: ListOrdersQuery): Promise<OrderPage> {
    const [items, total] = await this.repository.findAndCount({
      where: { userId, ...(query.status ? { status: query.status } : {}) },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return { items, total, page: query.page, limit: query.limit };
  }

  async cancelPending(id: string, userId: string): Promise<boolean> {
    // The condition and transition happen in one UPDATE, so a concurrent worker
    // that already claimed the order prevents cancellation.
    const result = await this.repository.update(
      {
        id,
        userId,
        status: OrderStatus.PENDING,
        processingStep: OrderProcessingSteps.PENDING_CREATED,
      },
      {
        status: OrderStatus.CANCELED,
        processingStep: OrderProcessingSteps.CANCELLED_BY_USER,
      },
    );
    return result.affected === 1;
  }
}
