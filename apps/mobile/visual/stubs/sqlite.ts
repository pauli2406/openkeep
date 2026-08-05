/** The cache is answered by fixtures in the visual build, so nothing opens a database. */
export async function openDatabaseAsync() {
  return {
    execAsync: async () => undefined,
    runAsync: async () => ({ changes: 0 }),
    getFirstAsync: async () => null,
    getAllAsync: async () => [],
  };
}
