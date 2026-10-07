import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  OrderStatus,
  OrderProcessingSteps,
} from '../../domain/interfaces/order/order.interface';
import { AccountEntity } from './account.entity';

@Check(
  'order_status_valid',
  `"status" IN ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED')`,
)
@Check(
  'order_processing_step_valid',
  `"processing_step" IN (
    'PENDING_CREATED',
    'PROCESSING_STARTED',
    'PROCESSING_ACCOUNT_VALIDATED',
    'PROCESSING_ACCOUNT_DEBITED',
    'PROCESSING_PAYMENT_REQUESTED',
    'PROCESSING_PAYMENT_CONFIRMED',
    'PAID_COMPLETED',
    'FAILED_INSUFFICIENT_FUNDS',
    'FAILED_PAYMENT',
    'CANCELLED_BY_USER'
  )`,
)
@Check(
  'order_status_processing_step_consistent',
  `split_part("processing_step", '_', 1) = "status"`,
)
@Index('unique_active_order_per_user', ['userId'], {
  unique: true,
  where: "status IN ('PENDING', 'PROCESSING')",
})
@Entity('orders')
export class OrderEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column({
    name: 'idempotency_key',
    unique: true,
    length: 255,
    nullable: false,
  })
  idempotencyKey: string;

  @Column({
    name: 'user_id',
    type: 'uuid',
    nullable: false,
  })
  userId: string;

  @Column({
    name: 'account_id',
    type: 'uuid',
    nullable: false,
  })
  accountId: string;

  @ManyToOne(() => AccountEntity, {
    nullable: false,
    onDelete: 'NO ACTION',
    onUpdate: 'NO ACTION',
  })
  @JoinColumn({
    name: 'account_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'fk_orders_account',
  })
  account: AccountEntity;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: false,
  })
  amount: number;

  @Column({
    type: 'varchar',
    length: 3,
    nullable: false,
  })
  currency: string;

  @Column({
    type: 'varchar',
    length: 20,
  })
  status: OrderStatus;

  @Column({
    name: 'processing_step',
    type: 'varchar',
    length: 50,
  })
  processingStep: OrderProcessingSteps;

  @CreateDateColumn({ name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', default: () => 'now()' })
  updatedAt: Date;
}
