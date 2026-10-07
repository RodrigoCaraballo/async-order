import { IAccountRepository } from '../../domain/interfaces/account/account.repository';
import { Account } from '../../domain/interfaces/account/account.interface';
import { InjectRepository } from '@nestjs/typeorm';
import { AccountEntity } from '../entities/account.entity';
import { MoreThan, Repository } from 'typeorm';

export class AccountTypeOrmRepository implements IAccountRepository {
  constructor(
    @InjectRepository(AccountEntity)
    private readonly repository: Repository<AccountEntity>,
  ) {}

  async findById(id: string): Promise<Account | null> {
    return await this.repository.findOneBy({ id });
  }

  async updateBalance(
    id: string,
    balance: number,
    amount: number,
  ): Promise<boolean> {
    const result = await this.repository.update(
      {
        id,
        balance: MoreThan(amount),
      },
      {
        balance: balance - amount,
      },
    );

    return result.affected === 1;
  }
}
