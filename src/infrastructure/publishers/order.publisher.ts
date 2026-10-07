import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { IOrderPublisher } from '../../domain/interfaces/order/order.publisher';
import { ORDER_QUEUE_CLIENT } from '../queue.module';

export const ORDER_CREATED_EVENT = 'order.created';

@Injectable()
export class OrderRabbitMqPublisher implements IOrderPublisher {
  constructor(
    @Inject(ORDER_QUEUE_CLIENT) private readonly client: ClientProxy,
  ) {}

  async publish(orderId: string): Promise<void> {
    await lastValueFrom(
      this.client.emit<void, { orderId: string }>(ORDER_CREATED_EVENT, {
        orderId,
      }),
    );
  }
}
