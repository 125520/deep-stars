import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  activeDays,
  addDays,
  buildHeatmap,
  levelFor,
  longestStreak,
  mergeDayMinutes,
  monthLabels,
  startOfWeek,
  sumGrid,
} from "../src/lib/heatmap.ts";

describe("addDays()", () => {
  it("跨月跨年都正确", () => {
    assert.equal(addDays(new Date(2026, 0, 31), 1).getMonth(), 1);
    assert.equal(addDays(new Date(2026, 11, 31), 1).getFullYear(), 2027);
  });

  it("**跨夏令时仍然落在同一天**（加毫秒的写法会错位）", () => {
    // 2026-03-08 是美国夏令时开始日。加 86400000 毫秒会得到 3/9 的 23:00，
    // 用 Date 构造器则由它负责归一化。
    const start = new Date(2026, 2, 7);
    for (let i = 1; i <= 5; i += 1) {
      const d = addDays(start, i);
      assert.equal(d.getDate(), 7 + i, `第 ${i} 天落点不对`);
      assert.equal(d.getHours(), 0, `第 ${i} 天不是零点`);
    }
  });
});

describe("startOfWeek()", () => {
  it("周一返回自身", () => {
    // 2026-03-09 是周一
    assert.equal(startOfWeek(new Date(2026, 2, 9)).getDate(), 9);
  });

  it("周日归到**上一个**周一（中文语境里一周从周一起）", () => {
    const sunday = new Date(2026, 2, 15);
    assert.equal(sunday.getDay(), 0, "前提：这天确实是周日");
    assert.equal(startOfWeek(sunday).getDate(), 9);
  });

  it("周六归到本周一，不是下周", () => {
    const saturday = new Date(2026, 2, 14);
    assert.equal(saturday.getDay(), 6);
    assert.equal(startOfWeek(saturday).getDate(), 9);
  });
});

describe("levelFor()", () => {
  it("0 与负数都是 0 级", () => {
    assert.equal(levelFor(0, [1, 30, 60, 120]), 0);
    assert.equal(levelFor(-10, [1, 30, 60, 120]), 0);
  });

  it("按'达到或超过第几档'分级", () => {
    assert.equal(levelFor(1, [1, 30, 60, 120]), 1);
    assert.equal(levelFor(29, [1, 30, 60, 120]), 1);
    assert.equal(levelFor(30, [1, 30, 60, 120]), 2);
    assert.equal(levelFor(60, [1, 30, 60, 120]), 3);
    assert.equal(levelFor(120, [1, 30, 60, 120]), 4);
    assert.equal(levelFor(9999, [1, 30, 60, 120]), 4, "超过最高档仍封顶 4");
  });

  it("NaN 归 0，不会产生非法等级", () => {
    assert.equal(levelFor(Number.NaN, [1, 30, 60, 120]), 0);
  });
});

describe("buildHeatmap()", () => {
  const end = new Date(2026, 2, 15); // 周日
  const values = new Map([
    ["2026-03-09", 45], // 周一
    ["2026-03-11", 5], // 周三
  ]);

  it("列数正确，每列恰好 7 天", () => {
    const grid = buildHeatmap(values, end, 4);
    assert.equal(grid.length, 4);
    for (const week of grid) assert.equal(week.length, 7);
  });

  it("最后一列的最后一个格就是 endDate", () => {
    const grid = buildHeatmap(values, end, 4);
    const last = grid[3]?.[6];
    assert.equal(last?.key, "2026-03-15");
  });

  it("第一列从周一开始", () => {
    const grid = buildHeatmap(values, end, 4);
    const first = grid[0]?.[0];
    assert.equal(first?.key, "2026-02-16", "4 周前那一周的周一");
  });

  it("日期与数值对得上，等级按阈值算出", () => {
    const grid = buildHeatmap(values, end, 2);
    const flat = grid.flat();
    const hit = flat.find((d) => d.key === "2026-03-09");
    assert.equal(hit?.value, 45);
    assert.equal(hit?.level, 2); // 45 ≥ 30
    const small = flat.find((d) => d.key === "2026-03-11");
    assert.equal(small?.value, 5);
    assert.equal(small?.level, 1); // 5 ≥ 1 但 < 30
  });

  it("没有数据的日子是 0 级，而不是缺格", () => {
    const grid = buildHeatmap(values, end, 2);
    const empty = grid.flat().find((d) => d.key === "2026-03-10");
    assert.equal(empty?.value, 0);
    assert.equal(empty?.level, 0);
  });

  it("**晚于结束日的格子标记为 future**，与'没学习'区分开", () => {
    // end 是周日，网格末尾不会多出格子；换一个周三来测
    const grid = buildHeatmap(new Map(), new Date(2026, 2, 11), 1);
    const week = grid[0]!;
    assert.equal(week[2]?.key, "2026-03-11");
    assert.equal(week[2]?.future, false);
    assert.equal(week[3]?.future, true, "周四应当标记为未来");
    assert.equal(week[6]?.future, true, "周日应当标记为未来");
  });

  it("weeks 非法时至少给一列，不返回空网格", () => {
    assert.equal(buildHeatmap(new Map(), end, 0).length, 1);
    assert.equal(buildHeatmap(new Map(), end, -5).length, 1);
  });
});

