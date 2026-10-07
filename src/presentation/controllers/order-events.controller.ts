import { Controller, Inject, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { IProcessOrderUseCase } from '../../domain/interfaces/order/process-order.use-case';
import { Channel, ConsumeMessage } from 'amqplib';
import { ORDER_CREATED_EVENT } from '../../infrastructure/publishers/order.publisher';

@Controller()
export class OrderEventsController {
  private readonly logger = new Logger(OrderEventsController.name);

  constructor(
    @Inject(IProcessOrderUseCase)
    private readonly processOrderUseCase: IProcessOrderUseCase,
  ) {}

  @EventPattern(ORDER_CREATED_EVENT)
  async process(
    @Payload() payload: { orderId: string },
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef() as Channel;
    const message = context.getMessage() as ConsumeMessage;

    this.logger.log({
      event: 'order.message.received',
      orderId: payload.orderId,
      redelivered: message.fields.redelivered,
    });
    await this.processOrderUseCase.execute(payload.orderId);

    channel.ack(message);
    this.logger.log({
      event: 'order.message.acknowledged',
      orderId: payload.orderId,
    });
  }
}
