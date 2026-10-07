import { ICreateOrderUseCase } from '../interfaces/order/create-order.use-case';
import {
  CreateOrder,
  Order,
  OrderStatus,
  OrderProcessingSteps,
} from '../interfaces/order/order.interface';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IOrderRepository } from '../interfaces/order/order.repository';
import { IAccountRepository } from '../interfaces/account/account.repository';
import { ErrorCode, InternalServiceError } from '../interfaces/errors';
import { IOrderPublisher } from '../interfaces/order/order.publisher';

@Injectable()
export class CreateOrderUseCase implements ICreateOrderUseCase {
  private readonly logger = new Logger(CreateOrderUseCase.name);

  constructor(
    @Inject(IOrderRepository) private orderRepository: IOrderRepository,
    @Inject(IAccountRepository) private accountRepository: IAccountRepository,
    @Inject(IOrderPublisher) private publisher: IOrderPublisher,
  ) {}
  async execute(order: CreateOrder, idempotencyKey: string): Promise<string> {
    const traceId = randomUUID();
    const startedAt = Date.now();
    let stage = 'validation';
    let persistedOrderId: string | undefined;

    this.logger.log({ event: 'order.creation.started', traceId });

    try {
      const [lookUpIdempotency] = await Promise.all([
        this.orderRepository.lookUpIdempotence(idempotencyKey),
        this.validateActiveOrder(order.userId),
        this.validateAccount(order.accountId),
      ]);

      this.logger.log({ event: 'order.creation.validated', traceId });

      if (
        lookUpIdempotency &&
        (lookUpIdempotency.status === OrderStatus.PENDING ||
          lookUpIdempotency.status === OrderStatus.PROCESSING)
      ) {
        this.logger.log({
          event: 'order.creation.reused',
          traceId,
          orderId: lookUpIdempotency.id,
          durationMs: Date.now() - startedAt,
        });
        return lookUpIdempotency.id;
      }

      const newOrder: Omit<Order, 'id' | 'createdAt' | 'updatedAt'> = {
        ...order,
        idempotencyKey: idempotencyKey,
        status: OrderStatus.PENDING,
        processingStep: OrderProcessingSteps.PENDING_CREATED,
      };
      stage = 'persistence';
      this.logger.debug({ event: 'order.persistence.started', traceId });
      const result = await this.orderRepository.createOrder(newOrder);
      persistedOrderId = result.id;
      this.logger.log({
        event: 'order.persisted',
        traceId,
        orderId: result.id,
      });

      stage = 'publication';
      this.logger.debug({
        event: 'order.publication.started',
        traceId,
        orderId: result.id,
      });
      await this.publisher.publish(result.id);

      this.logger.log({
        event: 'order.creation.completed',
        traceId,
        orderId: result.id,
        durationMs: Date.now() - startedAt,
      });
      return result.id;
    } catch (error) {
      const context = {
        event:
          error instanceof InternalServiceError
            ? 'order.creation.rejected'
            : 'order.creation.failed',
        traceId,
        stage,
        orderId: persistedOrderId,
        publicationRecoveryRequired:
          stage === 'publication' && persistedOrderId !== undefined,
        durationMs: Date.now() - startedAt,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      };

      // Do not log raw errors: driver/broker messages can contain credentials.
      if (error instanceof InternalServiceError) {
        this.logger.warn(context);
      } else {
        this.logger.error(context);
      }
      throw error;
    }
  }

  private async validateActiveOrder(userId: string): Promise<void> {
    const lookUpActiveOrder =
      await this.orderRepository.lookUpActiveOrder(userId);

    if (lookUpActiveOrder) {
      throw new InternalServiceError(
        'An order is currently active',
        ErrorCode.CONFLICT,
      );
    }
  }

  private async validateAccount(accountId: string): Promise<void> {
    const validAccount = await this.accountRepository.findById(accountId);
    if (!validAccount) {
      throw new InternalServiceError(
        'Provided account does not exist',
        ErrorCode.NOT_FOUND,
      );
    }
  }
}
