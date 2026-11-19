import type { SqlDatabase } from "../server/database.js";

export function createDurableDatabase(storage: Pick<DurableObjectStorage, "sql" | "transactionSync">): SqlDatabase {
  return {
    exec(sql) {
      storage.sql.exec(sql).toArray();
    },
    prepare(sql) {
      return {
        get: (...parameters) => storage.sql.exec(sql, ...parameters).toArray()[0],
        all: (...parameters) => storage.sql.exec(sql, ...parameters).toArray(),
        iterate: (...parameters) => storage.sql.exec(sql, ...parameters),
        run(...parameters) {
          storage.sql.exec(sql, ...parameters).toArray();
          const { changes } = storage.sql.exec<{ changes: number }>("SELECT changes() AS changes").one();
          return { changes };
        },
      };
    },
    transaction: (callback) => storage.transactionSync(callback),
    close() {
      // The Durable Object owns its connection for the life of the instance.
    },
  };
}
