import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  composeMessage,
  detectSignals,
  pickCoachMessage,
  type CoachContext,
  type CoachSignal,
} from "../src/lib/coach.ts";

/** 构造一个"什么都不该提醒"的基线，各用例只改自己关心的那部分 */
function context(overrides: Partial<CoachContext> = {}): CoachContext {
  return {
    // 周三晚上 21:00 —— 过了断签提醒的时刻
    now: new Date(2026, 9, 7, 21, 0),
    checkinDays: ["2026-10-06", "2026-10-07"],
    plans: [],
    reviewDue: 0,
    ...overrides,
  };
}

const kinds = (ctx: CoachContext) => detectSignals(ctx).map((s) => s.kind);

describe("detectSignals() 的静默条件", () => {
  it("正常在用时什么都不说 —— 一个不打扰的教练才是好教练", () => {
    assert.deepEqual(kinds(context()), []);
  });

  it("晚上之前不提醒断签（否则一天要被提醒好几次）", () => {
    const morning = context({ now: new Date(2026, 9, 7, 10, 0) });
    assert.equal(kinds(morning).includes("streak-at-risk"), false);
  });

  it("复习卡没积压到阈值不提醒", () => {
    assert.equal(kinds(context({ reviewDue: 9 })).includes("review-backlog"), false);
    assert.equal(kinds(context({ reviewDue: 10 })).includes("review-backlog"), true);
  });
});

describe("newcomer：一条记录都没有", () => {
  it("引导去点第一枚星", () => {
    const signals = detectSignals(context({ checkinDays: [] }));
    assert.equal(signals.length, 1, "新用户只该收到一条，不该被别的同时淹没");
    assert.equal(signals[0]?.kind, "newcomer");
  });

  it("措辞用「从点亮第一枚星开始」", () => {
    const message = composeMessage({ kind: "newcomer", priority: 10, data: {} });
    assert.match(message.title, /点亮第一枚星/);
    assert.equal(message.actionUrl, "/dashboard");
  });
});

describe("streak-at-risk：连续还活着但今天还没记", () => {
  it("昨天记过、今天没记、已到晚上 → 提醒", () => {
    const ctx = context({ checkinDays: ["2026-10-05", "2026-10-06"] });
    assert.equal(kinds(ctx).includes("streak-at-risk"), true);
  });

  it("今天已经记过 → 不提醒", () => {
    assert.equal(kinds(context()).includes("streak-at-risk"), false);
  });

  it("**连续已经断了就不提醒** —— 对已经断掉的人说「快接上」是指责", () => {
    // 最近一次是 3 天前，连续早就归零
    const ctx = context({ checkinDays: ["2026-10-01", "2026-10-02"] });
    assert.equal(kinds(ctx).includes("streak-at-risk"), false);
  });

  it("消息里带上真实的连续天数", () => {
    const ctx = context({ checkinDays: ["2026-10-04", "2026-10-05", "2026-10-06"] });
    const message = pickCoachMessage(ctx);
    assert.ok(message);
    assert.match(message.body, /连着 3 天/);
  });

  it("**优先级最高** —— 一次只说一句，先说最要紧的", () => {
    const ctx = context({
      checkinDays: ["2026-10-06"],
      reviewDue: 50,
      plans: [{ name: "线性代数", lastDoneAt: new Date(2026, 8, 1), openTasks: 5 }],
    });
    assert.equal(detectSignals(ctx)[0]?.kind, "streak-at-risk");
  });
});

describe("comeback：隔了几天又回来", () => {
  it("隔 3 天以上且今天记了 → 欢迎回来", () => {
    const ctx = context({ checkinDays: ["2026-10-03", "2026-10-07"] });
    assert.equal(kinds(ctx).includes("comeback"), true);
  });

  it("隔 2 天不算「回来」", () => {
    const ctx = context({ checkinDays: ["2026-10-05", "2026-10-07"] });
    assert.equal(kinds(ctx).includes("comeback"), false);
  });

  it("**措辞明确说「不用补」** —— 断签后的压力正是让人不敢回来的原因", () => {
    const message = composeMessage({ kind: "comeback", priority: 2, data: { gap: 5 } });
    assert.match(message.body, /不用补/);
    assert.match(message.body, /5 天/);
  });
});

describe("review-backlog：复习积压", () => {
  it("达到阈值才提醒，并带上数量", () => {
    const message = pickCoachMessage(context({ reviewDue: 12 }));
    assert.ok(message);
    assert.match(message.title, /12 张卡/);
    assert.equal(message.actionUrl, "/review");
  });
});

