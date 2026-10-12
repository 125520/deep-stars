import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  availableYears,
  buildAnnualReport,
  describeDay,
} from "../src/lib/annual.ts";

const empty = { year: 2026, minutesByDay: new Map<string, number>(), starDays: [] };

describe("buildAnnualReport() 的空年份", () => {
  it("没有数据时全是 0，不是 NaN", () => {
    const r = buildAnnualReport(empty);
    assert.equal(r.totalMinutes, 0);
    assert.equal(r.totalHours, 0);
    assert.equal(r.activeDays, 0);
    assert.equal(r.longestStreak, 0);
    assert.equal(r.stars, 0);
    assert.equal(r.bestMonth, null);
    assert.equal(r.bestDay, null);
    assert.equal(r.firstDay, null);
    assert.equal(r.lastDay, null);
    assert.deepEqual(r.monthly, new Array(12).fill(0));
  });
});

describe("buildAnnualReport() 的年度过滤", () => {
  it("**只统计本年数据**，其他年份的混进来也不会算", () => {
    const r = buildAnnualReport({
      year: 2026,
      minutesByDay: new Map([
        ["2025-12-31", 999],
        ["2026-01-01", 60],
        ["2027-01-01", 888],
      ]),
      starDays: ["2025-12-31", "2026-01-01", "2027-01-01"],
    });
    assert.equal(r.totalMinutes, 60);
    assert.equal(r.activeDays, 1);
    assert.equal(r.stars, 1);
    assert.equal(r.firstDay, "2026-01-01");
    assert.equal(r.lastDay, "2026-01-01");
  });

  it("闰年的 2 月 29 日被正常计入", () => {
    const r = buildAnnualReport({
      year: 2028, // 闰年
      minutesByDay: new Map([
        ["2028-02-28", 30],
        ["2028-02-29", 45],
      ]),
      starDays: ["2028-02-28", "2028-02-29"],
    });
    assert.equal(r.activeDays, 2);
    assert.equal(r.monthly[1], 75, "两天都应落在 2 月");
  });
});

describe("buildAnnualReport() 的聚合", () => {
  const report = buildAnnualReport({
    year: 2026,
    minutesByDay: new Map([
      ["2026-01-05", 60],
      ["2026-01-20", 30],
      ["2026-03-09", 200],
      ["2026-03-10", 240],
      ["2026-07-01", 120],
    ]),
    starDays: ["2026-01-05", "2026-01-20", "2026-03-09", "2026-03-10", "2026-07-01"],
  });

  it("总计正确", () => {
    assert.equal(report.totalMinutes, 650);
    assert.equal(report.totalHours, 10.8);
    assert.equal(report.activeDays, 5);
    assert.equal(report.stars, 5);
  });

  it("月度分布落在正确的月份", () => {
    assert.equal(report.monthly[0], 90); // 1 月
    assert.equal(report.monthly[2], 440); // 3 月
    assert.equal(report.monthly[6], 120); // 7 月
    assert.equal(report.monthly[1], 0); // 2 月
    assert.equal(
      report.monthly.reduce((a, b) => a + b, 0),
      report.totalMinutes,
      "各月之和应当等于总计",
    );
  });

  it("**最好的一天取最早的那个并列值** —— 否则结果会随遍历顺序变", () => {
    const tied = buildAnnualReport({
      year: 2026,
      minutesByDay: new Map([
        ["2026-05-10", 300],
        ["2026-02-01", 300],
        ["2026-09-09", 300],
      ]),
      starDays: [],
    });
    assert.equal(tied.bestDay?.key, "2026-02-01");
  });

  it("最好的一个月有标签", () => {
    assert.equal(report.bestMonth?.month, 3);
    assert.equal(report.bestMonth?.label, "3月");
    assert.equal(report.bestMonth?.minutes, 440);
  });

  it("首末日期按时间先后取，不受插入顺序影响", () => {
    assert.equal(report.firstDay, "2026-01-05");
    assert.equal(report.lastDay, "2026-07-01");
  });

  it("最长连续只在本年内计算", () => {
    // 3/9 与 3/10 是连续两天；1 月那两天不相邻
    assert.equal(report.longestStreak, 2);
  });
});

describe("buildAnnualReport() 的脏数据", () => {
  it("负数与 NaN 被跳过，不影响其余聚合", () => {
    const r = buildAnnualReport({
      year: 2026,
      minutesByDay: new Map([
        ["2026-01-01", 60],
        ["2026-01-02", Number.NaN],
        ["2026-01-03", -30],
        ["2026-01-04", 0],
      ]),
      starDays: [],
    });
    assert.equal(r.totalMinutes, 60);
    assert.equal(r.activeDays, 1);
    assert.ok(Number.isFinite(r.totalHours));
  });

  it("没有任何有效值时 bestDay 为 null 而不是 undefined 结构", () => {
    const r = buildAnnualReport({
      year: 2026,
      minutesByDay: new Map([["2026-01-01", 0]]),
      starDays: [],
    });
    assert.equal(r.bestDay, null);
    assert.equal(r.bestMonth, null);
  });

  it("重复的打卡日期只算一颗星", () => {
    const r = buildAnnualReport({
      year: 2026,
      minutesByDay: new Map([["2026-01-01", 60]]),
      starDays: ["2026-01-01", "2026-01-01", "2026-01-01"],
    });
    assert.equal(r.stars, 1);
  });

  it("其他年份的打卡不会污染本年的连续天数", () => {
    const r = buildAnnualReport({
      year: 2026,
      minutesByDay: new Map([["2026-01-01", 60]]),
      // 2025-12-31 与 2026-01-01 现实里是连着的，但年报不该把它算成 2 天
      starDays: ["2025-12-31", "2026-01-01"],
    });
    assert.equal(r.longestStreak, 1);
  });
});

describe("availableYears()", () => {
  it("列出有数据的年份与今年，降序", () => {
    const years = availableYears(
      ["2023-05-01", "2025-01-01", "2026-03-01"],
      2026,
    );
    assert.deepEqual(years, [2026, 2025, 2023]);
  });

  it("今年总在列表里，哪怕没有任何数据", () => {
    assert.deepEqual(availableYears([], 2026), [2026]);
  });

  it("未来年份被排除（脏数据不该造出 2099 年的入口）", () => {
    assert.deepEqual(availableYears(["2099-01-01"], 2026), [2026]);
  });

  it("重复年份只出现一次", () => {
    assert.deepEqual(availableYears(["2026-01-01", "2026-02-01"], 2026), [2026]);
  });

  it("脏键名被忽略", () => {
    assert.deepEqual(availableYears(["坏日期", "2026-01-01"], 2026), [2026]);
  });
});

describe("describeDay()", () => {
  it("按投入量给不同的话", () => {
    assert.equal(describeDay(0), "没有记录");
    assert.equal(describeDay(10), "轻轻碰了一下");
    assert.equal(describeDay(60), "认真了一段时间");
    assert.equal(describeDay(200), "投入了大半天");
    assert.equal(describeDay(400), "几乎一整天");
    assert.equal(describeDay(700), "那一整天都在里面");
  });

  it("NaN 与负数不产生乱码", () => {
    assert.equal(describeDay(Number.NaN), "没有记录");
    assert.equal(describeDay(-10), "没有记录");
  });
});
