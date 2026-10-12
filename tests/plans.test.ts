import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  groupTasksByDay,
  nextTaskStatus,
  normalizeTaskStatus,
  planProgress,
  progressSummary,
} from "../src/lib/plans.ts";

const t = (...statuses: string[]) => statuses.map((status) => ({ status }));

describe("normalizeTaskStatus()", () => {
  it("合法状态原样返回", () => {
    for (const s of ["pending", "doing", "done", "skipped"]) {
      assert.equal(normalizeTaskStatus(s), s);
    }
  });

  it("脏值一律回退到 pending —— 库里存的是字符串，脏值是可能出现的", () => {
    for (const bad of ["", "DONE", "完成", null, undefined, "archived"]) {
      assert.equal(normalizeTaskStatus(bad), "pending");
    }
  });
});

describe("nextTaskStatus()", () => {
  it("循环切换：待开始 → 进行中 → 已完成 → 待开始", () => {
    assert.equal(nextTaskStatus("pending"), "doing");
    assert.equal(nextTaskStatus("doing"), "done");
    assert.equal(nextTaskStatus("done"), "pending");
  });

  it("已跳过再点一次回到待开始（跳过不该是个死胡同）", () => {
    assert.equal(nextTaskStatus("skipped"), "pending");
  });

  it("脏输入当成待开始处理", () => {
    assert.equal(nextTaskStatus("乱写的"), "doing");
  });
});

describe("planProgress()", () => {
  it("空计划是 0 而不是 NaN", () => {
    const p = planProgress([]);
    assert.equal(p.total, 0);
    assert.equal(p.ratio, 0);
    assert.ok(Number.isFinite(p.ratio));
  });

  it("**分母减掉已跳过** —— 否则放弃一个任务就永远到不了 100%", () => {
    // 4 项里 3 项完成、1 项正当跳过：这个计划就是完成了
    const p = planProgress(t("done", "done", "done", "skipped"));
    assert.equal(p.total, 4);
    assert.equal(p.done, 3);
    assert.equal(p.skipped, 1);
    assert.equal(p.ratio, 1, "3/(4-1) 应当是 1");
  });

  it("全部跳过时不除零", () => {
    const p = planProgress(t("skipped", "skipped"));
    assert.equal(p.ratio, 0);
    assert.ok(Number.isFinite(p.ratio));
  });

  it("进行中的任务不算完成，但要被统计", () => {
    const p = planProgress(t("done", "doing", "pending"));
    assert.equal(p.doing, 1);
    assert.equal(p.done, 1);
    assert.equal(Math.round(p.ratio * 100), 33);
  });

  it("脏状态按待开始计入分母", () => {
    const p = planProgress(t("done", "乱写的"));
    assert.equal(p.total, 2);
    assert.equal(p.ratio, 0.5);
  });
});

describe("progressSummary()", () => {
  it("空计划给一句人话", () => {
    assert.equal(progressSummary(planProgress([])), "还没有任务");
  });

  it("全部未开始时直接说项数", () => {
    assert.equal(progressSummary(planProgress(t("pending", "pending"))), "2 项待开始");
  });

  it("有进展时列出完成、进行中与跳过", () => {
    const text = progressSummary(planProgress(t("done", "doing", "skipped", "pending")));
    assert.match(text, /1\/3 已完成/); // 分母 4-1=3
    assert.match(text, /1 项进行中/);
    assert.match(text, /1 项已跳过/);
  });
});

describe("groupTasksByDay()", () => {
  it("按天升序分组", () => {
    const groups = groupTasksByDay([
      { dayNumber: 3, id: "c" },
      { dayNumber: 1, id: "a" },
      { dayNumber: 2, id: "b" },
    ]);
    assert.deepEqual(
      groups.map((g) => g.day),
      [1, 2, 3],
    );
  });

  it("**未排期（null）排在最后**，而不是排在最前", () => {
    const groups = groupTasksByDay([
      { dayNumber: null, id: "x" },
      { dayNumber: 2, id: "b" },
    ]);
    assert.deepEqual(
      groups.map((g) => g.day),
      [2, null],
    );
  });

  it("同一批里保持原有顺序", () => {
    const groups = groupTasksByDay([
      { dayNumber: 1, id: "a" },
      { dayNumber: 1, id: "b" },
      { dayNumber: 1, id: "c" },
    ]);
    assert.deepEqual(
      groups[0]?.items.map((i) => i.id),
      ["a", "b", "c"],
    );
  });

  it("空列表不抛错", () => {
    assert.deepEqual(groupTasksByDay([]), []);
  });
});
