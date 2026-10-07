import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { IOrderPublisher } from '../../domain/interfaces/order/order.publisher';
import { ORDER_QUEUE_CLIENT } from '../queue.constants';

import {
  ORDER_CREATED_EVENT,
  OrderCreatedEvent,
} from '../../domain/interfaces/order/order-created.event';
export { ORDER_CREATED_EVENT } from '../../domain/interfaces/order/order-created.event';

@Injectable()
export class OrderRabbitMqPublisher implements IOrderPublisher {
  constructor(
    @Inject(ORDER_QUEUE_CLIENT) private readonly client: ClientProxy,
  ) {}

  async publish(orderId: string): Promise<void> {
    await lastValueFrom(
      this.client.emit<void, OrderCreatedEvent>(ORDER_CREATED_EVENT, {
        orderId,
        retryCount: 0,
      }),
    );
  }
}
