export interface IProcessOrderUseCase {
  execute(orderId: string): Promise<void>;
}

export const IProcessOrderUseCase = Symbol('IProcessOrderUseCase');
