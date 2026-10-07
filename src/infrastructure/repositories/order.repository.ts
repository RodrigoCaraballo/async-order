import { IOrderRepository } from '../../domain/interfaces/order/order.repository';
import {
  CreateOrder,
  ListOrdersQuery,
  Order,
  OrderPage,
  OrderProcessingSteps,
  OrderStatus,
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

  findById(id: string): Promise<Order | null> {
    return this.repository.findOneBy({ id });
  }

  async findAll(query: ListOrdersQuery): Promise<OrderPage> {
    const [items, total] = await this.repository.findAndCount({
      where: query.status ? { status: query.status } : {},
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return { items, total, page: query.page, limit: query.limit };
  }

  async updateStartProcessing(id: string): Promise<Order | null> {
    const order = await this.findById(id);
    if (!order) {
      return null;
    }

    if (order.status !== OrderStatus.PENDING) {
      return null;
    }

    order.status = OrderStatus.PROCESSING;
    order.processingStep = OrderProcessingSteps.PROCESSING_STARTED;
    const result = await this.repository.update(
      {
        id,
        status: OrderStatus.PENDING,
        processingStep: OrderProcessingSteps.PENDING_CREATED,
      },
      {
        status: OrderStatus.PROCESSING,
        processingStep: OrderProcessingSteps.PROCESSING_STARTED,
      },
    );

    if (result.affected !== 1) {
      return null;
    }

    return order;
  }

  async updateOrderStatus(
    order: Order,
    update: Pick<Order, 'status' | 'processingStep'>,
  ): Promise<Order | null> {
    const { id, status, processingStep } = order;
    order.status = update.status;
    order.processingStep = update.processingStep;

    const result = await this.repository.update(
      {
        id,
        status,
        processingStep,
      },
      {
        status: update.status,
        processingStep: update.processingStep,
      },
    );

    if (result.affected !== 1) {
      return null;
    }

    return order;
  }

  async cancelPending(id: string): Promise<boolean> {
    const result = await this.repository.update(
      {
        id,
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
