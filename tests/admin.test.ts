import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canPromote,
  canRestrict,
  isAdminUser,
  summarizeUsers,
} from "../src/lib/admin.ts";

describe("isAdminUser()", () => {
  it("role 为 admin 即通过", () => {
    assert.equal(isAdminUser({ role: "admin", email: "a@b.c" }), true);
  });

  it("普通用户不通过", () => {
    assert.equal(isAdminUser({ role: "user", email: "a@b.c" }), false);
  });

  it("null / undefined 一律不通过", () => {
    assert.equal(isAdminUser(null), false);
    assert.equal(isAdminUser(undefined), false);
    assert.equal(isAdminUser({}), false);
  });

  it("**引导邮箱**：全新部署时数据库里还没有管理员，靠环境变量指定第一个", () => {
    assert.equal(isAdminUser({ role: "user", email: "boss@x.com" }, "boss@x.com"), true);
  });

  it("引导邮箱大小写与空白不敏感", () => {
    assert.equal(isAdminUser({ role: "user", email: "  Boss@X.com " }, "boss@x.com"), true);
    assert.equal(isAdminUser({ role: "user", email: "boss@x.com" }, "  BOSS@X.COM  "), true);
  });

  it("**引导邮箱为空时不误判** —— 空串不能等于空邮箱而放行所有人", () => {
    assert.equal(isAdminUser({ role: "user", email: "" }, ""), false);
    assert.equal(isAdminUser({ role: "user", email: null }, "   "), false);
    assert.equal(isAdminUser({ role: "user", email: "a@b.c" }, ""), false);
  });

  it("邮箱不匹配则不通过", () => {
    assert.equal(isAdminUser({ role: "user", email: "other@x.com" }, "boss@x.com"), false);
  });
});

describe("canRestrict() 的自我保护", () => {
  it("**不能对自己动手** —— 管理员点到自己那一行时最容易发生", () => {
    const result = canRestrict("boss@x.com", { email: "boss@x.com", role: "admin" }, 3);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /不能对自己/);
  });

  it("邮箱大小写与空白不影响自我识别", () => {
    const result = canRestrict("Boss@X.com ", { email: " boss@x.com", role: "admin" }, 3);
    assert.equal(result.ok, false);
  });

  it("**最后一个管理员不能被降级/封禁** —— 否则后台从此无人能进", () => {
    const result = canRestrict("other@x.com", { email: "boss@x.com", role: "admin" }, 1);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /最后一个管理员/);
  });

  it("有两个管理员时可以动其中一个", () => {
    assert.equal(canRestrict("a@x.com", { email: "b@x.com", role: "admin" }, 2).ok, true);
  });

  it("动普通用户没有额外限制", () => {
    assert.equal(canRestrict("a@x.com", { email: "c@x.com", role: "user" }, 1).ok, true);
  });
});

describe("canPromote()", () => {
  it("普通用户可以提升", () => {
    assert.equal(canPromote({ role: "user" }).ok, true);
  });

  it("已经是管理员则拒绝，避免重复授予", () => {
    const result = canPromote({ role: "admin" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /已经是管理员/);
  });
});

describe("summarizeUsers()", () => {
  const now = new Date(2026, 9, 7);
  const day = 86_400_000;

  it("统计总数、管理员、封禁数与本周新增", () => {
    const summary = summarizeUsers(
      [
        { role: "admin", banned: false, createdAt: new Date(now.getTime() - 1 * day) },
        { role: "user", banned: true, createdAt: new Date(now.getTime() - 2 * day) },
        { role: "user", banned: false, createdAt: new Date(now.getTime() - 30 * day) },
      ],
      now,
    );
    assert.equal(summary.total, 3);
    assert.equal(summary.admins, 1);
    assert.equal(summary.banned, 1);
    assert.equal(summary.newThisWeek, 2);
  });

  it("正好 7 天前算作本周内（边界包含）", () => {
    const summary = summarizeUsers(
      [{ role: "user", createdAt: new Date(now.getTime() - 7 * day) }],
      now,
    );
    assert.equal(summary.newThisWeek, 1);
  });

  it("空列表全是 0，不产生 NaN，趋势是 12 个 0", () => {
    const summary = summarizeUsers([], now);
    assert.equal(summary.total, 0);
    assert.equal(summary.admins, 0);
    assert.equal(summary.banned, 0);
    assert.equal(summary.newThisWeek, 0);
    assert.equal(summary.publicProfiles, 0);
    assert.deepEqual(summary.weeklySignups, new Array(12).fill(0));
  });

  it("公开页数与注册趋势一并统计出来（趋势从旧到新，最后一格是本周）", () => {
    const summary = summarizeUsers(
      [
        { role: "user", banned: false, isPublic: true, createdAt: new Date(now.getTime() - 1 * day) },
        { role: "user", banned: false, isPublic: true, createdAt: new Date(now.getTime() - 8 * day) },
        { role: "user", banned: false, isPublic: false, createdAt: new Date(now.getTime() - 40 * day) },
      ],
      now,
    );
    assert.equal(summary.publicProfiles, 2);
    assert.equal(summary.weeklySignups.length, 12);
    assert.equal(summary.weeklySignups[11], 1, "1 天前落在本周那一格");
    assert.equal(summary.weeklySignups[10], 1, "8 天前落在上一周那一格");
    assert.equal(summary.weeklySignups[6], 1, "40 天前落在第 6 格");
    assert.equal(summary.weeklySignups.reduce((a, b) => a + b, 0), 3);
  });

  it("超出窗口的注册不进趋势数组，也不会把数组撑长", () => {
    const summary = summarizeUsers(
      [{ role: "user", createdAt: new Date(now.getTime() - 400 * day) }],
      now,
    );
    assert.equal(summary.weeklySignups.length, 12);
    assert.equal(summary.weeklySignups.reduce((a, b) => a + b, 0), 0);
    assert.equal(summary.total, 1, "但总数照旧包含它");
  });

  it("周数可以自定义", () => {
    const summary = summarizeUsers([], now, 4);
    assert.equal(summary.weeklySignups.length, 4);
  });

  it("时间无法解析时不计入本周新增，宁可少算", () => {
    const summary = summarizeUsers([{ role: "user", createdAt: "坏时间" }], now);
    assert.equal(summary.newThisWeek, 0);
    assert.equal(summary.total, 1);
  });

  it("接受 ISO 字符串形式的时间", () => {
    const summary = summarizeUsers(
      [{ role: "user", createdAt: new Date(now.getTime() - day).toISOString() }],
      now,
    );
    assert.equal(summary.newThisWeek, 1);
  });
});
