import { Module } from '@nestjs/common';
import { DomainModule } from '../domain/domain.module';
import { OrderController } from './controllers/order.controller';
import { APP_FILTER } from '@nestjs/core';
import { InternalServiceErrorFilter } from './filters/internal-service-error.filter';
import { CreateOrderInterceptor } from './interceptors/create-order.interceptor';

@Module({
  imports: [DomainModule],
  controllers: [OrderController],
  providers: [
    CreateOrderInterceptor,
    { provide: APP_FILTER, useClass: InternalServiceErrorFilter },
  ],
})
export class PresentationModule {}
