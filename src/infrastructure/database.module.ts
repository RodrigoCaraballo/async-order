import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { OrderEntity } from './entities/order.entity';
import { AccountEntity } from './entities/account.entity';
import { SchemaValidator } from './schema-validator';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('DATABASE_URL'),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature([OrderEntity, AccountEntity]),
  ],
  providers: [SchemaValidator],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
