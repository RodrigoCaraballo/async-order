export interface IOrderPublisher {
  publish(orderId: string): Promise<void>;
}

export const IOrderPublisher = Symbol('IOrderPublisher');
