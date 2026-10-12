import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  constellationProgress,
  patternSize,
  pickComplexity,
  planComplexityScore,
  slotPosition,
  starPosition,
} from "../src/lib/constellation.ts";

/** 一个假模板：三枚星，摆成一条斜线 */
const PATTERN = {
  stars: [
    { x: 0.2, y: 0.2 },
    { x: 0.5, y: 0.5 },
    { x: 0.8, y: 0.8 },
  ],
};

describe("slotPosition() 有模板时按模板落位", () => {
  it("第 0 枚星落在模板的第一个点上", () => {
    assert.deepEqual(slotPosition(PATTERN, 0), { x: 0.2, y: 0.2 });
  });

  it("第 2 枚星落在模板的第三个点上", () => {
    assert.deepEqual(slotPosition(PATTERN, 2), { x: 0.8, y: 0.8 });
  });

  it("**超过模板长度后退回黄金角散点** —— 星座画满了还在涨，继续堆模板坐标会把图形糊掉", () => {
    const beyond = slotPosition(PATTERN, 3);
    assert.deepEqual(beyond, starPosition(3));
  });

  it("负数与非法值按 0 处理，不抛错", () => {
    assert.deepEqual(slotPosition(PATTERN, -5), { x: 0.2, y: 0.2 });
    assert.deepEqual(slotPosition(PATTERN, Number.NaN), { x: 0.2, y: 0.2 });
  });

  it("**没有模板时与加模板之前完全一致** —— 老用户的星图不能因为这次升级而改变", () => {
    for (const i of [0, 1, 7, 59, 60, 61]) {
      assert.deepEqual(slotPosition(null, i), starPosition(i), `第 ${i} 枚应当与黄金角散点一致`);
      assert.deepEqual(slotPosition(undefined, i), starPosition(i));
    }
  });

  it("模板坐标越界时被夹回 0.02..0.98，不会画到面板外", () => {
    const wild = { stars: [{ x: -3, y: 9 }] };
    assert.deepEqual(slotPosition(wild, 0), { x: 0.02, y: 0.98 });
  });
});

describe("patternSize() 与 constellationProgress()", () => {
  it("模板为空时永远不算完成 —— 否则黄金角布局会在第 60 枚星时莫名宣布完成", () => {
    const p = constellationProgress(null, 999);
    assert.equal(p.total, 0);
    assert.equal(p.complete, false);
    assert.equal(p.ratio, 0);
  });

  it("星点占满模板才算完成", () => {
    assert.equal(constellationProgress(PATTERN, 2).complete, false);
    assert.equal(constellationProgress(PATTERN, 3).complete, true);
  });

  it("超额点亮时比例封顶在 1，不会算出 2.0", () => {
    const p = constellationProgress(PATTERN, 10);
    assert.equal(p.ratio, 1);
    assert.equal(p.lit, 3);
  });

  it("负数按 0 处理", () => {
    assert.equal(constellationProgress(PATTERN, -4).lit, 0);
  });

  it("patternSize 对 null 返回 0", () => {
    assert.equal(patternSize(null), 0);
    assert.equal(patternSize(PATTERN), 3);
  });
});

describe("planComplexityScore() 与 pickComplexity()", () => {
  it("**只想每天读点书的人拿到简约档** —— 完整档要两周才画完，中途看不出进展", () => {
    assert.equal(
      pickComplexity({ activePlans: 1, totalTasks: 5, longestPlanDays: 30 }),
      "simple",
    );
  });

  it("**同时铺开多个长期计划的人拿到完整档** —— 简约档一周就画满，之后无事可做", () => {
    assert.equal(
      pickComplexity({ activePlans: 3, totalTasks: 20, longestPlanDays: 90 }),
      "full",
    );
  });

  it("分数随任务数、计划数、周期单调不降", () => {
    const base = { activePlans: 1, totalTasks: 5, longestPlanDays: 10 };
    const b = planComplexityScore(base);
    assert.ok(planComplexityScore({ ...base, totalTasks: 9 }) > b);
    assert.ok(planComplexityScore({ ...base, activePlans: 3 }) > b);
    assert.ok(planComplexityScore({ ...base, longestPlanDays: 90 }) > b);
  });

  it("长期计划的额外分是三档，不是线性的", () => {
    assert.equal(planComplexityScore({ activePlans: 0, totalTasks: 0, longestPlanDays: 30 }), 0);
    assert.equal(planComplexityScore({ activePlans: 0, totalTasks: 0, longestPlanDays: 31 }), 3);
    assert.equal(planComplexityScore({ activePlans: 0, totalTasks: 0, longestPlanDays: 61 }), 6);
  });

  it("阈值正好 12 分是简约档，13 分才转完整档（边界包含）", () => {
    // 任务 9 + 计划 1×3 = 12
    assert.equal(pickComplexity({ activePlans: 1, totalTasks: 9, longestPlanDays: 0 }), "simple");
    // 任务 10 + 计划 1×3 = 13
    assert.equal(pickComplexity({ activePlans: 1, totalTasks: 10, longestPlanDays: 0 }), "full");
  });

  it("全零（新用户还没建计划）是简约档", () => {
    assert.equal(pickComplexity({ activePlans: 0, totalTasks: 0, longestPlanDays: 0 }), "simple");
  });

  it("非法输入被当作 0，不抛错也不产生 NaN", () => {
    const p = pickComplexity({ activePlans: Number.NaN, totalTasks: -5, longestPlanDays: Number.NaN });
    assert.equal(p, "simple");
    assert.ok(Number.isFinite(planComplexityScore({ activePlans: Number.NaN, totalTasks: 0, longestPlanDays: 0 })));
  });
});
