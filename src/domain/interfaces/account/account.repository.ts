import { Account } from './account.interface';

export interface IAccountRepository {
  findById(id: string): Promise<Account | null>;
}

export const IAccountRepository = Symbol('IAccountRepository');
