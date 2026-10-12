#!/usr/bin/env node
/**
 * 重置某个账号的密码
 * ══════════════════════════════════════════════════════════════════
 *
 * 用法：
 *   pnpm reset-password <邮箱> [新密码]
 *   pnpm reset-password <邮箱>              # 随机生成一个强口令并打印
 *
 * 为什么需要它：这个项目**不做邮箱验证，也没有 SMTP**（那是"克隆下来
 * 两条命令就能跑"的取舍）。没有邮件服务就没有"忘记密码"的自助流程 ——
 * 忘密码的人只能靠管理员用这个脚本救回来。
 *
 * ── 为什么是 .mjs + 原生 SQL，而不是 .ts + Prisma ───────────────
 *
 * 应用代码走 `@db/client` 别名，而 Prisma 7 生成的是**一堆 .ts 文件**。
 * 纯 Node 既不认 tsconfig 的 paths，也不保证能把整套生成产物剥类型跑起来。
 * 所以这里不用 PrismaClient，直接用驱动执行三条固定语句。
 *
 * 代价是**硬编码了表名与列名**（都写在 schema 的 @@map 与字段上，改名时
 * 这里要一起改）。换来的是：任何装了 Node 的环境都能直接跑，不需要构建 ——
 * 而"忘了密码"恰恰是最需要它马上能跑起来的时候。
 *
 * ── 一条硬纪律：绝不自己实现哈希 ────────────────────────────────
 *
 * 哈希参数必须与 Better Auth 登录时用的**完全一致**，差一个参数就会变成
 * "重置成功了但怎么都登不上"，而且报错只会说密码错误。
 * 所以调用 `better-auth/crypto` 的 hashPassword —— 与登录路径同一份实现。
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { hashPassword } from "better-auth/crypto";

/** 极简 .env 读取：够用即可，不处理引号内的转义与多行值 */
function loadEnv() {
  const file = path.resolve(process.cwd(), ".env");
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // 已存在的环境变量优先，便于临时用 DATABASE_URL=... 覆盖
    if (!(key in process.env)) process.env[key] = value;
  }
}

const generatePassword = () => randomBytes(18).toString("base64url");

/**
 * 打开数据库并返回一组统一的执行接口。
 *
 * `all` 读多行、`exec` 写。分开而不是合成一个：SQLite 的 `.all()` 用在
 * INSERT 上不会有正确结果，混在一起迟早在某一端出错。
 *
 * ⚠️ `ph(i)` 按**参数序号**生成占位符，返回单个占位符，**不是列表**。
 * 第一版写成了 `mark(n)` —— 生成逗号分隔的一串（为 `IN (?, ?)` 那种场景）。
 * 于是 `WHERE userId = ${mark(1)} AND providerId = ${mark(2)}` 变成了
 * `WHERE userId = ?, ? AND providerId = ?, ?`，SQLite 报一句
 * `near ",": syntax error`，而语句本身看起来完全正常。
 * **名字没表达出"这是列表"这件事**，所以现在改成一个不会误用的形式。
 */
async function openDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL 未设置（.env 缺失或为空）");

  const isPg = url.startsWith("postgres://") || url.startsWith("postgresql://");

  /** PostgreSQL 用 $1/$2，SQLite 一律是 ? —— 索引只是给前者用的 */
  const ph = (index) => (isPg ? `$${index}` : "?");

  if (isPg) {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    return {
      label: "PostgreSQL",
      ph,
      all: async (sql, params = []) => (await client.query(sql, params)).rows,
      exec: async (sql, params = []) => {
        await client.query(sql, params);
      },
      close: () => client.end(),
    };
  }

  const { default: Database } = await import("better-sqlite3");
  const file = url.replace(/^file:/, "").replace(/^\.\//, "");
  const db = new Database(path.resolve(process.cwd(), file));
  return {
    label: "SQLite",
    ph,
    all: async (sql, params = []) => db.prepare(sql).all(...params),
    exec: async (sql, params = []) => {
      db.prepare(sql).run(...params);
    },
    close: async () => db.close(),
  };
}

async function main() {
  loadEnv();

  const [email, provided] = process.argv.slice(2);
  if (!email) {
    console.error("用法：pnpm reset-password <邮箱> [新密码]");
    console.error("     不给新密码时会随机生成一个并打印出来。");
    process.exit(2);
  }

  const normalized = email.trim().toLowerCase();
  const db = await openDatabase();

  try {
    console.log(`数据库：${db.label}`);

    // 邮箱在库里可能有大小写差异，两边都转小写比较
    const users = await db.all(
      `SELECT id, email, name FROM "user" WHERE lower(email) = ${db.ph(1)} LIMIT 1`,
      [normalized],
    );
    const user = users[0];
    if (!user) {
      console.error(`找不到邮箱为 ${normalized} 的账号。`);
      process.exit(1);
    }

    const password = provided?.trim() || generatePassword();
    if (password.length < 8) {
      console.error("密码至少 8 位（与登录接口的 minPasswordLength 一致）。");
      process.exit(2);
    }

    const hash = await hashPassword(password);
    const now = new Date().toISOString();

    const accounts = await db.all(
      `SELECT id FROM "account" WHERE userId = ${db.ph(1)} AND providerId = ${db.ph(2)} LIMIT 1`,
      [user.id, "credential"],
    );

    if (accounts.length > 0) {
      await db.exec(
        `UPDATE "account" SET password = ${db.ph(1)}, updatedAt = ${db.ph(2)} WHERE id = ${db.ph(3)}`,
        [hash, now, accounts[0].id],
      );
    } else {
      // 没有 credential 行说明这个账号从没设过密码（将来接了第三方登录）
      await db.exec(
        `INSERT INTO "account" (id, userId, accountId, providerId, password, createdAt, updatedAt)
         VALUES (${db.ph(1)}, ${db.ph(2)}, ${db.ph(3)}, ${db.ph(4)}, ${db.ph(5)}, ${db.ph(6)}, ${db.ph(7)})`,
        [randomBytes(12).toString("hex"), user.id, user.id, "credential", hash, now, now],
      );
    }

    /*
      顺手清掉该账号的所有会话。
      改密码的常见场景是"号可能被盗了"，此时把已登录的设备留在线上毫无意义。
    */
    const before = await db.all(
      `SELECT COUNT(*) AS n FROM "session" WHERE userId = ${db.ph(1)}`,
      [user.id],
    );
    await db.exec(`DELETE FROM "session" WHERE userId = ${db.ph(1)}`, [user.id]);

    console.log(`✓ 已重置 ${user.email}（${user.name}）的密码`);
    console.log(`  新密码：${password}`);
    console.log(`  已注销 ${before[0]?.n ?? 0} 个登录会话`);
    if (provided) console.log("  提示：口令出现在命令行里，可能留在 shell 历史中。");
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  /*
    打印**完整堆栈**而不是只打印 message。
    运维脚本出错时最需要知道的就是"我在哪一句挂的"，
    而只印一行 message 会让 `near ",": syntax error` 这类报错完全无从下手。
  */
  console.error("重置失败：");
  console.error(error);
  process.exit(1);
});
