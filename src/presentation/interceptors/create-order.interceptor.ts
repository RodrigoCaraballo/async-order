import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  OnModuleDestroy,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';

export interface OrderRequest extends Request {
  traceId: string;
  idempotencyKey: string;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

@Injectable()
export class CreateOrderInterceptor
  implements NestInterceptor, OnModuleDestroy
{
  private readonly requests = new Map<string, NodeJS.Timeout>();
  private readonly ttlMs = 10_000;

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<OrderRequest>();
    request.traceId = randomUUID();
    http.getResponse<Response>().setHeader('X-Trace-Id', request.traceId);
    request.idempotencyKey = createHash('sha256')
      .update(canonicalJson(request.body))
      .digest('hex');

    if (this.requests.has(request.idempotencyKey)) {
      throw new ConflictException('An identical request was recently received');
    }

    const timer = setTimeout(() => {
      this.requests.delete(request.idempotencyKey);
    }, this.ttlMs);
    timer.unref();
    this.requests.set(request.idempotencyKey, timer);
    return next.handle();
  }

  onModuleDestroy(): void {
    for (const timer of this.requests.values()) clearTimeout(timer);
    this.requests.clear();
  }
}
