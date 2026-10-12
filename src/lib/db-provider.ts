/**
 * 从连接串判断数据库类型
 * ══════════════════════════════════════════════════════════════════
 *
 * 本地 SQLite、线上 PostgreSQL（Neon），同一份 Prisma 模型定义服务两端，
 * 靠的就是这个判断。它有两个消费方，**必须得到同一个答案**：
 *
 *   src/lib/prisma.ts  选驱动适配器（better-sqlite3 / pg）
 *   src/lib/auth.ts    告诉 Better Auth 的 Prisma 适配器用哪种方言
 *
 * 两边一旦不一致，PrismaClient 按 SQLite 建、Better Auth 按 PostgreSQL 生成 SQL，
 * 报出来的是一句含糊的语法错误，很难指回这里。所以抽成一个函数 + 单测，
 * 而不是在两处各写一遍 `startsWith`。
 */

export type DatabaseProvider = "sqlite" | "postgresql";

/**
 * 只认协议前缀，不解析 URL。
 *
 * 刻意不用 `new URL()`：`file:./dev.db` 与 `file:/abs/path.db` 都是 SQLite，
 * 但 URL 解析对它们的处理不一致（相对路径会被当成非法或补上前缀）。
 * 前缀判断没有这些边角，而且完全可预测。
 */
export function databaseProviderFromUrl(url: string | undefined): DatabaseProvider {
  if (!url) return "sqlite";
  return url.startsWith("postgres://") || url.startsWith("postgresql://")
    ? "postgresql"
    : "sqlite";
}
