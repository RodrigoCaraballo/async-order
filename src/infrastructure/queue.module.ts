import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';

export const ORDER_QUEUE_CLIENT = Symbol('ORDER_QUEUE_CLIENT');

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
    ]),
  ],
  exports: [ClientsModule],
})
export class QueueModule {}
