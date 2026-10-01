import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { databaseCredentials } from "./src/db/env";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: databaseCredentials(),
});
