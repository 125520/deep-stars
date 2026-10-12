import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GRADE_LABELS,
  GRADES,
  describeInterval,
  gradeLabel,
  initialState,
  isDue,
  schedule,
  type Grade,
  type SrsResult,
  type SrsState,
} from "../src/lib/srs.ts";

const NOW = new Date(2026, 2, 10, 9, 0); // 2026-03-10 09:00 本地
const fresh: SrsState = { ease: 2.5, interval: 0, reps: 0, lapses: 0 };

/** 连续按同一个评分走 n 步。返回 SrsResult，因为调用方要看 dueAt。 */
function repeat(state: SrsState, grade: Grade, times: number): SrsResult {
  let current: SrsResult =
    times > 0 ? schedule(state, grade, NOW) : { ...state, dueAt: NOW, state: "review" };
  for (let i = 1; i < times; i += 1) current = schedule(current, grade, NOW);
  return current;
}

describe("initialState()", () => {
  it("新卡片立刻可复习", () => {
    const s = initialState(NOW);
    assert.equal(s.ease, 2.5);
    assert.equal(s.reps, 0);
    assert.equal(s.interval, 0);
    assert.ok(isDue(s, NOW));
  });
});

describe("schedule() 的确定性", () => {
  it("同样的输入永远得到同样的输出", () => {
    const a = schedule(fresh, "good", NOW);
    const b = schedule(fresh, "good", NOW);
    assert.deepEqual(a, b);
  });

  it("不修改传入的 state", () => {
    const before = { ...fresh };
    schedule(fresh, "easy", NOW);
    assert.deepEqual(fresh, before);
  });

  it("四档评分都能跑通", () => {
    for (const grade of GRADES) {
      assert.doesNotThrow(() => schedule(fresh, grade, NOW));
    }
  });
});

describe("答错（again）", () => {
  it("**当天重来，不是明天** —— 刚答错的卡要趁热再看一次", () => {
    const result = schedule(fresh, "again", NOW);
    assert.equal(result.state, "learning");
    const minutes = (result.dueAt.getTime() - NOW.getTime()) / 60_000;
    assert.ok(minutes > 0 && minutes <= 30, `应当在几十分钟内重来，实际 ${minutes} 分钟`);
  });

  it("连续答对次数归零、遗忘次数加一", () => {
    const learned = repeat(fresh, "good", 4);
    assert.ok(learned.reps >= 4);
    const failed = schedule(learned, "again", NOW);
    assert.equal(failed.reps, 0);
    assert.equal(failed.lapses, 1);
  });

  it("**间隔归零**，不保留旧值", () => {
    // 留着旧间隔会让「连续答对次数」与间隔脱节，下次答对算出的间隔大得离谱
    const learned = repeat(fresh, "good", 5);
    assert.ok(learned.interval > 0);
    assert.equal(schedule(learned, "again", NOW).interval, 0);
  });

  it("易记因子下降", () => {
    const failed = schedule(fresh, "again", NOW);
    assert.ok(failed.ease < fresh.ease, `应当下降：${fresh.ease} → ${failed.ease}`);
  });
});

describe("易记因子的边界", () => {
  it("**永远不低于 1.35** —— 低于它间隔几乎不增长", () => {
    let state = fresh;
    for (let i = 0; i < 50; i += 1) state = schedule(state, "again", NOW);
    assert.ok(state.ease >= 1.35, `易记因子击穿下限: ${state.ease}`);
  });

  it("**永远不高于 3.2** —— 否则连续点「很简单」会让间隔膨胀失控", () => {
    let state = fresh;
    for (let i = 0; i < 50; i += 1) state = schedule(state, "easy", NOW);
    assert.ok(state.ease <= 3.2, `易记因子击穿上限: ${state.ease}`);
  });

  it("只有「很简单」会奖励，「再来一次」会惩罚，「记得」维持现状", () => {
    assert.ok(schedule(fresh, "easy", NOW).ease > fresh.ease);
    assert.ok(schedule(fresh, "again", NOW).ease < fresh.ease);
    assert.equal(schedule(fresh, "good", NOW).ease, fresh.ease);
    assert.ok(schedule(fresh, "hard", NOW).ease < fresh.ease);
  });
});

