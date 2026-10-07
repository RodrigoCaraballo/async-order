import { Module } from '@nestjs/common';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { CreateOrderUseCase } from './application/create-order.use-case';
import { ICreateOrderUseCase } from './interfaces/order/create-order.use-case';

@Module({
  imports: [InfrastructureModule],
  providers: [{ useClass: CreateOrderUseCase, provide: ICreateOrderUseCase }],
  exports: [ICreateOrderUseCase],
})
export class DomainModule {}