import { Body, Controller, Inject, Post, Headers } from '@nestjs/common';
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
  public async createOrder(
    @Body() createOrderDTO: CreateOrderDto,
    @Headers('idempotencyId') idempotencyId: string,
  ): Promise<CreateOrderResponseDto> {
    const orderId = await this.createOrderUseCase.execute(
      mapToDomain(createOrderDTO),
      idempotencyId,
    );

    return {
      orderId,
      status: 'pending',
    };
  }
}