describe("plan-stalled：计划停滞", () => {
  const stale = new Date(2026, 8, 20); // 17 天前

  it("有未完成任务且久未推进 → 提醒", () => {
    const ctx = context({ plans: [{ name: "线性代数", lastDoneAt: stale, openTasks: 4 }] });
    const signal = detectSignals(ctx).find((s) => s.kind === "plan-stalled");
    assert.ok(signal);
    assert.equal(signal.data.plan, "线性代数");
    assert.equal(signal.data.days, 17);
  });

  it("没有未完成任务 → 不提醒（计划已经做完了）", () => {
    const ctx = context({ plans: [{ name: "线性代数", lastDoneAt: stale, openTasks: 0 }] });
    assert.equal(kinds(ctx).includes("plan-stalled"), false);
  });

  it("**从未完成过任务 → 不提醒** —— 没有基准点就谈不上停滞", () => {
    const ctx = context({ plans: [{ name: "新计划", lastDoneAt: null, openTasks: 4 }] });
    assert.equal(kinds(ctx).includes("plan-stalled"), false);
  });

  it("最近推进过 → 不提醒", () => {
    const ctx = context({
      plans: [{ name: "线性代数", lastDoneAt: new Date(2026, 9, 5), openTasks: 4 }],
    });
    assert.equal(kinds(ctx).includes("plan-stalled"), false);
  });

  it("消息里带上计划名与天数，并给出足够小的下一步", () => {
    const message = composeMessage({
      kind: "plan-stalled",
      priority: 4,
      data: { plan: "线性代数", days: 17, open: 4 },
    });
    assert.match(message.title, /线性代数/);
    assert.match(message.body, /最小的一项/);
    assert.equal(message.actionUrl, "/plans");
  });
});

describe("措辞纪律", () => {
  const all: CoachSignal[] = [
    { kind: "newcomer", priority: 10, data: {} },
    { kind: "streak-at-risk", priority: 1, data: { streak: 5 } },
    { kind: "comeback", priority: 2, data: { gap: 4 } },
    { kind: "review-backlog", priority: 3, data: { due: 20 } },
    { kind: "plan-stalled", priority: 4, data: { plan: "X", days: 9, open: 2 } },
  ];

  it("每条都有标题、正文与可点的去处", () => {
    for (const signal of all) {
      const message = composeMessage(signal);
      assert.ok(message.title.length > 0, `${signal.kind} 缺标题`);
      assert.ok(message.body.length > 0, `${signal.kind} 缺正文`);
      assert.ok(message.actionUrl.startsWith("/"), `${signal.kind} 的去处不是站内路径`);
    }
  });

  it("**不出现指责性词汇** —— 断签提醒若写成判决，人会不敢打开应用", () => {
    const banned = ["失败", "懒惰", "落后", "欠", "又没", "荒废", "应该"];
    for (const signal of all) {
      const text = composeMessage(signal).title + composeMessage(signal).body;
      for (const word of banned) {
        assert.ok(!text.includes(word), `${signal.kind} 的措辞里出现了「${word}」：${text}`);
      }
    }
  });

  it("数值缺失时用安全的默认值，不出现 NaN 或 undefined", () => {
    for (const signal of all) {
      const text = composeMessage({ ...signal, data: {} }).title + composeMessage({ ...signal, data: {} }).body;
      assert.ok(!text.includes("NaN"), `${signal.kind} 渲染出了 NaN`);
      assert.ok(!text.includes("undefined"), `${signal.kind} 渲染出了 undefined`);
    }
  });
});

describe("pickCoachMessage()", () => {
  it("没有值得说的就返回 null", () => {
    assert.equal(pickCoachMessage(context()), null);
  });

  it("只返回一条，且是优先级最高的那条", () => {
    const ctx = context({
      checkinDays: ["2026-10-06"],
      reviewDue: 50,
    });
    const message = pickCoachMessage(ctx);
    assert.ok(message);
    assert.match(message.title, /今天还没记录/);
  });
});

describe("detectSignals() 的输入健壮性", () => {
  it("重复与乱序的打卡日期不影响判断", () => {
    const ctx = context({
      checkinDays: ["2026-10-06", "2026-10-06", "2026-10-05", "2026-10-06"],
    });
    assert.equal(kinds(ctx).includes("streak-at-risk"), true);
  });

  it("空计划列表与 0 到期都不抛错", () => {
    assert.doesNotThrow(() => detectSignals(context({ plans: [], reviewDue: 0 })));
  });
});
