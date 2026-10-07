import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { SchemaValidator } from './schema-validator';

describe('SchemaValidator', () => {
  const log = jest.fn();
  const createSchemaBuilder = jest.fn(() => ({ log }));
  let validator: SchemaValidator;

  beforeEach(async () => {
    log.mockReset();
    createSchemaBuilder.mockClear();
    const module = await Test.createTestingModule({
      providers: [
        SchemaValidator,
        {
          provide: DataSource,
          useValue: { driver: { createSchemaBuilder } },
        },
      ],
    }).compile();
    validator = module.get(SchemaValidator);
  });

  it('allows startup when TypeORM reports no differences', async () => {
    log.mockResolvedValue({ upQueries: [], downQueries: [] });

    await expect(validator.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('rejects startup and includes the proposed SQL when schemas differ', async () => {
    log.mockResolvedValue({
      upQueries: [
        { query: 'ALTER TABLE orders ADD processing_step VARCHAR(50)' },
        { query: 'ALTER TABLE accounts ADD version BIGINT' },
      ],
      downQueries: [],
    });

    await expect(validator.onApplicationBootstrap()).rejects.toThrow(
      'SQL propuesto (no ejecutado):\n' +
        'ALTER TABLE orders ADD processing_step VARCHAR(50)\n' +
        'ALTER TABLE accounts ADD version BIGINT',
    );
  });

  it('propagates schema inspection errors instead of allowing startup', async () => {
    const error = new Error('Schema inspection failed');
    log.mockRejectedValue(error);

    await expect(validator.onApplicationBootstrap()).rejects.toBe(error);
  });
});
