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
}
