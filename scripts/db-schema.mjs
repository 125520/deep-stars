#!/usr/bin/env node
/**
 * 渲染 Prisma schema 的数据库变体
 * ══════════════════════════════════════════════════════════════════
 *
 * prisma/schema.template.prisma 是唯一真源（见该文件顶部的说明）。
 * 本脚本把它渲染成两份可用的 schema：
 *
 *   prisma/schema.prisma            provider = "sqlite"        （本地开发，提交进仓库）
 *   prisma/schema.postgres.prisma   provider = "postgresql"    （Vercel + Neon，gitignore）
 *
 * 渲染规则只有一条：替换 datasource 块里的 provider 值。
 * 之所以敢只替换这一行，是因为模型层刻意只用跨库同构的类型
 * （见模板顶部的「跨库兼容的写法约束」）。
 *
 * 用法：
 *   node scripts/db-schema.mjs              # 渲染全部
 *   node scripts/db-schema.mjs sqlite       # 只渲染 sqlite
 *   node scripts/db-schema.mjs postgresql   # 只渲染 postgres
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_PATH = path.join(ROOT, "prisma", "schema.template.prisma");

/** provider → 输出文件（相对项目根） */
export const TARGETS = {
  sqlite: "prisma/schema.prisma",
  postgresql: "prisma/schema.postgres.prisma",
};

/**
 * 把模板里的 `provider = "..."` 换成目标 provider。
 * 只匹配 `datasource db { ... }` 块内部的那一处，避免误伤
 * generator 块或注释里可能出现的 provider 字样。
 */
export function renderSchema(template, provider) {
  const blockRe = /(datasource\s+\w+\s*\{)([\s\S]*?)(\})/;
  const m = template.match(blockRe);
  if (!m) throw new Error("模板里找不到 datasource 块");

  const inner = m[2];
  if (!/provider\s*=\s*"[^"]*"/.test(inner)) {
    throw new Error("datasource 块里找不到 provider 字段");
  }
  const nextInner = inner.replace(
    /(provider\s*=\s*)"[^"]*"/,
    (_full, head) => `${head}"${provider}"`,
  );
  return template.replace(blockRe, `${m[1]}${nextInner}${m[3]}`);
}

async function main() {
  const want = process.argv[2];
  const providers = want ? [want] : Object.keys(TARGETS);

  for (const p of providers) {
    if (!(p in TARGETS)) {
      console.error(`未知 provider：${p}（可选：${Object.keys(TARGETS).join(", ")}）`);
      process.exit(2);
    }
  }

  const template = await readFile(TEMPLATE_PATH, "utf8");

  for (const provider of providers) {
    const out = path.join(ROOT, TARGETS[provider]);
    const rendered = renderSchema(template, provider);
    await writeFile(out, rendered, "utf8");
    console.log(`✓ ${TARGETS[provider]}  (provider = ${provider})`);
  }
}

// 仅在作为 CLI 直接执行时跑 main；被测试 import 时只取导出
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("渲染 schema 失败：", e.message);
    process.exit(1);
  });
}
