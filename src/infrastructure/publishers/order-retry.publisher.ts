import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import {
  ORDER_CREATED_EVENT,
  OrderCreatedEvent,
} from '../../domain/interfaces/order/order-created.event';
import { ORDER_RETRY_QUEUE_CLIENT } from '../queue.constants';

@Injectable()
export class OrderRetryPublisher {
  constructor(
    @Inject(ORDER_RETRY_QUEUE_CLIENT) private readonly client: ClientProxy,
  ) {}

  async publish(payload: OrderCreatedEvent): Promise<void> {
    await lastValueFrom(
      this.client.emit<void, OrderCreatedEvent>(ORDER_CREATED_EVENT, payload),
    );
  }
}
