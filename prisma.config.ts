import "dotenv/config";
import { existsSync } from "node:fs";

import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 起，datasource 的连接串不再写在 schema 文件里：
 *   · CLI（db push / migrate / studio）从这里读 —— 本文件
 *   · 运行时客户端由适配器传入 —— 见 src/lib/prisma.ts
 *
 * ── schema 必须跟着连接串走，否则线上全站 500 ────────────────────
 *
 * ⚠️ 这里原先写死 `prisma/schema.prisma`（SQLite 变体）。
 *
 * 后果不是"退化成 SQLite"，而是**整个应用起不来**：
 * `prisma generate` 会把 provider 烧进生成的客户端，而这个客户端在运行时会
 * 校验适配器是否匹配 —— 于是线上（Postgres 连接串 + Postgres 适配器）
 * 拿着一个 provider 为 sqlite 的客户端，每一次查询都抛：
 *
 *   The Driver Adapter `@prisma/adapter-pg` is not compatible with
 *   the provider `sqlite` specified in the Prisma schema.
 *
 * 本地一直好好的，因为本地确实是 SQLite —— 这类"只有部署后才出现"的错误
 * 是最贵的一种。所以让配置**自己按连接串选**，而不是靠人记得改。
 */
const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const isPostgres =
  databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://");

const POSTGRES_SCHEMA = "prisma/schema.postgres.prisma";
const SQLITE_SCHEMA = "prisma/schema.prisma";

if (isPostgres && !existsSync(POSTGRES_SCHEMA)) {
  /*
    这个文件由 `pnpm db:render` 从模板渲染，且**不入库**（它只用于部署）。
    所以构建脚本必须先跑 db:render —— 见 package.json 的 build。
    真漏了的时候给一句能直接照做的提示，而不是让 Prisma 报"文件不存在"。
  */
  throw new Error(
    `DATABASE_URL 是 PostgreSQL，但 ${POSTGRES_SCHEMA} 不存在。\n` +
      "它由模板渲染而来，请先执行：pnpm db:render",
  );
}

export default defineConfig({
  schema: isPostgres ? POSTGRES_SCHEMA : SQLITE_SCHEMA,
  migrations: {
    path: "prisma/migrations",
    // Node 22.6+ 原生支持直接执行 .ts（类型擦除），不需要 tsx 这类额外依赖
    seed: "node prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
