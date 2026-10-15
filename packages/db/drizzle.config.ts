import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { migrationUrl } from "./src/env";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: migrationUrl() },
});
