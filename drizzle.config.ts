import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/server/db/drizzle-schema.ts",
  dialect: "sqlite",
});
