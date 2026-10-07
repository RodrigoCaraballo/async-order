import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Check('account_balance_non_negative', '"balance" >= 0')
@Entity('accounts')
export class AccountEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: false,
  })
  balance: number;

  @CreateDateColumn({ name: 'created_at', default: () => 'now()' })
  createdAt: string;

  @UpdateDateColumn({ name: 'updated_at', default: () => 'now()' })
  updatedAt: string;
}
