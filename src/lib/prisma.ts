import { createRequire } from "node:module";

import { PrismaClient } from "@db/client";
import { databaseProviderFromUrl } from "@/lib/db-provider";

/**
 * Prisma 客户端单例。
 *
 * 两个关键点：
 *
 * 1. **连接串在这里注入，不在 schema 里。**
 *    Prisma 7 把 datasource url 移出了 schema，改由适配器在运行时提供。
 *    好处是同一份模型定义可以同时服务 SQLite 与 PostgreSQL ——
 *    本地零依赖开箱即用，线上换成 Neon 的连接串即可，代码零改动。
 *
 * 2. **开发环境挂到 globalThis。**
 *    Next 的热更新会重复执行模块，不缓存就会每次开一个新的连接池，
 *    很快耗尽数据库连接数（这是 Prisma + Next 的经典坑）。
 *
 * ── 为什么适配器是 require 而不是 import ────────────────────────
 *
 * `@prisma/adapter-better-sqlite3` 依赖 better-sqlite3 —— 一个**原生模块**。
 * 写成顶层 import 的话，无论线上用的是不是 Postgres，打包与启动时都会去加载它；
 * 一旦目标平台上它的预编译包缺失或 install 脚本没跑（不同 Node ABI、不同架构、
 * pnpm 的构建脚本白名单……），**整个应用启动即崩，而报错与 Postgres 毫无关系**。
 *
 * 部署平台上最常见的一类"第一次部署就失败"正是这种。
 * 所以按协议前缀 require 对应的那一个：线上只加载 Postgres 适配器，
 * 原生模块根本不会被碰到。
 */
const requireAdapter = createRequire(import.meta.url);

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function readDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "缺少环境变量 DATABASE_URL。\n" +
        "本地开发：复制 .env.example 为 .env.local，默认值 file:./dev.db 即可直接使用；\n" +
        "线上部署：填入 PostgreSQL 连接串。",
    );
  }
  return url;
}

function createClient(): PrismaClient {
  const url = readDatabaseUrl();

  // 按协议前缀选择适配器。判断逻辑与 src/lib/auth.ts 共用同一个函数 ——
  // 两处一旦各写一遍就可能分叉，而分叉的报错很难指回原因。
  const adapter =
    databaseProviderFromUrl(url) === "postgresql"
      ? new (requireAdapter("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg")).PrismaPg({
          connectionString: url,
        })
      : new (
          requireAdapter("@prisma/adapter-better-sqlite3") as typeof import("@prisma/adapter-better-sqlite3")
        ).PrismaBetterSqlite3({ url });

  return new PrismaClient({
    adapter,
    // 开发环境打印慢查询与警告，生产环境只留错误
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
