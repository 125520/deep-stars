import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RESERVED_HANDLES,
  normalizeHandle,
  profilePath,
  validateHandle,
} from "../src/lib/handle.ts";

describe("normalizeHandle()", () => {
  it("去空格并转小写", () => {
    assert.equal(normalizeHandle("  Alice  "), "alice");
    assert.equal(normalizeHandle("SKY-WALKER"), "sky-walker");
  });

  it("已经是规范形式时不变", () => {
    assert.equal(normalizeHandle("star_gazer"), "star_gazer");
  });
});

describe("validateHandle() 的接受路径", () => {
  it("接受字母数字与内部连字符/下划线", () => {
    for (const raw of ["alice", "sky-walker", "star_gazer", "abc123", "a1b2c3"]) {
      const result = validateHandle(raw);
      assert.equal(result.ok, true, `应当接受: ${raw}`);
    }
  });

  it("大写输入被规范化后接受，返回的是小写", () => {
    const result = validateHandle("  StarGazer ");
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.handle, "stargazer");
  });

  it("恰好 3 个字符与恰好 24 个字符都接受（边界包含）", () => {
    assert.ok(validateHandle("abc").ok);
    assert.ok(validateHandle("a".repeat(24)).ok);
  });
});

describe("validateHandle() 的拒绝路径", () => {
  const cases: [string, string, RegExp][] = [
    ["空串", "", /请先设一个用户名/],
    ["只有空格", "   ", /请先设一个用户名/],
    ["太短（但字符合法）", "ab", /至少 3 个字符/],
    ["太长", "a".repeat(25), /最多 24 个字符/],
    // 用 3 个中文字符：恰好越过长度下限，才能测到"字符集"这条规则本身
    ["含中文", "星野夜", /只能用英文小写字母/],
    ["含空格", "sky walker", /只能用英文小写字母/],
    ["含点", "sky.walker", /只能用英文小写字母/],
    ["含斜杠", "sky/walker", /只能用英文小写字母/],
    ["含 @", "sky@host", /只能用英文小写字母/],
    ["开头连字符", "-alice", /不能以连字符开头或结尾/],
    ["结尾连字符", "alice-", /不能以连字符开头或结尾/],
    ["开头下划线", "_alice", /不能以下划线开头或结尾/],
    ["结尾下划线", "alice_", /不能以下划线开头或结尾/],
  ];

  for (const [name, raw, pattern] of cases) {
    it(`拒绝：${name}`, () => {
      const result = validateHandle(raw);
      assert.equal(result.ok, false, `不该接受: ${raw}`);
      if (result.ok) return;
      assert.match(result.error, pattern);
    });
  }

  it("**保留字大小写不敏感地挡掉** —— 存成 Admin 再访问 /u/admin 就撞了", () => {
    for (const reserved of ["admin", "ADMIN", "  Admin  "]) {
      const result = validateHandle(reserved);
      assert.equal(result.ok, false, `不该接受: ${reserved}`);
      if (result.ok) return;
      assert.match(result.error, /保留/);
    }
  });

  it("保留名单里的每一项都确实被挡下（名单本身不能有漏网的写法）", () => {
    for (const reserved of RESERVED_HANDLES) {
      // 保留字里可能有长度不足 3 的（如 u），那会被长度规则先挡掉 —— 也算挡下了
      assert.equal(validateHandle(reserved).ok, false, `保留字未被挡下: ${reserved}`);
    }
  });

  it("保留字加个后缀就能用（不该误伤太多）", () => {
    assert.ok(validateHandle("admin-alice").ok);
    assert.ok(validateHandle("my-stats").ok);
  });

  it("**字符集错误优先于长度错误**，提示才是可操作的", () => {
    // 输入「星野」若先报"至少 3 个字符"，用户会再加一个字，
    // 然后才被告知中文不允许 —— 白改一次
    const short = validateHandle("星野");
    assert.ok(!short.ok);
    if (short.ok) return;
    assert.match(short.error, /只能用英文小写字母/, "应当先报字符集问题");
  });
});

describe("profilePath()", () => {
  it("拼出公开主页路径", () => {
    assert.equal(profilePath("alice"), "/u/alice");
  });

  it("不做归一化 —— 调用方应当传入已校验的 handle", () => {
    // 记录当前行为：路径拼接是纯字符串操作，不替调用方兜底
    assert.equal(profilePath("Alice"), "/u/Alice");
  });
});
