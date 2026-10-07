import { Controller, Inject, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { IProcessOrderUseCase } from '../../domain/interfaces/order/process-order.use-case';
import { Channel, ConsumeMessage } from 'amqplib';
import { ORDER_CREATED_EVENT } from '../../domain/interfaces/order/order-created.event';
import type { OrderCreatedEvent } from '../../domain/interfaces/order/order-created.event';
import { OrderRetryPublisher } from '../../infrastructure/publishers/order-retry.publisher';
import {
  ORDER_MAX_RETRIES,
  ORDER_RETRY_DELAY_MS,
} from '../../infrastructure/queue.constants';
import {
  ErrorCode,
  InternalServiceError,
} from '../../domain/interfaces/errors';

@Controller()
export class OrderEventsController {
  private readonly logger = new Logger(OrderEventsController.name);

  constructor(
    @Inject(IProcessOrderUseCase)
    private readonly processOrderUseCase: IProcessOrderUseCase,
    private readonly retryPublisher: OrderRetryPublisher,
  ) {}

  @EventPattern(ORDER_CREATED_EVENT)
  async process(
    @Payload() payload: OrderCreatedEvent,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef() as Channel;
    const message = context.getMessage() as ConsumeMessage;

    const retryCount = payload.retryCount ?? 0;

    this.logger.log({
      event: 'order.message.received',
      orderId: payload.orderId,
      retryCount,
      redelivered: message.fields.redelivered,
    });
    try {
      await this.processOrderUseCase.execute(payload.orderId);

      channel.ack(message);
      this.logger.log({
        event: 'order.message.acknowledged',
        orderId: payload.orderId,
      });
    } catch (error) {
      const errorCode =
        error instanceof InternalServiceError ? error.errorCode : undefined;
      if (
        errorCode &&
        [
          ErrorCode.NOT_FOUND,
          ErrorCode.BAD_REQUEST,
          ErrorCode.PAYMENT_FAILED,
          ErrorCode.INSUFFICIENT_FUNDS_ACCOUNT_ERROR,
        ].includes(errorCode)
      ) {
        this.logger.warn({
          event: 'order.message.discarded',
          orderId: payload.orderId,
          retryCount,
          reason: errorCode,
        });
        channel.ack(message);
        return;
      }
      if (retryCount >= ORDER_MAX_RETRIES) {
        this.logger.error({
          event: 'order.retry.exhausted',
          orderId: payload.orderId,
          retryCount,
          errorCode,
        });
        channel.ack(message);
        return;
      }
      try {
        await this.retryPublisher.publish({
          orderId: payload.orderId,
          retryCount: retryCount + 1,
        });
      } catch {
        this.logger.error({
          event: 'order.retry.publication.failed',
          orderId: payload.orderId,
          retryCount,
        });
        try {
          channel.nack(message, false, true);
        } catch {
          this.logger.warn({
            event: 'order.message.connection.lost',
            orderId: payload.orderId,
          });
        }
        return;
      }
      this.logger.log({
        event: 'order.retry.scheduled',
        orderId: payload.orderId,
        retryCount: retryCount + 1,
        delayMs: ORDER_RETRY_DELAY_MS,
      });
      channel.ack(message);
    }
  }
}
