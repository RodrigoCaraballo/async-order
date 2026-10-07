import { Account } from './account.interface';

export interface IAccountRepository {
  findById(id: string): Promise<Account | null>;
  updateBalance(id: string, balance: number, amount: number): Promise<boolean>;
}

export const IAccountRepository = Symbol('IAccountRepository');
