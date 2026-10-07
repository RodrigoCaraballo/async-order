import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class SchemaValidator implements OnApplicationBootstrap {
  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    // Calculate the schema diff without executing synchronization queries.
    const changes = await this.dataSource.driver.createSchemaBuilder().log();

    if (changes.upQueries.length > 0) {
      const sql = changes.upQueries.map(({ query }) => query).join('\n');
      throw new Error(
        `Las entidades no coinciden con PostgreSQL. SQL propuesto (no ejecutado):\n${sql}`,
      );
    }
  }
}
