/**
 * The visual build answers the cache from fixtures, so nothing opens an
 * encrypted database. Mirrors the `expo-sqlite` stub beside it.
 */
export function open() {
  return {
    executeAsync: async () => ({ rows: [] as unknown[] }),
    execute: () => ({ rows: [] as unknown[] }),
    close: () => undefined,
    delete: () => undefined,
  };
}

export function isSQLCipher() {
  return false;
}
