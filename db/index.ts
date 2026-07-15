import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type D1Binding = Parameters<typeof drizzle>[0];

/** Creates an organisation-scoped database client from an injected D1 binding. */
export function getDb(database: D1Binding) {
  return drizzle(database, { schema });
}