describe("longestStreak()", () => {
  it("空列表为 0", () => {
    assert.equal(longestStreak([]), 0);
  });

  it("找出历史最长，而不是当前", () => {
    // 一段 4 连，一段 2 连
    const days = [
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-10",
      "2026-03-11",
    ];
    assert.equal(longestStreak(days), 4);
  });

  it("乱序与重复都不影响结果", () => {
    const days = ["2026-03-11", "2026-03-10", "2026-03-10", "2026-03-12"];
    assert.equal(longestStreak(days), 3);
  });

  it("跨月跨年连续算作一段", () => {
    assert.equal(longestStreak(["2026-12-31", "2027-01-01", "2027-01-02"]), 3);
  });

  it("脏数据被忽略而不是中断整段", () => {
    const days = ["2026-03-01", "坏日期", "2026-03-02", "2026-03-03"];
    assert.equal(longestStreak(days), 3);
  });

  it("单日算 1", () => {
    assert.equal(longestStreak(["2026-03-01"]), 1);
  });
});

describe("网格聚合", () => {
  const grid = buildHeatmap(
    new Map([
      ["2026-03-09", 30],
      ["2026-03-11", 70],
    ]),
    new Date(2026, 2, 11),
    1,
  );

  it("求和只算非 future 的格子", () => {
    assert.equal(sumGrid(grid), 100);
  });

  it("活跃天数只数有值的非未来天", () => {
    assert.equal(activeDays(grid), 2);
  });

  it("空网格求和为 0", () => {
    assert.equal(sumGrid(buildHeatmap(new Map(), new Date(2026, 2, 11), 2)), 0);
  });
});

describe("mergeDayMinutes()", () => {
  it("只有一个来源时原样保留", () => {
    const merged = mergeDayMinutes(new Map([["2026-03-09", 50]]), new Map());
    assert.equal(merged.get("2026-03-09"), 50);
  });

  it("同一天两个来源取**较大者**，不相加（相加就是重复计数）", () => {
    const merged = mergeDayMinutes(
      new Map([["2026-03-09", 25]]),
      new Map([["2026-03-09", 120]]),
    );
    assert.equal(merged.get("2026-03-09"), 120, "不能被 25 分钟的番茄钟压成 25");
  });

  it("**回归**：25 分钟计时器 + 2 小时手填，结果必须是 120 而不是 25", () => {
    // 这正是线上暴露过的问题：旧规则"有计时器就以计时器为准"，
    // 于是一个 25 分钟的番茄钟把用户手填的 2 小时永久压掉了。
    const merged = mergeDayMinutes(
      new Map([["2026-10-07", 25]]),
      new Map([["2026-10-07", 120]]),
    );
    assert.equal(merged.get("2026-10-07"), 120);
  });

  it("不同日期各自独立", () => {
    const merged = mergeDayMinutes(
      new Map([["2026-03-09", 30]]),
      new Map([["2026-03-10", 60]]),
    );
    assert.equal(merged.size, 2);
    assert.equal(merged.get("2026-03-09"), 30);
    assert.equal(merged.get("2026-03-10"), 60);
  });

  it("零值与脏值不产生条目", () => {
    const merged = mergeDayMinutes(
      new Map([
        ["2026-03-09", 0],
        ["2026-03-10", Number.NaN],
      ]),
      new Map([
        ["2026-03-09", 0],
        ["2026-03-11", -5],
      ]),
    );
    assert.equal(merged.size, 0);
  });

  it("手填有值而计时器为零时，以手填为准", () => {
    const merged = mergeDayMinutes(new Map(), new Map([["2026-03-09", 90]]));
    assert.equal(merged.get("2026-03-09"), 90);
  });
});

describe("monthLabels()", () => {
  it("列数与网格一致，且只在换月处出标签", () => {
    // 2026-01-05 是周一；往后推 10 周，只应跨 1 月→2 月→3 月
    const grid = buildHeatmap(new Map(), new Date(2026, 0, 5 + 69), 10);
    const labels = monthLabels(grid);
    assert.equal(labels.length, 10);
    const nonEmpty = labels.filter((l) => l !== "");
    assert.ok(nonEmpty.length >= 2 && nonEmpty.length <= 3, `实际: ${JSON.stringify(labels)}`);
  });

  it("间隔过近的月份标签被抑制 —— 网格从月末开始时两个标签会挤在一起", () => {
    // 从 3 月 30 日那一周开始，下一列就是 4 月，两列相邻
    const grid = buildHeatmap(new Map(), new Date(2026, 2, 30), 3);
    const labels = monthLabels(grid, 3);
    assert.equal(labels[0], "3月");
    assert.equal(labels[1], "", "相邻列不应再出标签");
    assert.equal(labels[2], "");
  });

  it("间隔足够远时两个标签都保留", () => {
    const grid = buildHeatmap(new Map(), new Date(2026, 4, 1), 8);
    const labels = monthLabels(grid, 3);
    assert.equal(labels.filter((l) => l !== "").length, 2, JSON.stringify(labels));
  });

  it("空网格返回空数组", () => {
    assert.deepEqual(monthLabels([]), []);
  });
});
