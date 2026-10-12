import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_PARSED_TASKS,
  ONBOARDING_STEPS,
  isNewUser,
  parseTasksFromDocument,
} from "../src/lib/onboarding.ts";

describe("isNewUser()", () => {
  it("星图空着且没有计划 → 新用户", () => {
    assert.equal(isNewUser({ starCount: 0, planCount: 0 }), true);
  });

  it("**只要留下过任何痕迹就不再是新人**", () => {
    assert.equal(isNewUser({ starCount: 1, planCount: 0 }), false);
    assert.equal(isNewUser({ starCount: 0, planCount: 1 }), false);
    assert.equal(isNewUser({ starCount: 5, planCount: 3 }), false);
  });
});

describe("parseTasksFromDocument() 的基本解析", () => {
  it("认出 - / * / + 与有序列表", () => {
    const doc = ["- 看第一章", "* 整理笔记", "+ 做习题", "1. 自测"].join("\n");
    assert.deepEqual(
      parseTasksFromDocument(doc).map((t) => t.title),
      ["看第一章", "整理笔记", "做习题", "自测"],
    );
  });

  it("去掉复选框标记", () => {
    const doc = "- [ ] 未完成的\n- [x] 已完成的";
    assert.deepEqual(
      parseTasksFromDocument(doc).map((t) => t.title),
      ["未完成的", "已完成的"],
    );
  });

  it("从「第 N 天」「Day N」「D3」里读出排期", () => {
    const doc = ["- 第 3 天：看第二章", "- Day 7 做真题", "- D12 模考", "- 没有排期的一项"].join("\n");
    assert.deepEqual(
      parseTasksFromDocument(doc).map((t) => t.dayNumber),
      [3, 7, 12, null],
    );
  });

  it("忽略标题、段落与空行", () => {
    const doc = ["# 计划", "", "这是一段说明。", "- 唯一的任务"].join("\n");
    assert.deepEqual(
      parseTasksFromDocument(doc).map((t) => t.title),
      ["唯一的任务"],
    );
  });

  it("允许缩进的子项", () => {
    const doc = "- 主项\n  - 子项";
    assert.equal(parseTasksFromDocument(doc).length, 2);
  });
});

describe("parseTasksFromDocument() 跳过代码块", () => {
  it("**围栏代码块里的列表不算任务** —— 代码注释也长得像列表项", () => {
    const doc = [
      "## 示例",
      "```bash",
      "- 这行是命令，不是任务",
      "# 这也是注释",
      "```",
      "- 真正的任务",
    ].join("\n");
    assert.deepEqual(
      parseTasksFromDocument(doc).map((t) => t.title),
      ["真正的任务"],
    );
  });

  it("~~~ 围栏同样跳过", () => {
    const doc = ["~~~", "- 代码里的", "~~~", "- 外面的"].join("\n");
    assert.deepEqual(
      parseTasksFromDocument(doc).map((t) => t.title),
      ["外面的"],
    );
  });

  it("围栏闭合后恢复正常解析", () => {
    const doc = ["```", "- 跳过", "```", "- 保留"].join("\n");
    assert.deepEqual(
      parseTasksFromDocument(doc).map((t) => t.title),
      ["保留"],
    );
  });
});

