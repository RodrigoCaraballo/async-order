import { Logger } from '@nestjs/common';
import { CreateOrderUseCase } from './create-order.use-case';
import { ErrorCode, InternalServiceError } from '../interfaces/errors';
import { OrderStatus } from '../interfaces/order/order.interface';

describe('CreateOrderUseCase request context', () => {
  const order = {
    userId: 'user',
    accountId: 'account',
    amount: 10,
    currency: 'USD',
  };
  const orders = {
    lookUpIdempotence: jest.fn(),
    createOrder: jest.fn(),
    findById: jest.fn(),
    findAll: jest.fn(),
    cancelPending: jest.fn(),
  };
  const accounts = { findById: jest.fn() };
  const publisher = { publish: jest.fn() };
  let useCase: CreateOrderUseCase;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    orders.lookUpIdempotence.mockResolvedValue(null);
    orders.createOrder.mockResolvedValue({ id: 'new-order' });
    accounts.findById.mockResolvedValue({ id: 'account' });
    useCase = new CreateOrderUseCase(orders, accounts, publisher);
  });

  afterEach(() => jest.restoreAllMocks());

  it('persists the generated key and uses the supplied trace in logs', async () => {
    await expect(
      useCase.execute(order, 'body-hash', 'request-trace'),
    ).resolves.toBe('new-order');
    expect(orders.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'body-hash' }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: 'request-trace' }),
    );
    expect(publisher.publish).toHaveBeenCalledWith('new-order');
  });

  it.each([OrderStatus.PENDING, OrderStatus.PROCESSING])(
    'rejects an identical %s order after the interceptor TTL',
    async (status) => {
      orders.lookUpIdempotence.mockResolvedValue({ id: 'existing', status });
      await expect(
        useCase.execute(order, 'body-hash', 'trace'),
      ).rejects.toEqual(
        new InternalServiceError(
          'An identical order is still being processed',
          ErrorCode.CONFLICT,
        ),
      );
      expect(orders.createOrder).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
    },
  );

  it('allows a payment when no active order matches its key', async () => {
    await expect(useCase.execute(order, 'body-hash', 'trace')).resolves.toBe(
      'new-order',
    );
  });

  it('allows different payments for the same user concurrently', async () => {
    orders.createOrder
      .mockResolvedValueOnce({ id: 'first-order' })
      .mockResolvedValueOnce({ id: 'second-order' });

    await expect(
      Promise.all([
        useCase.execute(order, 'first-body-hash', 'first-trace'),
        useCase.execute(
          { ...order, amount: 20 },
          'second-body-hash',
          'second-trace',
        ),
      ]),
    ).resolves.toEqual(['first-order', 'second-order']);
    expect(orders.createOrder).toHaveBeenCalledTimes(2);
    expect(publisher.publish).toHaveBeenCalledTimes(2);
  });
});
