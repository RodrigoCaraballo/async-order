import {
  CallHandler,
  ConflictException,
  ExecutionContext,
} from '@nestjs/common';
import { of, throwError } from 'rxjs';
import {
  CreateOrderInterceptor,
  OrderRequest,
} from './create-order.interceptor';

describe('CreateOrderInterceptor', () => {
  let interceptor: CreateOrderInterceptor;
  const handle = jest.fn(() => of('order'));
  const next: CallHandler = { handle };

  function requestContext(body: unknown) {
    const request = { body } as OrderRequest;
    const setHeader = jest.fn();
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ setHeader }),
      }),
    } as unknown as ExecutionContext;
    return { request, context, setHeader };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    interceptor = new CreateOrderInterceptor();
  });

  afterEach(() => {
    interceptor.onModuleDestroy();
    jest.useRealTimers();
  });

  it('generates a trace and rejects an identical body regardless of key order', () => {
    const first = requestContext({
      userId: 'a',
      payment: { amount: 10, currency: 'USD' },
    });
    const second = requestContext({
      payment: { currency: 'USD', amount: 10 },
      userId: 'a',
    });
    interceptor.intercept(first.context, next);
    expect(first.request.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(first.setHeader).toHaveBeenCalledWith(
      'X-Trace-Id',
      first.request.traceId,
    );
    expect(() => interceptor.intercept(second.context, next)).toThrow(
      ConflictException,
    );
    expect(second.request.idempotencyKey).toBe(first.request.idempotencyKey);
    expect(second.request.traceId).not.toBe(first.request.traceId);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('expires after exactly 10 seconds without extending the TTL on duplicates', () => {
    interceptor.intercept(requestContext({ amount: 10 }).context, next);
    jest.advanceTimersByTime(9999);
    expect(() =>
      interceptor.intercept(requestContext({ amount: 10 }).context, next),
    ).toThrow(ConflictException);
    jest.advanceTimersByTime(1);
    expect(() =>
      interceptor.intercept(requestContext({ amount: 10 }).context, next),
    ).not.toThrow();
    expect(handle).toHaveBeenCalledTimes(2);
  });

  it('allows distinct bodies and clears timers on shutdown', () => {
    interceptor.intercept(requestContext({ amount: 10 }).context, next);
    interceptor.intercept(requestContext({ amount: 20 }).context, next);
    expect(handle).toHaveBeenCalledTimes(2);
    interceptor.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('retains the reservation when the handler fails', () => {
    const error = new Error('Publication failed');
    const onError = jest.fn();
    handle.mockReturnValueOnce(throwError(() => error));
    interceptor
      .intercept(requestContext({ amount: 10 }).context, next)
      .subscribe({ error: onError });
    expect(onError).toHaveBeenCalledWith(error);
    expect(() =>
      interceptor.intercept(requestContext({ amount: 10 }).context, next),
    ).toThrow(ConflictException);
  });
});