describe("parseTasksFromDocument() 优先只解析「## 任务安排」一节", () => {
  /*
    这一组锁住的是一个实测踩到的坑：模板文档里除了任务，还有
    「阶段安排」「每日节奏」这类叙述性列表。全文解析的话，
    用户拿到的计划里会混进「上午：数学」这种没法打勾的条目 ——
    实测 19 条任务里 0 条带排期。
  */
  const doc = [
    "# 考研冲刺",
    "",
    "## 阶段安排",
    "- 第 1–35 天：基础轮。每科过一遍教材。",
    "- 第 36–70 天：强化轮。真题分块训练。",
    "",
    "## 每日节奏",
    "- 上午：数学",
    "- 下午：专业课",
    "",
    "## 任务安排",
    "- 第 1 天 通读第一章并列出提纲",
    "- 第 2 天 完成课后习题 1–10",
    "",
    "## 备注",
    "- 这一条在任务段之后，不该被收进来",
  ].join("\n");

  it("只取任务段里的条目", () => {
    assert.deepEqual(
      parseTasksFromDocument(doc).map((t) => t.title),
      ["第 1 天 通读第一章并列出提纲", "第 2 天 完成课后习题 1–10"],
    );
  });

  it("排期能读出来（全文解析时这里是 0 条）", () => {
    assert.deepEqual(
      parseTasksFromDocument(doc).map((t) => t.dayNumber),
      [1, 2],
    );
  });

  it("任务段之后的标题会终止解析", () => {
    const titles = parseTasksFromDocument(doc).map((t) => t.title);
    assert.equal(titles.some((t) => t.includes("备注")), false);
  });

  it("**没有任务段时退回全文解析** —— 不破坏没写这一节的文档", () => {
    const plain = ["## 阶段安排", "- 看第一章", "- 做习题"].join("\n");
    assert.deepEqual(
      parseTasksFromDocument(plain).map((t) => t.title),
      ["看第一章", "做习题"],
    );
  });

  it("任务段是空的 → 一条都不产生（而不是退回全文）", () => {
    const empty = ["## 阶段安排", "- 这是叙述，不是任务", "## 任务安排", "（待补）"].join("\n");
    assert.deepEqual(parseTasksFromDocument(empty), []);
  });

  it("### 与 #### 级别的任务段也认", () => {
    for (const level of ["###", "####"]) {
      const nested = [`${level} 任务安排`, "- 第 5 天 做一件事"].join("\n");
      assert.equal(parseTasksFromDocument(nested).length, 1, `${level} 应当被认作任务段`);
    }
  });

  it("**区间不算某一天** —— 「第 1–35 天」是阶段", () => {
    const range = ["## 任务安排", "- 第 1–35 天：基础轮"].join("\n");
    assert.deepEqual(parseTasksFromDocument(range).map((t) => t.dayNumber), [null]);
  });
});

describe("parseTasksFromDocument() 的边界", () => {
  it("空值不抛错", () => {
    for (const value of [null, undefined, "", "   "]) {
      assert.deepEqual(parseTasksFromDocument(value), []);
    }
  });

  it("**超过上限就截断** —— 模板文档可能很长，全变成任务反而没法用", () => {
    const doc = Array.from({ length: 100 }, (_, i) => `- 任务 ${i}`).join("\n");
    assert.equal(parseTasksFromDocument(doc).length, MAX_PARSED_TASKS);
  });

  it("自定义上限生效", () => {
    const doc = Array.from({ length: 10 }, (_, i) => `- 任务 ${i}`).join("\n");
    assert.equal(parseTasksFromDocument(doc, 3).length, 3);
  });

  it("太短或过长的条目被丢弃", () => {
    const doc = ["- 好", `- ${"很".repeat(250)}`, "- 正常的一条"].join("\n");
    assert.deepEqual(
      parseTasksFromDocument(doc).map((t) => t.title),
      ["正常的一条"],
    );
  });

  it("只有标记没有内容的不算", () => {
    assert.deepEqual(parseTasksFromDocument("- \n- [ ]"), []);
  });

  it("不改动入参", () => {
    const doc = "- 任务";
    parseTasksFromDocument(doc);
    assert.equal(doc, "- 任务");
  });
});

describe("ONBOARDING_STEPS", () => {
  it("每一步都有标题、说明与站内去处", () => {
    assert.ok(ONBOARDING_STEPS.length >= 3);
    for (const step of ONBOARDING_STEPS) {
      assert.ok(step.title.length > 0);
      assert.ok(step.body.length > 0);
      assert.ok(step.href.startsWith("/"), `${step.title} 的去处不是站内路径`);
    }
  });
});
