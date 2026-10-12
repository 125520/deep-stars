import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AVATAR_HISTORY_LIMIT,
  MAX_DATA_URL_LENGTH,
  historyToPrune,
  validateAvatarDataUrl,
} from "../src/lib/avatar.ts";

/** 造一个合法的 data URL（内容随意，只关心格式） */
const png = (bytes = 40) => `data:image/png;base64,${"A".repeat(bytes)}`;

describe("validateAvatarDataUrl() 的接受路径", () => {
  it("接受 webp / png / jpeg", () => {
    for (const mime of ["webp", "png", "jpeg"]) {
      const result = validateAvatarDataUrl(`data:image/${mime};base64,AAAA`);
      assert.equal(result.ok, true, `应当接受 ${mime}`);
      if (!result.ok) return;
      assert.equal(result.mime, `image/${mime}`);
    }
  });

  it("接受末尾带 = 填充的 base64", () => {
    assert.ok(validateAvatarDataUrl("data:image/webp;base64,AAA=").ok);
    assert.ok(validateAvatarDataUrl("data:image/png;base64,AA==").ok);
  });

  it("两侧空白被忽略（从别处粘贴时常见）", () => {
    assert.ok(validateAvatarDataUrl(`  ${png()}  `).ok);
  });
});

describe("validateAvatarDataUrl() 的拒绝路径", () => {
  it("空值", () => {
    for (const value of [null, undefined, "", "   "]) {
      const result = validateAvatarDataUrl(value);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.error, /没有选择图片/);
    }
  });

  it("不是 data URL", () => {
    const result = validateAvatarDataUrl("https://example.com/a.png");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /data URL/);
  });

  it("**拒绝 SVG** —— SVG 可以内嵌脚本，是最典型的一类注入面", () => {
    const result = validateAvatarDataUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=");
    assert.equal(result.ok, false, "SVG 不该出现在白名单里");
    if (result.ok) return;
    assert.match(result.error, /只支持 PNG/);
  });

  it("拒绝 gif / bmp 等非白名单格式", () => {
    assert.equal(validateAvatarDataUrl("data:image/gif;base64,R0lGOD").ok, false);
    assert.equal(validateAvatarDataUrl("data:image/bmp;base64,Qk0").ok, false);
  });

  it("**拒绝非 base64 编码**（如 URL 编码的 data URL）", () => {
    assert.equal(validateAvatarDataUrl("data:image/png,%3Csvg%3E").ok, false);
  });

  it("拒绝 base64 中夹带的非法字符", () => {
    assert.equal(validateAvatarDataUrl("data:image/png;base64,AAAA<script>").ok, false);
    assert.equal(validateAvatarDataUrl("data:image/png;base64,AA AA").ok, false);
  });

  it("超出体积上限时给出可读的提示（含实际大小与上限）", () => {
    const huge = png(MAX_DATA_URL_LENGTH + 100);
    const result = validateAvatarDataUrl(huge);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /太大/);
    assert.match(result.error, /KB/);
  });

  it("**恰好等于上限时接受**（边界包含）", () => {
    const prefix = "data:image/png;base64,";
    const exact = prefix + "A".repeat(MAX_DATA_URL_LENGTH - prefix.length);
    assert.equal(exact.length, MAX_DATA_URL_LENGTH);
    assert.ok(validateAvatarDataUrl(exact).ok);
    assert.equal(validateAvatarDataUrl(`${exact}A`).ok, false, "再多一个字符就该拒绝");
  });
});

describe("historyToPrune()", () => {
  const day = (n: number) => new Date(2026, 9, n);
  const rows = Array.from({ length: 8 }, (_, i) => ({
    id: `h${i}`,
    createdAt: day(i + 1),
  }));

  it("超出上限时返回最旧的几条", () => {
    const prune = historyToPrune(rows, 5);
    assert.equal(prune.length, 3);
    assert.deepEqual(prune.sort(), ["h0", "h1", "h2"]);
  });

  it("不超过上限时什么都不删", () => {
    assert.deepEqual(historyToPrune(rows.slice(0, 3), 5), []);
    assert.deepEqual(historyToPrune([], 5), []);
  });

  it("恰好等于上限时不删", () => {
    assert.deepEqual(historyToPrune(rows.slice(0, 5), 5), []);
  });

  it("**乱序输入也按时间判断** —— 不能依赖调用方传来的顺序", () => {
    const shuffled = [rows[7]!, rows[0]!, rows[3]!, rows[1]!, rows[6]!, rows[2]!, rows[5]!, rows[4]!];
    const prune = historyToPrune(shuffled, 5).sort();
    assert.deepEqual(prune, ["h0", "h1", "h2"], "最旧的三个应当被删");
  });

  it("不改动入参数组", () => {
    const before = rows.map((r) => r.id);
    historyToPrune(rows, 5);
    assert.deepEqual(
      rows.map((r) => r.id),
      before,
    );
  });

  it("默认上限是 5", () => {
    assert.equal(AVATAR_HISTORY_LIMIT, 5);
    assert.equal(historyToPrune(rows).length, 3);
  });

  it("时间完全相同时不抛错（同一次请求里插入的多条）", () => {
    const same = [
      { id: "a", createdAt: day(1) },
      { id: "b", createdAt: day(1) },
      { id: "c", createdAt: day(1) },
    ];
    assert.equal(historyToPrune(same, 2).length, 1);
  });
});
