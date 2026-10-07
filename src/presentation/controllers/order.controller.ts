import {
  Body,
  Controller,
  Inject,
  Post,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { CreateOrderInterceptor } from '../interceptors/create-order.interceptor';
import type { OrderRequest } from '../interceptors/create-order.interceptor';
import {
  CreateOrderDto,
  CreateOrderResponseDto,
  mapToDomain,
} from '../dtos/order.dto';
import { ICreateOrderUseCase } from '../../domain/interfaces/order/create-order.use-case';

@Controller('orders')
export class OrderController {
  constructor(
    @Inject(ICreateOrderUseCase)
    private readonly createOrderUseCase: ICreateOrderUseCase,
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
}
