import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class FakeAuthorizationGuard implements CanActivate {
  private readonly uuidPipe = new ParseUUIDPipe();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    await this.uuidPipe.transform(request.get('X-User-Id') ?? '', {
      type: 'custom',
    });
    return true;
  }
}
