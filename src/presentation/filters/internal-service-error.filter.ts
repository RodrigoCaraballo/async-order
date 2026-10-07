import {
  ArgumentsHost,
  Catch,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import {
  ErrorCode,
  InternalServiceError,
} from '../../domain/interfaces/errors';

@Catch(InternalServiceError)
export class InternalServiceErrorFilter extends BaseExceptionFilter {
  catch(exception: InternalServiceError, host: ArgumentsHost): void {
    let httpException;

    switch (exception.errorCode) {
      case ErrorCode.CONFLICT:
        httpException = new ConflictException(exception.message);
        break;
      case ErrorCode.NOT_FOUND:
        httpException = new NotFoundException(exception.message);
        break;
      default:
        httpException = new InternalServerErrorException();
    }

    // Delegate response formatting and adapter handling to Nest.
    super.catch(httpException, host);
  }
}
