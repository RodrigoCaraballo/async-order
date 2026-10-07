import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './infrastructure/database.module';
import { QueueModule } from './infrastructure/queue.module';
import { PresentationModule } from './presentation/presentation.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PresentationModule,
  ],
})
export class AppModule {}
