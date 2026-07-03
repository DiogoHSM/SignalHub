import { createDb, type Db } from "../src/client.js";

export function createTestDb(databaseUrl: string): Db {
  return createDb(databaseUrl, {
    onPoolError(error) {
      if ((error as { code?: string }).code === "57P01") {
        return;
      }
      throw error;
    }
  });
}
