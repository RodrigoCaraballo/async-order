import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { OrderRetryPublisher } from './publishers/order-retry.publisher';
import {
  ORDER_QUEUE_CLIENT,
  ORDER_RETRY_QUEUE_CLIENT,
  ORDER_RETRY_DELAY_MS,
} from './queue.constants';

export {
  ORDER_QUEUE_CLIENT,
  ORDER_RETRY_QUEUE_CLIENT,
} from './queue.constants';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: ORDER_QUEUE_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.getOrThrow<string>('RABBITMQ_URL')],
            queue: config.get<string>('RABBITMQ_QUEUE', 'orders'),
            queueOptions: { durable: true },
            persistent: true,
          },
        }),
      },
      {
        name: ORDER_RETRY_QUEUE_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => {
          const mainQueue = config.get<string>('RABBITMQ_QUEUE', 'orders');
          const retryQueue = config.get<string>(
            'RABBITMQ_RETRY_QUEUE',
            `${mainQueue}.retry`,
          );
          if (mainQueue === retryQueue) {
            throw new Error('The retry queue must differ from the main queue');
          }
          return {
            transport: Transport.RMQ,
            options: {
              urls: [config.getOrThrow<string>('RABBITMQ_URL')],
              queue: retryQueue,
              queueOptions: {
                durable: true,
                arguments: {
                  'x-message-ttl': ORDER_RETRY_DELAY_MS,
                  'x-dead-letter-exchange': '',
                  'x-dead-letter-routing-key': mainQueue,
                },
              },
              persistent: true,
            },
          };
        },
      },
    ]),
  ],
  providers: [OrderRetryPublisher],
  exports: [ClientsModule, OrderRetryPublisher],
})
export class QueueModule {}