describe("间隔增长", () => {
  it("连续答「记得」的间隔严格递增", () => {
    let state = fresh;
    let previous = 0;
    for (let i = 0; i < 6; i += 1) {
      state = schedule(state, "good", NOW);
      assert.ok(
        state.interval > previous,
        `第 ${i + 1} 次间隔没有增长：${previous} → ${state.interval}`,
      );
      previous = state.interval;
    }
  });

  it("第二次答「记得」落在 6 天（SM-2 的原始取值）", () => {
    const once = schedule(fresh, "good", NOW);
    const twice = schedule(once, "good", NOW);
    assert.equal(once.interval, 1);
    assert.equal(twice.interval, 6);
  });

  it("长期看：easy 的间隔 > good > hard", () => {
    const easy = repeat(fresh, "easy", 5).interval;
    const good = repeat(fresh, "good", 5).interval;
    const hard = repeat(fresh, "hard", 5).interval;
    assert.ok(easy > good, `easy(${easy}) 应当大于 good(${good})`);
    assert.ok(good > hard, `good(${good}) 应当大于 hard(${hard})`);
  });

  it("答「有点难」不归零，但增长缓慢", () => {
    const once = schedule(fresh, "good", NOW);
    const hard = schedule(once, "hard", NOW);
    assert.ok(hard.interval >= 1, "不该归零");
    assert.ok(hard.interval < schedule(once, "good", NOW).interval, "应当比 good 慢");
  });

  it("**间隔封顶 10 年** —— 算错的大数等于让卡片消失", () => {
    const state = repeat(fresh, "easy", 200);
    assert.ok(state.interval <= 3650, `间隔越界: ${state.interval}`);
    assert.ok(Number.isFinite(state.dueAt.getTime()), "dueAt 不该是 Invalid Date");
  });

  it("任何情况下间隔都是非负整数", () => {
    let state = fresh;
    for (const grade of GRADES) {
      state = schedule(state, grade, NOW);
      assert.ok(Number.isInteger(state.interval), `不是整数: ${state.interval}`);
      assert.ok(state.interval >= 0);
    }
  });
});

describe("到期时间", () => {
  it("按间隔天数推后", () => {
    const result = schedule(fresh, "good", NOW);
    assert.equal(result.interval, 1);
    assert.equal(result.dueAt.getDate(), NOW.getDate() + 1);
    assert.equal(result.dueAt.getHours(), NOW.getHours());
  });

  it("**跨月与跨年都正确**（用构造器推日期，不是加毫秒）", () => {
    const endOfMonth = new Date(2026, 2, 31, 9, 0); // 3 月 31 日
    const result = schedule({ ...fresh, interval: 6, reps: 3 }, "good", endOfMonth);
    assert.ok(result.dueAt.getTime() > endOfMonth.getTime());
    assert.equal(result.dueAt.getMonth(), 3, "应当落在 4 月");
  });

  it("走完间隔之后才到期", () => {
    const result = schedule(fresh, "good", NOW);
    assert.ok(!isDue(result, NOW), "刚复习完不该立刻又到期");
    assert.ok(isDue(result, new Date(NOW.getTime() + 2 * 86_400_000)));
  });

  it("到期时间永远晚于现在（含答错的短间隔）", () => {
    // 显式标注类型：要在循环里读 dueAt，而 SrsState 没有这个字段
    let state: SrsResult = { ...fresh, dueAt: NOW, state: "review" };
    for (const grade of [...GRADES, ...GRADES]) {
      state = schedule(state, grade, NOW);
      assert.ok(state.dueAt.getTime() > NOW.getTime(), `${grade} 的到期时间不晚于现在`);
    }
  });
});

describe("describeInterval()", () => {
  it("0 与负数说「今天」", () => {
    assert.equal(describeInterval(0), "今天");
    assert.equal(describeInterval(-3), "今天");
  });

  it("1 天说「明天」，其余按天", () => {
    assert.equal(describeInterval(1), "明天");
    assert.equal(describeInterval(6), "6 天后");
  });

  it("超过 30 天按月，超过 365 天按年", () => {
    assert.equal(describeInterval(60), "2 个月后");
    assert.equal(describeInterval(400), "1 年后");
    assert.equal(describeInterval(800), "2 年后");
  });

  it("NaN 不产生乱码", () => {
    assert.equal(describeInterval(Number.NaN), "今天");
  });
});

describe("gradeLabel()", () => {
  it("每一档都有中文标签，没有漏掉的", () => {
    for (const grade of GRADES) {
      assert.ok(gradeLabel(grade).length > 0, `${grade} 缺少标签`);
      assert.equal(gradeLabel(grade), GRADE_LABELS[grade]);
    }
  });
});
