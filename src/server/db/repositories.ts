import "server-only";
import {
  readCollection,
  readRatesCache,
  readSettings,
  updateCollection,
  updateRatesCache,
  updateSettingsFile,
  type CollectionItem,
  type CollectionName,
} from "./store";

export class NotFoundError extends Error {
  constructor(what: string, id: string) {
    super(`${what} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

export interface CollectionRepo<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  insert(item: T): Promise<T>;
  /** Replace one item via `fn(existing)`. Throws NotFoundError when missing. */
  update(id: string, fn: (existing: T) => T): Promise<T>;
  /** Remove one item; returns it, or null when it did not exist. */
  remove(id: string): Promise<T | null>;
  /** Arbitrary read-modify-write under the file lock. */
  mutate<R>(fn: (items: T[]) => { items: T[]; result?: R }): Promise<R>;
}

function collectionRepo<N extends CollectionName>(name: N, label: string): CollectionRepo<CollectionItem<N>> {
  type T = CollectionItem<N>;
  return {
    list: () => readCollection(name),
    async get(id) {
      return (await readCollection(name)).find((x) => x.id === id) ?? null;
    },
    insert: (item) => updateCollection<N, T>(name, (items) => ({ items: [...items, item], result: item })),
    update: (id, fn) =>
      updateCollection<N, T>(name, (items) => {
        const idx = items.findIndex((x) => x.id === id);
        if (idx < 0) throw new NotFoundError(label, id);
        const next = fn(items[idx]);
        const copy = [...items];
        copy[idx] = next;
        return { items: copy, result: next };
      }),
    remove: (id) =>
      updateCollection<N, T | null>(name, (items) => {
        const found = items.find((x) => x.id === id) ?? null;
        return { items: items.filter((x) => x.id !== id), result: found };
      }),
    mutate: <R,>(fn: (items: T[]) => { items: T[]; result?: R }) => updateCollection<N, R>(name, fn),
  };
}

export const accountsRepo = collectionRepo("accounts", "Account");
export const incomesRepo = collectionRepo("incomes", "Income");
export const expensesRepo = collectionRepo("expenses", "Expense");
export const categoriesRepo = collectionRepo("categories", "Category");
export const transfersRepo = collectionRepo("transfers", "Transfer");
export const adjustmentsRepo = collectionRepo("adjustments", "Adjustment");
export const debtsRepo = collectionRepo("debts", "Debt");
export const investmentFlowsRepo = collectionRepo("investmentFlows", "Investment deposit / withdrawal");
export const valuationsRepo = collectionRepo("valuations", "Value update");

export const settingsRepo = {
  get: readSettings,
  update: updateSettingsFile,
};

export const ratesRepo = {
  read: readRatesCache,
  update: updateRatesCache,
};
