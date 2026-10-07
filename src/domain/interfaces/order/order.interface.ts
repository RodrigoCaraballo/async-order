export interface Order {
  id: string;
  idempotencyKey: string;
  userId: string;
  accountId: string;
  amount: number;
  currency: string;
  status: OrderStatus;
  processingStep: OrderProcessingSteps;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateOrder = Omit<
  Order,
  | 'id'
  | 'idempotencyKey'
  | 'status'
  | 'processingStep'
  | 'createdAt'
  | 'updatedAt'
>;

export enum OrderStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  PAID = 'PAID',
  FAILED = 'FAILED',
  CANCELED = 'CANCELLED',
}

export enum OrderProcessingSteps {
  PENDING_CREATED = 'PENDING_CREATED',
  PROCESSING_STARTED = 'PROCESSING_STARTED',
  PROCESSING_ACCOUNT_VALIDATED = 'PROCESSING_ACCOUNT_VALIDATED',
  PROCESSING_ACCOUNT_DEBITED = 'PROCESSING_ACCOUNT_DEBITED',
  PROCESSING_PAYMENT_REQUESTED = 'PROCESSING_PAYMENT_REQUESTED',
  PROCESSING_PAYMENT_CONFIRMED = 'PROCESSING_PAYMENT_CONFIRMED',
  PAID_COMPLETED = 'PAID_COMPLETED',
  FAILED_INSUFFICIENT_FUNDS = 'FAILED_INSUFFICIENT_FUNDS',
  FAILED_PAYMENT = 'FAILED_PAYMENT',
  CANCELLED_BY_USER = 'CANCELLED_BY_USER',
}