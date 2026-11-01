import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Postgres later (see docs/design.md#postgres):
 *   1. Set `provider = "postgresql"` in prisma/schema.prisma.
 *   2. Set DATABASE_URL=postgresql://...
 *   3. Run `npx prisma generate` and create a migration.
 *   4. Replace the adapter below with:
 *        import { PrismaPg } from "@prisma/adapter-pg";
 *        const adapter = new PrismaPg(process.env.DATABASE_URL);
 */
export function resolveDatabaseUrl(raw = process.env.DATABASE_URL): string {
  const url = raw && raw.trim().length > 0 ? raw.trim() : "file:./data/keel.sqlite";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) return url;
  const withoutScheme = url.startsWith("file:") ? url.slice("file:".length) : url;
  const absolute = path.isAbsolute(withoutScheme)
    ? withoutScheme
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), withoutScheme);
  return `file:${absolute}`;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  const url = resolveDatabaseUrl();
  if (url.startsWith("postgres")) {
    throw new Error(
      "DATABASE_URL is Postgres, but this build uses the SQLite schema. See docs/design.md#postgres.",
    );
  }
  const adapter = new PrismaBetterSqlite3({ url });
  const prisma = new PrismaClient({ adapter });
  globalForPrisma.prisma = prisma;
  return prisma;
}
