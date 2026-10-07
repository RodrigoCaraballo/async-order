import { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import request from 'supertest';
import { OrderController } from './order.controller';
import { InternalServiceErrorFilter } from '../filters/internal-service-error.filter';
import { ICreateOrderUseCase } from '../../domain/interfaces/order/create-order.use-case';
import { IGetOrderUseCase } from '../../domain/interfaces/order/get-order.use-case';
import { IListOrdersUseCase } from '../../domain/interfaces/order/list-orders.use-case';
import { ICancelOrderUseCase } from '../../domain/interfaces/order/cancel-order.use-case';
import { IOrderRepository } from '../../domain/interfaces/order/order.repository';
import { GetOrderUseCase } from '../../domain/application/get-order.use-case';
import { ListOrdersUseCase } from '../../domain/application/list-orders.use-case';
import { CancelOrderUseCase } from '../../domain/application/cancel-order.use-case';
import {
  OrderStatus,
  OrderProcessingSteps,
} from '../../domain/interfaces/order/order.interface';

describe('Order query and cancellation endpoints', () => {
  let app: INestApplication;
  const userId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
  const id = 'a27ac10b-84cc-4372-a567-0e02b2c3d111';
  const repository = {
    findById: jest.fn(),
    findAll: jest.fn(),
    cancelPending: jest.fn(),
  };
  const order = {
    id,
    userId,
    idempotencyKey: 'private-key',
    accountId: id,
    amount: '120.50',
    currency: 'USD',
    status: OrderStatus.PENDING,
    processingStep: OrderProcessingSteps.PENDING_CREATED,
    createdAt: new Date('2026-10-06T15:00:00Z'),
    updatedAt: new Date('2026-10-06T15:00:00Z'),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [OrderController],
      providers: [
        { provide: IOrderRepository, useValue: repository },
        { provide: ICreateOrderUseCase, useValue: { execute: jest.fn() } },
        { provide: IGetOrderUseCase, useClass: GetOrderUseCase },
        { provide: IListOrdersUseCase, useClass: ListOrdersUseCase },
        { provide: ICancelOrderUseCase, useClass: CancelOrderUseCase },
        { provide: APP_FILTER, useClass: InternalServiceErrorFilter },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    await app.init();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    repository.findById.mockResolvedValue(order);
    repository.findAll.mockResolvedValue({
      items: [order],
      total: 1,
      page: 1,
      limit: 20,
    });
    repository.cancelPending.mockResolvedValue(true);
  });

  afterAll(async () => app.close());

  it('returns a user-scoped order without exposing its idempotency key', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get(`/orders/${id}`)
      .set('X-User-Id', userId)
      .expect(200);
    expect(repository.findById).toHaveBeenCalledWith(id, userId);
    expect(response.body).toEqual({
      id,
      accountId: id,
      amount: 120.5,
      currency: 'USD',
      status: 'PENDING',
      processingStep: 'PENDING_CREATED',
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    });
  });

  it('lists orders with defaults and forwards pagination and status', async () => {
    await request(app.getHttpServer() as Server)
      .get('/orders')
      .set('X-User-Id', userId)
      .expect(200);
    expect(repository.findAll).toHaveBeenLastCalledWith(userId, {
      page: 1,
      limit: 20,
      status: undefined,
    });
    await request(app.getHttpServer() as Server)
      .get('/orders?page=2&limit=5&status=PAID')
      .set('X-User-Id', userId)
      .expect(200);
    expect(repository.findAll).toHaveBeenLastCalledWith(userId, {
      page: 2,
      limit: 5,
      status: OrderStatus.PAID,
    });
  });

  it.each(['page=0', 'page=abc', 'limit=101', 'limit=-1', 'status=paid'])(
    'rejects invalid query %s',
    async (query) => {
      await request(app.getHttpServer() as Server)
        .get(`/orders?${query}`)
        .set('X-User-Id', userId)
        .expect(400);
      expect(repository.findAll).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, 'invalid'])(
    'rejects missing or invalid user identity (%s)',
    async (header) => {
      const call = request(app.getHttpServer() as Server).get('/orders');
      if (header) call.set('X-User-Id', header);
      await call.expect(400);
      expect(repository.findAll).not.toHaveBeenCalled();
    },
  );

  it('returns 404 for an absent order or one belonging to another user', async () => {
    repository.findById.mockResolvedValue(null);
    await request(app.getHttpServer() as Server)
      .get(`/orders/${id}`)
      .set('X-User-Id', userId)
      .expect(404);
  });

  it('cancels a pending order with the documented response', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post(`/orders/${id}/cancel`)
      .set('X-User-Id', userId)
      .expect(200);
    expect(response.body).toEqual({
      id,
      status: 'CANCELLED',
      processingStep: 'CANCELLED_BY_USER',
    });
    expect(repository.cancelPending).toHaveBeenCalledWith(id, userId);
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('returns 409 if the conditional cancellation loses to a worker', async () => {
    repository.cancelPending.mockResolvedValue(false);
    repository.findById.mockResolvedValue({
      ...order,
      status: OrderStatus.PROCESSING,
    });
    await request(app.getHttpServer() as Server)
      .post(`/orders/${id}/cancel`)
      .set('X-User-Id', userId)
      .expect(409);
  });

  it('returns 404 when cancelling an absent or inaccessible order', async () => {
    repository.cancelPending.mockResolvedValue(false);
    repository.findById.mockResolvedValue(null);
    await request(app.getHttpServer() as Server)
      .post(`/orders/${id}/cancel`)
      .set('X-User-Id', userId)
      .expect(404);
  });

  it('rejects malformed order UUIDs before reaching the repository', async () => {
    await request(app.getHttpServer() as Server)
      .post('/orders/invalid/cancel')
      .set('X-User-Id', userId)
      .expect(400);
    expect(repository.cancelPending).not.toHaveBeenCalled();
  });
});
