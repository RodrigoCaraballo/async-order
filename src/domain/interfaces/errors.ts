export class InternalServiceError extends Error {
  public readonly errorCode: ErrorCode;
  constructor(message: string, errorCode: ErrorCode) {
    super(message);
    this.errorCode = errorCode;
  }
}

export enum ErrorCode {
  CONFLICT = 'CONFLICT',
  NOT_FOUND = 'NOT_FOUND',
  BAD_REQUEST = 'BAD_REQUEST',
  SERVER_ERROR = 'SERVER_ERROR',
  RETRY_INCONSISTENT_EVENT = 'RETRY_INCONSISTENT_EVENT',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  INSUFFICIENT_FUNDS_ACCOUNT_ERROR = 'INSUFFICIENT_FUNDS_ACCOUNT_ERROR',
}
