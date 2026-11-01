import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";

function databaseUrl(): string {
  const raw = process.env.DATABASE_URL ?? "file:./data/keel.sqlite";
  if (raw.startsWith("postgres://") || raw.startsWith("postgresql://")) {
    return raw;
  }
  const withoutScheme = raw.startsWith("file:") ? raw.slice("file:".length) : raw;
  const absolute = path.isAbsolute(withoutScheme)
    ? withoutScheme
    : path.resolve(process.cwd(), withoutScheme);
  return `file:${absolute}`;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl(),
  },
});
