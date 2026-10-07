import { Module } from '@nestjs/common';
import { DatabaseModule } from './database.module';
import { QueueModule } from './queue.module';
import { OrderTypeOrmRepository } from './repositories/order.repository';
import { IOrderRepository } from '../domain/interfaces/order/order.repository';
import { AccountTypeOrmRepository } from './repositories/account.repository';
import { IAccountRepository } from '../domain/interfaces/account/account.repository';
import { IOrderPublisher } from '../domain/interfaces/order/order.publisher';
import { OrderRabbitMqPublisher } from './publishers/order.publisher';

@Module({
  imports: [DatabaseModule, QueueModule],
  providers: [
    { useClass: OrderTypeOrmRepository, provide: IOrderRepository },
    { useClass: AccountTypeOrmRepository, provide: IAccountRepository },
    { useClass: OrderRabbitMqPublisher, provide: IOrderPublisher },
  ],
  exports: [IOrderRepository, IAccountRepository, IOrderPublisher],
})
export class InfrastructureModule {}
