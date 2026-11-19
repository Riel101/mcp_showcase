import { createCommerceWithDatabase } from "./commerce.js";
import { createNodeDatabase } from "./node-database.js";

export function createCommerce(databasePath: string) {
  const db = createNodeDatabase(databasePath);
  try {
    return createCommerceWithDatabase(db);
  } catch (error) {
    db.close();
    throw error;
  }
}
