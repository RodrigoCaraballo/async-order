import { Logger } from '@nestjs/common';
import { CreateOrderUseCase } from './create-order.use-case';
import {
  OrderStatus,
  OrderProcessingSteps,
} from '../interfaces/order/order.interface';
import { InternalServiceError } from '../interfaces/errors';

describe('CreateOrderUseCase observation', () => {
  const order = {
    userId: 'user-123',
    accountId: 'account-123',
    amount: 10,
    currency: 'USD',
  };
  const persisted = {
    ...order,
    id: 'order-123',
    idempotencyKey: 'private-key',
    status: OrderStatus.PENDING,
    statusStep: OrderProcessingSteps.PENDING_CREATED,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const repository = {
    lookUpIdempotence: jest.fn(),
    lookUpActiveOrder: jest.fn(),
    createOrder: jest.fn(),
  };
  const accounts = { findById: jest.fn() };
  const publisher = { publish: jest.fn() };
  let useCase: CreateOrderUseCase;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    repository.lookUpIdempotence.mockResolvedValue(null);
    repository.lookUpActiveOrder.mockResolvedValue(null);
    repository.createOrder.mockResolvedValue(persisted);
    accounts.findById.mockResolvedValue({ id: order.accountId });
    publisher.publish.mockResolvedValue(undefined);
    useCase = new CreateOrderUseCase(repository, accounts, publisher);
  });

  afterEach(() => jest.restoreAllMocks());

  it('correlates successful creation milestones without logging private input', async () => {
    await expect(useCase.execute(order, 'private-key')).resolves.toBe(
      persisted.id,
    );

    const logs = logSpy.mock.calls;
    expect(logs.map(([entry]) => (entry as { event: string }).event)).toEqual([
      'order.creation.started',
      'order.creation.validated',
      'order.persisted',
      'order.creation.completed',
    ]);
    const traceIds = logs.map(
      ([entry]) => (entry as { traceId: string }).traceId,
    );
    expect(new Set(traceIds).size).toBe(1);
    expect(traceIds[0]).toEqual(expect.any(String));
    expect(JSON.stringify(logs)).not.toContain('private-key');
    expect(JSON.stringify(logs)).not.toContain(order.accountId);
    expect(publisher.publish).toHaveBeenCalledWith(persisted.id);
  });

  it('observes idempotent reuse without creating or publishing again', async () => {
    repository.lookUpIdempotence.mockResolvedValue(persisted);

    await expect(useCase.execute(order, 'private-key')).resolves.toBe(
      persisted.id,
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'order.creation.reused',
        orderId: persisted.id,
      }),
    );
    expect(repository.createOrder).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('logs a rejected validation as a warning', async () => {
    accounts.findById.mockResolvedValue(null);

    await expect(useCase.execute(order, 'private-key')).rejects.toBeInstanceOf(
      InternalServiceError,
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'order.creation.rejected',
        stage: 'validation',
      }),
    );
    expect(repository.createOrder).not.toHaveBeenCalled();
  });

  it('marks publication failures for recovery and preserves the original error', async () => {
    const error = new Error('Sensitive broker connection details');
    publisher.publish.mockRejectedValue(error);

    await expect(useCase.execute(order, 'private-key')).rejects.toBe(error);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'order.creation.failed',
        stage: 'publication',
        orderId: persisted.id,
        publicationRecoveryRequired: true,
      }),
    );
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(error.message);
  });
});
