import { IProcessOrderUseCase } from '../interfaces/order/process-order.use-case';
import { Inject, Logger } from '@nestjs/common';
import { IOrderRepository } from '../interfaces/order/order.repository';
import { IAccountRepository } from '../interfaces/account/account.repository';
import { ErrorCode, InternalServiceError } from '../interfaces/errors';
import {
  Order,
  OrderProcessingSteps,
  OrderStatus,
} from '../interfaces/order/order.interface';

export class ProcessOrderUseCase implements IProcessOrderUseCase {
  private readonly logger = new Logger(ProcessOrderUseCase.name);

  constructor(
    @Inject(IOrderRepository)
    private orderRepository: IOrderRepository,
    @Inject(IAccountRepository)
    private accountRepository: IAccountRepository,
  ) {}
  async execute(orderId: string): Promise<void> {
    const startedAt = Date.now();
    this.logger.log({ event: 'order.processing.started', orderId });
    try {
      const order = await this.orderRepository.findById(orderId);
      if (!order) {
        throw new InternalServiceError('Order not found', ErrorCode.NOT_FOUND);
      }
      await this.processOrder(order);
      this.logger.log({
        event: 'order.processing.completed',
        orderId,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const context = {
        event: 'order.processing.failed',
        orderId,
        durationMs: Date.now() - startedAt,
        errorType: error instanceof Error ? error.name : 'UnknownError',
        errorCode:
          error instanceof InternalServiceError ? error.errorCode : undefined,
      };
      // Driver messages can contain sensitive connection details.
      if (error instanceof InternalServiceError) {
        this.logger.warn(context);
      } else {
        this.logger.error(context);
      }
      throw error;
    }
  }

  private async processOrder(order: Order): Promise<void> {
    this.logger.log({
      event: 'order.processing.step',
      orderId: order.id,
      status: order.status,
      processingStep: order.processingStep,
    });
    switch (order.processingStep) {
      case OrderProcessingSteps.PENDING_CREATED:
        await this.prepareOrder(order);
        break;
      case OrderProcessingSteps.PROCESSING_STARTED:
        await this.validateAccount(order);
        break;
      case OrderProcessingSteps.PROCESSING_ACCOUNT_VALIDATED:
        await this.debitFromAccount(order);
        break;
      case OrderProcessingSteps.PAID_COMPLETED:
      case OrderProcessingSteps.CANCELLED_BY_USER:
      case OrderProcessingSteps.FAILED_INSUFFICIENT_FUNDS:
      case OrderProcessingSteps.FAILED_PAYMENT:
        this.logger.log({
          event: 'order.processing.terminal',
          orderId: order.id,
          status: order.status,
          processingStep: order.processingStep,
        });
        break;
      default:
        throw new InternalServiceError(
          'Unsupported processing order',
          ErrorCode.SERVER_ERROR,
        );
    }
  }

  private async prepareOrder(order: Order): Promise<void> {
    this.logger.log({
      event: 'order.processing.claim.started',
      orderId: order.id,
    });
    const updatedOrder = await this.orderRepository.updateStartProcessing(
      order.id,
    );

    if (!updatedOrder) {
      throw new InternalServiceError(
        'An error occurred during the order update, retrying',
        ErrorCode.RETRY_INCONSISTENT_EVENT,
      );
    }

    await this.processOrder(updatedOrder);
  }

  private async validateAccount(order: Order): Promise<void> {
    this.logger.log({
      event: 'order.account.validation.started',
      orderId: order.id,
      accountId: order.accountId,
    });
    const account = await this.accountRepository.findById(order.accountId);
    if (!account) {
      throw new InternalServiceError('Account not found', ErrorCode.NOT_FOUND);
    }

    const updatedOrder = await this.orderRepository.updateOrderStatus(order, {
      status: order.status,
      processingStep: OrderProcessingSteps.PROCESSING_ACCOUNT_VALIDATED,
    });

    if (!updatedOrder) {
      throw new InternalServiceError(
        'An error occurred during the order update, retrying',
        ErrorCode.RETRY_INCONSISTENT_EVENT,
      );
    }
    await this.processOrder(updatedOrder);
  }

  private async debitFromAccount(order: Order): Promise<void> {
    this.logger.log({
      event: 'order.debit.started',
      orderId: order.id,
      accountId: order.accountId,
    });
    const account = await this.accountRepository.findById(order.accountId);
    if (!account) {
      throw new InternalServiceError('Account not found', ErrorCode.NOT_FOUND);
    }

    let debited: boolean;
    try {
      debited = await this.accountRepository.updateBalance(
        order.accountId,
        account.balance,
        order.amount,
      );
    } catch (error) {
      if (error instanceof InternalServiceError) {
        throw error;
      }
      const failedOrder = await this.orderRepository.updateOrderStatus(order, {
        status: OrderStatus.FAILED,
        processingStep: OrderProcessingSteps.FAILED_PAYMENT,
      });
      if (!failedOrder) {
        throw new InternalServiceError(
          'An error occurred during the order update, retrying',
          ErrorCode.RETRY_INCONSISTENT_EVENT,
        );
      }
      throw new InternalServiceError(
        'Payment failed',
        ErrorCode.PAYMENT_FAILED,
      );
    }

    if (!debited) {
      this.logger.warn({
        event: 'order.debit.insufficient_funds',
        orderId: order.id,
      });
      const failedOrder = await this.orderRepository.updateOrderStatus(order, {
        status: OrderStatus.FAILED,
        processingStep: OrderProcessingSteps.FAILED_INSUFFICIENT_FUNDS,
      });
      if (!failedOrder) {
        throw new InternalServiceError(
          'An error occurred during the order update, retrying',
          ErrorCode.RETRY_INCONSISTENT_EVENT,
        );
      }
      throw new InternalServiceError(
        'Insufficient balance',
        ErrorCode.INSUFFICIENT_FUNDS_ACCOUNT_ERROR,
      );
    }

    this.logger.log({
      event: 'order.debit.completed',
      orderId: order.id,
      accountId: order.accountId,
    });
    this.logger.log({
      event: 'order.payment.finalization.started',
      orderId: order.id,
    });
    const updatedOrder = await this.orderRepository.updateOrderStatus(order, {
      status: OrderStatus.PAID,
      processingStep: OrderProcessingSteps.PAID_COMPLETED,
    });

    if (!updatedOrder) {
      throw new InternalServiceError(
        'An error occurred during the order update, retrying',
        ErrorCode.RETRY_INCONSISTENT_EVENT,
      );
    }

    await this.processOrder(updatedOrder);
  }
}
