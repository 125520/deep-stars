import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { databaseProviderFromUrl } from "../src/lib/db-provider.ts";

/**
 * 这个函数有两个消费方（src/lib/prisma.ts 选驱动适配器、
 * src/lib/auth.ts 告诉 Better Auth 用哪种方言），两边必须得到同一个答案。
 * 所以它值得一个直接的测试 —— 分叉的代价是一句指不回原因的 SQL 语法错误。
 */
describe("databaseProviderFromUrl()", () => {
  it("postgres:// 与 postgresql:// 都判为 postgresql", () => {
    assert.equal(databaseProviderFromUrl("postgres://user:pw@host/db"), "postgresql");
    assert.equal(databaseProviderFromUrl("postgresql://user:pw@host/db"), "postgresql");
  });

  it("Neon 这类带参数的连接串同样识别", () => {
    assert.equal(
      databaseProviderFromUrl("postgresql://u:p@ep-x.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"),
      "postgresql",
    );
  });

  it("file: 开头的相对与绝对路径都判为 sqlite", () => {
    assert.equal(databaseProviderFromUrl("file:./dev.db"), "sqlite");
    assert.equal(databaseProviderFromUrl("file:C:/abs/path/dev.db"), "sqlite");
  });

  it("缺失或空串回退到 sqlite（本地零依赖是默认姿势）", () => {
    assert.equal(databaseProviderFromUrl(undefined), "sqlite");
    assert.equal(databaseProviderFromUrl(""), "sqlite");
  });

  it("前缀大小写敏感：Postgres:// 不算，避免误判成线上库", () => {
    // 真实连接串不会这么写；这里锁住行为，防止有人"顺手"加 toLowerCase
    // 而把某个恰好以大写开头的本地路径误判成 PostgreSQL。
    assert.equal(databaseProviderFromUrl("Postgres://host/db"), "sqlite");
  });
});
