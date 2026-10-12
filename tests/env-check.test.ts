import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkEnv, formatEnvProblems } from "../src/lib/env-check.ts";

const FULL = {
  DATABASE_URL: "postgresql://user:pw@host/db",
  BETTER_AUTH_SECRET: "a".repeat(44),
  DEEP_STARS_SECRET: "b".repeat(64),
  DEEP_STARS_ADMIN_EMAIL: "me@example.com",
};

describe("checkEnv() 生产环境的致命项", () => {
  it("全部齐备时没有任何问题", () => {
    const r = checkEnv(FULL, true);
    assert.deepEqual(r.fatal, []);
    assert.deepEqual(r.degraded, []);
  });

  it("**缺 BETTER_AUTH_SECRET 是致命的** —— 表现为「页面能开、一登录就 500」", () => {
    const r = checkEnv({ ...FULL, BETTER_AUTH_SECRET: undefined }, true);
    assert.equal(r.fatal.length, 1);
    assert.equal(r.fatal[0]?.key, "BETTER_AUTH_SECRET");
    assert.match(r.fatal[0]?.reason ?? "", /登录/);
  });

  it("缺 DATABASE_URL 是致命的", () => {
    const r = checkEnv({ ...FULL, DATABASE_URL: undefined }, true);
    assert.ok(r.fatal.some((f) => f.key === "DATABASE_URL"));
  });

  it("**空字符串与纯空白都算没设** —— 环境变量面板里很容易留下这种值", () => {
    for (const value of ["", "   ", "\t"]) {
      const r = checkEnv({ ...FULL, BETTER_AUTH_SECRET: value }, true);
      assert.ok(
        r.fatal.some((f) => f.key === "BETTER_AUTH_SECRET"),
        `"${value}" 应当被当作未设置`,
      );
    }
  });
});

describe("checkEnv() 生产环境的降级项", () => {
  it("缺 DEEP_STARS_SECRET 只警告，不致命（站点仍能用）", () => {
    const r = checkEnv({ ...FULL, DEEP_STARS_SECRET: undefined }, true);
    assert.deepEqual(r.fatal, []);
    assert.ok(r.degraded.some((d) => d.key === "DEEP_STARS_SECRET"));
  });

  it("缺 DEEP_STARS_ADMIN_EMAIL 只警告 —— 后果是没人能进 /admin", () => {
    const r = checkEnv({ ...FULL, DEEP_STARS_ADMIN_EMAIL: undefined }, true);
    assert.deepEqual(r.fatal, []);
    assert.ok(r.degraded.some((d) => d.key === "DEEP_STARS_ADMIN_EMAIL"));
  });

  it("**DEEP_STARS_SECRET 太短也算问题** —— 加密会失败，而且报错晚得多", () => {
    const r = checkEnv({ ...FULL, DEEP_STARS_SECRET: "short" }, true);
    assert.ok(r.degraded.some((d) => d.key === "DEEP_STARS_SECRET" && /太短/.test(d.reason)));
  });

  it("正好 16 字符通过（边界包含）", () => {
    const r = checkEnv({ ...FULL, DEEP_STARS_SECRET: "c".repeat(16) }, true);
    assert.deepEqual(r.degraded, []);
  });

  it("15 字符不通过", () => {
    const r = checkEnv({ ...FULL, DEEP_STARS_SECRET: "c".repeat(15) }, true);
    assert.equal(r.degraded.length, 1);
  });
});

describe("checkEnv() 开发环境只拦数据库", () => {
  it("**本地缺密钥不拦** —— 起开发服务器不该被密钥挡住", () => {
    const r = checkEnv({ DATABASE_URL: "file:./dev.db" }, false);
    assert.deepEqual(r.fatal, []);
    assert.deepEqual(r.degraded, []);
  });

  it("本地缺 DATABASE_URL 仍然致命", () => {
    const r = checkEnv({}, false);
    assert.ok(r.fatal.some((f) => f.key === "DATABASE_URL"));
  });
});

describe("formatEnvProblems() 输出可读", () => {
  it("逐条列出缺失项与原因", () => {
    const text = formatEnvProblems(checkEnv({ ...FULL, BETTER_AUTH_SECRET: undefined }, true));
    assert.match(text, /BETTER_AUTH_SECRET/);
    assert.match(text, /必需/);
    assert.match(text, /重新部署/);
  });

  it("没问题时也不会崩（调用方一般不会这么用）", () => {
    assert.ok(formatEnvProblems(checkEnv(FULL, true)).length > 0);
  });
});
