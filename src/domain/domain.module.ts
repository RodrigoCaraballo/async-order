import { Module } from '@nestjs/common';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { CreateOrderUseCase } from './application/create-order.use-case';
import { ICreateOrderUseCase } from './interfaces/order/create-order.use-case';
import { GetOrderUseCase } from './application/get-order.use-case';
import { ListOrdersUseCase } from './application/list-orders.use-case';
import { CancelOrderUseCase } from './application/cancel-order.use-case';
import { IGetOrderUseCase } from './interfaces/order/get-order.use-case';
import { IListOrdersUseCase } from './interfaces/order/list-orders.use-case';
import { ICancelOrderUseCase } from './interfaces/order/cancel-order.use-case';

@Module({
  imports: [InfrastructureModule],
  providers: [
    { useClass: CreateOrderUseCase, provide: ICreateOrderUseCase },
    { useClass: GetOrderUseCase, provide: IGetOrderUseCase },
    { useClass: ListOrdersUseCase, provide: IListOrdersUseCase },
    { useClass: CancelOrderUseCase, provide: ICancelOrderUseCase },
  ],
  exports: [
    ICreateOrderUseCase,
    IGetOrderUseCase,
    IListOrdersUseCase,
    ICancelOrderUseCase,
  ],
})
export class DomainModule {}
