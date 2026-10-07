import { Module } from '@nestjs/common';
import { DomainModule } from '../domain/domain.module';
import { OrderController } from './controllers/order.controller';
import { APP_FILTER } from '@nestjs/core';
import { InternalServiceErrorFilter } from './filters/internal-service-error.filter';
import { CreateOrderInterceptor } from './interceptors/create-order.interceptor';
import { FakeAuthorizationGuard } from './guards/fake-authorization.guard';
import { OrderEventsController } from './controllers/order-events.controller';
import { QueueModule } from '../infrastructure/queue.module';

@Module({
  imports: [DomainModule, QueueModule],
  controllers: [OrderController, OrderEventsController],
  providers: [
    FakeAuthorizationGuard,
    CreateOrderInterceptor,
    { provide: APP_FILTER, useClass: InternalServiceErrorFilter },
  ],
})
export class PresentationModule {}
