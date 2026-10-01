import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { databaseCredentials } from "./env";
import * as schema from "./schema";

// Reuse one client across hot reloads in dev.
const globalForDb = globalThis as unknown as { libsqlClient?: Client };

const client = globalForDb.libsqlClient ?? createClient(databaseCredentials());
if (process.env.NODE_ENV !== "production") globalForDb.libsqlClient = client;

export const db = drizzle(client, { schema });
export { schema };
