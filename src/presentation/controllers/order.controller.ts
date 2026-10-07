import {
  Body,
  Controller,
  Inject,
  Post,
  Req,
  UseInterceptors,
  Get,
  Param,
  Query,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import { CreateOrderInterceptor } from '../interceptors/create-order.interceptor';
import type { OrderRequest } from '../interceptors/create-order.interceptor';
import {
  CreateOrderDto,
  CreateOrderResponseDto,
  mapToDomain,
  mapToResponse,
  OrderResponseDto,
  ListOrdersResponseDto,
} from '../dtos/order.dto';
import { ICreateOrderUseCase } from '../../domain/interfaces/order/create-order.use-case';
import { IGetOrderUseCase } from '../../domain/interfaces/order/get-order.use-case';
import { IListOrdersUseCase } from '../../domain/interfaces/order/list-orders.use-case';
import { ICancelOrderUseCase } from '../../domain/interfaces/order/cancel-order.use-case';
import type { CancelOrderResult } from '../../domain/interfaces/order/cancel-order.use-case';
import { OrderStatus } from '../../domain/interfaces/order/order.interface';
import { UserId } from '../decorators/user-id.decorator';

@Controller('orders')
export class OrderController {
  constructor(
    @Inject(ICreateOrderUseCase)
    private readonly createOrderUseCase: ICreateOrderUseCase,
    @Inject(IGetOrderUseCase)
    private readonly getOrderUseCase: IGetOrderUseCase,
    @Inject(IListOrdersUseCase)
    private readonly listOrdersUseCase: IListOrdersUseCase,
    @Inject(ICancelOrderUseCase)
    private readonly cancelOrderUseCase: ICancelOrderUseCase,
  ) {}

  @Post()
  @UseInterceptors(CreateOrderInterceptor)
  public async createOrder(
    @Body() createOrderDTO: CreateOrderDto,
    @Req() request: OrderRequest,
  ): Promise<CreateOrderResponseDto> {
    const orderId = await this.createOrderUseCase.execute(
      mapToDomain(createOrderDTO),
      request.idempotencyKey,
      request.traceId,
    );

    return {
      orderId,
      status: 'pending',
    };
  }

  @Get(':id')
  async getOrder(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UserId(new ParseUUIDPipe()) userId: string,
  ): Promise<OrderResponseDto> {
    return mapToResponse(await this.getOrderUseCase.execute(id, userId));
  }

  @Get()
  async listOrders(
    @UserId(new ParseUUIDPipe()) userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status?: string,
  ): Promise<ListOrdersResponseDto> {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger((page - 1) * limit)
    ) {
      throw new BadRequestException(
        'page must be positive and limit must be between 1 and 100',
      );
    }
    if (
      status !== undefined &&
      !Object.values(OrderStatus).includes(status as OrderStatus)
    ) {
      throw new BadRequestException('Invalid order status');
    }
    const result = await this.listOrdersUseCase.execute(userId, {
      page,
      limit,
      status: status as OrderStatus | undefined,
    });
    return { ...result, items: result.items.map(mapToResponse) };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancelOrder(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UserId(new ParseUUIDPipe()) userId: string,
  ): Promise<CancelOrderResult> {
    return this.cancelOrderUseCase.execute(id, userId);
  }
}
