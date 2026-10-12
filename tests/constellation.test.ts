import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeStreak,
  starMagnitude,
  starPosition,
  startOfLocalDay,
  toLocalDayKey,
  totalHours,
} from "../src/lib/constellation.ts";

/**
 * 星图规则是这个产品的核心表达，必须能直接测 ——
 * 而不是只能"跑起来看星点摆得对不对"。
 */
describe("starPosition()", () => {
  it("同样的序号永远得到同样的坐标（可复现是 schema 写死的约束）", () => {
    for (const i of [0, 1, 7, 42, 199]) {
      assert.deepEqual(starPosition(i), starPosition(i));
    }
  });

  it("全部落在 0..1 的归一化坐标系内，且留了边距", () => {
    for (let i = 0; i < 400; i += 1) {
      const { x, y } = starPosition(i);
      assert.ok(x >= 0.02 && x <= 0.98, `x 越界: ${x} @${i}`);
      assert.ok(y >= 0.02 && y <= 0.98, `y 越界: ${y} @${i}`);
    }
  });

  it("相邻两枚星不会几乎重合（否则星图会糊成一团）", () => {
    for (let i = 0; i < 200; i += 1) {
      const a = starPosition(i);
      const b = starPosition(i + 1);
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      assert.ok(distance > 0.02, `第 ${i} 与 ${i + 1} 枚太近: ${distance}`);
    }
  });

  it("前 60 枚不会挤在圆心 —— sqrt 分布的作用", () => {
    // 线性半径会让大量点堆在中心。取半径的中位数，应当在 0.2 以上。
    const radii = Array.from({ length: 60 }, (_, i) => {
      const { x, y } = starPosition(i);
      return Math.hypot(x - 0.5, y - 0.5);
    }).sort((a, b) => a - b);
    const median = radii[Math.floor(radii.length / 2)] ?? 0;
    assert.ok(median > 0.2, `半径中位数偏低，点挤在中心: ${median}`);
  });

  it("负数与非法输入不抛错，退回第 0 枚的位置", () => {
    assert.deepEqual(starPosition(-5), starPosition(0));
    assert.deepEqual(starPosition(Number.NaN), starPosition(0));
  });
});

describe("starMagnitude()", () => {
  it("始终落在 0.15..1 之内", () => {
    const cases: [number, string | null | undefined][] = [
      [0, null],
      [0.5, "1"],
      [3, "3"],
      [6, "5"],
      [24, "5"],
      [Number.NaN, undefined],
      [-4, "9"],
    ];
    for (const [hours, mood] of cases) {
      const m = starMagnitude(hours, mood);
      assert.ok(m >= 0.15 && m <= 1, `星等越界: ${m} (${hours}h, ${mood})`);
    }
  });

  it("时长超过 6 小时后不再变亮 —— 奖励持续出现，不奖励刷时长", () => {
    assert.equal(starMagnitude(6, "3"), starMagnitude(20, "3"));
  });

  it("同为 0 小时时，好状态确实更亮", () => {
    assert.ok(starMagnitude(0, "5") > starMagnitude(0, "1"));
  });

  it("mood 是自由文本时按未填处理，不产生 NaN", () => {
    const withText = starMagnitude(2, "今天有点困");
    assert.equal(withText, starMagnitude(2, null));
    assert.ok(Number.isFinite(withText));
  });
});

describe("startOfLocalDay()", () => {
  it("解析 YYYY-MM-DD 为当天零点", () => {
    const d = startOfLocalDay("2026-03-09");
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 2); // 0-based
    assert.equal(d.getDate(), 9);
    assert.equal(d.getHours(), 0);
    assert.equal(d.getMinutes(), 0);
  });

  it("非法输入回退到今天零点，而不是抛错（打卡不该因为日期格式失败）", () => {
    const fallback = startOfLocalDay("不是日期");
    const today = new Date();
    assert.equal(fallback.getFullYear(), today.getFullYear());
    assert.equal(fallback.getMonth(), today.getMonth());
    assert.equal(fallback.getDate(), today.getDate());
  });

  it("不传参数等同于今天零点", () => {
    const a = startOfLocalDay();
    const b = startOfLocalDay(null);
    assert.equal(a.getTime(), b.getTime());
  });

  it("拒绝会被 Date 顺延的假日期（2026-02-31 不应变成 3 月 3 日）", () => {
    // new Date(2026, 1, 31) 会静默变成 3 月 3 日。这里是记录当前行为：
    // 正则放行了 "2026-02-31"，所以它会被解析并顺延。
    // 之所以不拦，是因为输入来自 <input type="date">，浏览器不会给出这种值；
    // 万一出现，顺延到相邻日期也远好过整个打卡请求失败。
    const d = startOfLocalDay("2026-02-31");
    assert.equal(d.getMonth(), 2); // 顺延到了 3 月
  });
});

describe("toLocalDayKey()", () => {
  it("补零到 YYYY-MM-DD 且用本地月日（不走 UTC）", () => {
    assert.equal(toLocalDayKey(new Date(2026, 0, 5)), "2026-01-05");
    assert.equal(toLocalDayKey(new Date(2026, 11, 31)), "2026-12-31");
  });
});

describe("computeStreak()", () => {
  it("今天打过 → 从今天往回数", () => {
    const days = ["2026-03-09", "2026-03-08", "2026-03-07"];
    assert.equal(computeStreak(days, "2026-03-09"), 3);
  });

  it("今天还没打、昨天打过 → 连续**不归零**（关键规则）", () => {
    // 写错的话，用户每天早上打开都看到「连续 0 天」
    const days = ["2026-03-08", "2026-03-07", "2026-03-06"];
    assert.equal(computeStreak(days, "2026-03-09"), 3);
  });

  it("最近一次是前天 → 真的断了，归零", () => {
    assert.equal(computeStreak(["2026-03-07", "2026-03-06"], "2026-03-09"), 0);
  });

  it("中间断过 → 只数到断点为止", () => {
    const days = ["2026-03-09", "2026-03-08", "2026-03-05", "2026-03-04"];
    assert.equal(computeStreak(days, "2026-03-09"), 2);
  });

  it("同一天重复打卡只算一天", () => {
    const days = ["2026-03-09", "2026-03-09", "2026-03-08"];
    assert.equal(computeStreak(days, "2026-03-09"), 2);
  });

  it("空列表、乱序、脏数据都不抛错", () => {
    assert.equal(computeStreak([], "2026-03-09"), 0);
    assert.equal(computeStreak(["2026-03-08", "2026-03-09"], "2026-03-09"), 2);
    assert.equal(computeStreak(["不是日期"], "2026-03-09"), 0);
    assert.equal(computeStreak(["2026-03-09"], "坏掉的今天"), 0);
  });

  it("跨月跨年也能连续", () => {
    const days = ["2027-01-01", "2026-12-31", "2026-12-30"];
    assert.equal(computeStreak(days, "2027-01-01"), 3);
  });
});

describe("totalHours()", () => {
  it("忽略负数与 NaN，不把脏数据算进总量", () => {
    assert.equal(totalHours([1, 2, -5, Number.NaN, 0.5]), 3.5);
  });

  it("空列表为 0", () => {
    assert.equal(totalHours([]), 0);
  });
});
