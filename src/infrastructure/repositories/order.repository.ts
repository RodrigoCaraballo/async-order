import { IOrderRepository } from '../../domain/interfaces/order/order.repository';
import {
  CreateOrder,
  Order,
  OrderStatus,
} from '../../domain/interfaces/order/order.interface';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OrderEntity } from '../entities/order.entity';
import { In, Repository } from 'typeorm';
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
    return await this.repository.save(created);
  }

  async lookUpActiveOrder(userId: string): Promise<Order | null> {
    return await this.repository.findOneBy({
      userId,
      status: In([OrderStatus.PENDING, OrderStatus.PROCESSING]),
    });
  }

  async lookUpIdempotence(idempotencyKey: string): Promise<Order | null> {
    return await this.repository.findOneBy({ idempotencyKey });
  }
}
