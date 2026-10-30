import "server-only";

/**
 * Per-key in-process async mutex. Calls with the same key run strictly one after another
 * (FIFO); different keys run concurrently. State lives on globalThis so every Next bundle
 * layer (RSC, actions, route handlers) shares the same locks.
 */
const globalForLocks = globalThis as unknown as { __budgetLocks?: Map<string, Promise<void>> };
const tails: Map<string, Promise<void>> = (globalForLocks.__budgetLocks ??= new Map());

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  tails.set(key, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}

/** Global key for multi-collection mutations (integrity check + write must not interleave). */
export const DB_WRITE_LOCK = "budget:db-write";
