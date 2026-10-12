import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COACH_SYSTEM_PROMPT,
  acceptRephrase,
  buildCoachPrompt,
  type CoachFacts,
} from "../src/lib/ai/prompt.ts";

const message = { title: "今天还没记录", body: "已经连着 5 天了。", actionUrl: "/dashboard" };
const facts: CoachFacts = { streak: 5, stars: 42, activeDays: 4, reviewDue: 7 };

describe("buildCoachPrompt() 只送数字，不送用户写的内容", () => {
  it("含有原始提醒与全部数字", () => {
    const { user } = buildCoachPrompt(message, facts);
    assert.ok(user.includes("今天还没记录"));
    assert.ok(user.includes("5 天"));
    assert.ok(user.includes("42 枚"));
    assert.ok(user.includes("4 天"));
    assert.ok(user.includes("7 张"));
  });

  it("**复习为 0 时不提这一行** —— 没到期就别给模型多余的发挥空间", () => {
    const { user } = buildCoachPrompt(message, { ...facts, reviewDue: 0 });
    assert.ok(!user.includes("复习"));
  });

  it("系统提示里写明了不指责、不编数据、长度上限", () => {
    assert.ok(COACH_SYSTEM_PROMPT.includes("绝不指责"));
    assert.ok(COACH_SYSTEM_PROMPT.includes("不编造数据"));
    assert.ok(COACH_SYSTEM_PROMPT.includes("60 个汉字"));
  });

  it("要求只输出正文（否则模型会把标题也复述一遍）", () => {
    assert.ok(COACH_SYSTEM_PROMPT.includes("只输出改写后的正文"));
  });
});

describe("acceptRephrase() 接受合格的改写", () => {
  it("普通的一两句话", () => {
    assert.equal(
      acceptRephrase("今天还没记录。还剩几个小时，一句话就能把它接上。"),
      "今天还没记录。还剩几个小时，一句话就能把它接上。",
    );
  });

  it("压平多余空白与换行", () => {
    assert.equal(acceptRephrase("  今天\n还没   记录。  "), "今天 还没 记录。");
  });

  it("**恰好 90 字接受、91 字拒绝**（边界包含）", () => {
    const ok = "学".repeat(90);
    assert.equal(acceptRephrase(ok), ok);
    assert.equal(acceptRephrase("学".repeat(91)), null);
  });
});

describe("acceptRephrase() 拒绝不合格的输出", () => {
  it("空值与纯空白", () => {
    for (const value of [null, undefined, "", "   "]) {
      assert.equal(acceptRephrase(value), null);
    }
  });

  it("太短（多半被截断）", () => {
    assert.equal(acceptRephrase("好"), null);
  });

  it("**Markdown 痕迹** —— 卡片里不该出现星号与井号", () => {
    assert.equal(acceptRephrase("**今天还没记录**，快去打卡。"), null);
    assert.equal(acceptRephrase("## 提醒\n今天还没记录。"), null);
    assert.equal(acceptRephrase("今天还没记录，点这里 → [去打卡](/dashboard)"), null);
  });

  it("列表形式", () => {
    assert.equal(acceptRephrase("- 今天还没记录"), null);
    assert.equal(acceptRephrase("1. 今天还没记录"), null);
  });

  it("**复述提示词或元话语** —— 模型最常见的跑偏", () => {
    assert.equal(acceptRephrase("好的，以下是改写后的正文：今天还没记录。"), null);
    assert.equal(acceptRephrase("改写后的正文：今天还没记录。"), null);
    assert.equal(acceptRephrase("作为 AI，我建议你今天记录一下。"), null);
    assert.equal(acceptRephrase("当然，今天还没记录。"), null);
  });

  it("把原始提醒整段念一遍", () => {
    assert.equal(acceptRephrase("原始提醒是「今天还没记录」，我改写成：还没记录哦。"), null);
  });
});

describe("acceptRephrase() 不误伤正常表达", () => {
  it("句中的普通标点与数字不受影响", () => {
    for (const text of [
      "已经连着 5 天了，今天补一句话就行。",
      "有 12 张卡到期了，趁还记得过一遍。",
      "「线性代数」停了 17 天，挑最小的一项做完就算推进。",
    ]) {
      assert.equal(acceptRephrase(text), text, `不该拒绝：${text}`);
    }
  });
});
