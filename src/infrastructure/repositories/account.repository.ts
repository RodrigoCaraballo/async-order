import { IAccountRepository } from '../../domain/interfaces/account/account.repository';
import { Account } from '../../domain/interfaces/account/account.interface';
import { InjectRepository } from '@nestjs/typeorm';
import { AccountEntity } from '../entities/account.entity';
import { Repository } from 'typeorm';

export class AccountTypeOrmRepository implements IAccountRepository {
  constructor(
    @InjectRepository(AccountEntity)
    private readonly repository: Repository<AccountEntity>,
  ) {}

  async findById(id: string): Promise<Account | null> {
    return await this.repository.findOneBy({ id });
  }
}
