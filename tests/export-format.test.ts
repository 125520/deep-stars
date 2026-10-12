import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EXPORT_COLLECTIONS,
  EXPORT_FIELDS,
  EXPORT_FORMAT,
  EXPORT_REFERENCES,
  EXPORT_VERSION,
  countRecords,
  derivedIdFor,
  filterNewRecords,
  parseExport,
  remapIds,
  serializeExport,
  summarize,
  type ExportCollection,
  type ExportPayload,
  type ExportRecord,
} from "../src/lib/export-format.ts";

/** 造一个最小但完整的导出负载 */
function makePayload(overrides: Partial<ExportPayload> = {}): ExportPayload {
  const empty = Object.fromEntries(
    EXPORT_COLLECTIONS.map((c) => [c, [] as ExportRecord[]]),
  ) as unknown as Record<(typeof EXPORT_COLLECTIONS)[number], ExportRecord[]>;

  const data = {
    ...empty,
    constellations: [{ id: "c1", name: "我的星图" }],
    checkins: [{ id: "k1", content: "学了两小时", hours: 2 }],
    stars: [{ id: "s1", constellationId: "c1", checkinId: "k1", magnitude: 0.6 }],
  };

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: "2026-10-07T00:00:00.000Z",
    counts: countRecords(data),
    data,
    ...overrides,
  };
}

describe("导出与解析的往返", () => {
  it("序列化再解析后内容一致", () => {
    const payload = makePayload();
    const result = parseExport(serializeExport(payload));
    assert.ok(result.ok);
    assert.deepEqual(result.payload.data, payload.data);
    assert.equal(result.payload.version, EXPORT_VERSION);
  });

  it("counts 由实际内容算出，不信任文件里写的数字", () => {
    // 手工改过 counts 的文件不该骗过解析器
    const payload = makePayload({ counts: { constellations: 999 } });
    const result = parseExport(serializeExport(payload));
    assert.ok(result.ok);
    assert.equal(result.payload.counts.constellations, 1);
    assert.equal(result.payload.counts.stars, 1);
  });

  it("旧版本（v1 之前）的文件仍可读 —— 版本号只挡更新的", () => {
    const raw = JSON.stringify({ format: EXPORT_FORMAT, version: 1, data: {} });
    assert.ok(parseExport(raw).ok);
  });
});

describe("parseExport() 的拒绝路径", () => {
  const cases: [string, string, RegExp][] = [
    ["空字符串", "", /空的/],
    ["只有空白", "   \n  ", /空的/],
    ["不是 JSON", "这不是 json", /不是有效的 JSON/],
    ["JSON 但是数组", "[1,2,3]", /不是一个对象/],
    ["JSON 但是字符串", '"hello"', /不是一个对象/],
    ["缺少 format", JSON.stringify({ version: 1, data: {} }), /不是 Deep Stars/],
    [
      "format 不对",
      JSON.stringify({ format: "some-other-app", version: 1, data: {} }),
      /不是 Deep Stars/,
    ],
    [
      "版本号缺失",
      JSON.stringify({ format: EXPORT_FORMAT, data: {} }),
      /缺少有效的版本号/,
    ],
    [
      "版本号是字符串",
      JSON.stringify({ format: EXPORT_FORMAT, version: "1", data: {} }),
      /缺少有效的版本号/,
    ],
    [
      "**来自更新的版本**",
      JSON.stringify({ format: EXPORT_FORMAT, version: EXPORT_VERSION + 1, data: {} }),
      /更新的版本/,
    ],
    [
      "缺少 data",
      JSON.stringify({ format: EXPORT_FORMAT, version: 1 }),
      /缺少 data 字段/,
    ],
    [
      "集合不是数组",
      JSON.stringify({ format: EXPORT_FORMAT, version: 1, data: { todos: {} } }),
      /todos 不是数组/,
    ],
    [
      "记录缺少 id",
      JSON.stringify({ format: EXPORT_FORMAT, version: 1, data: { todos: [{ title: "无 id" }] } }),
      /第 1 条记录缺少有效的 id/,
    ],
    [
      "记录 id 是空串",
      JSON.stringify({ format: EXPORT_FORMAT, version: 1, data: { todos: [{ id: "" }] } }),
      /第 1 条记录缺少有效的 id/,
    ],
    [
      "记录是 null",
      JSON.stringify({ format: EXPORT_FORMAT, version: 1, data: { todos: [null] } }),
      /第 1 条记录缺少有效的 id/,
    ],
  ];

  for (const [name, raw, pattern] of cases) {
    it(`${name} → 给出可指导下一步的提示`, () => {
      const result = parseExport(raw);
      assert.equal(result.ok, false, `不该接受: ${name}`);
      if (result.ok) return;
      assert.match(result.error, pattern);
    });
  }

  it("缺失的集合按空数组处理 —— 能导入的部分先导进来", () => {
    const raw = JSON.stringify({
      format: EXPORT_FORMAT,
      version: 1,
      data: { todos: [{ id: "t1", title: "只有待办" }] },
    });
    const result = parseExport(raw);
    assert.ok(result.ok);
    assert.equal(result.payload.data.todos.length, 1);
    assert.equal(result.payload.data.stars.length, 0);
  });

  it("报错信息里带上是第几条记录，用户能自己去看", () => {
    const raw = JSON.stringify({
      format: EXPORT_FORMAT,
      version: 1,
      data: { todos: [{ id: "ok" }, { id: "ok2" }, { title: "坏的" }] },
    });
    const result = parseExport(raw);
    assert.ok(!result.ok);
    if (result.ok) return;
    assert.match(result.error, /第 3 条/);
  });
});

describe("filterNewRecords()", () => {
  const a: ExportRecord = { id: "a" };
  const b: ExportRecord = { id: "b" };
  const c: ExportRecord = { id: "c" };

  it("挑出数据库里还没有的", () => {
    assert.deepEqual(
      filterNewRecords([a, b, c], new Set(["b"])).map((r) => r.id),
      ["a", "c"],
    );
  });

  it("**重复导入同一个文件是幂等的** —— 第二次一条都不会再插入", () => {
    const existing = new Set(["a", "b"]);
    assert.equal(filterNewRecords([a, b], existing).length, 0);
  });

  it("过滤文件内部自身的重复 id —— 否则批量插入会整批失败", () => {
    assert.deepEqual(
      filterNewRecords([a, a, b], new Set()).map((r) => r.id),
      ["a", "b"],
    );
  });

  it("全部已存在时返回空数组，不是报错", () => {
    assert.deepEqual(filterNewRecords([a], new Set(["a"])), []);
  });

  it("空输入不抛错", () => {
    assert.deepEqual(filterNewRecords([], new Set()), []);
  });
});

describe("summarize()", () => {
  it("只列出有条目的项", () => {
    const text = summarize({ stars: 12, todos: 0, checkins: 3 });
    assert.match(text, /12 条星/);
    assert.match(text, /3 条打卡/);
    assert.ok(!text.includes("待办"), "计数为 0 的不该出现");
  });

  it("全为 0 时给一句人话", () => {
    assert.equal(summarize({ stars: 0 }), "没有任何记录");
  });

  it("未知集合用原始键名，不显示 undefined", () => {
    assert.match(summarize({ mystery: 2 }), /2 条mystery/);
  });
});

describe("remapIds() 改写 id 与引用", () => {
  /*
    这一组锁住的是一个实测踩到的 500：
    导入一份别人的导出文件时，文件里的 id 已经存在于对方名下 ——
    按"已存在就跳过"处理会一条都导不进来（用户只看到"导入 0 条"），
    直接插入又会撞主键。正确做法是给这些 id 换新的，并改写所有指向它们的引用。
  */

  it("改写记录自身的 id", () => {
    const remap = new Map([["old-1", "new-1"]]);
    const out = remapIds([{ id: "old-1", name: "计划" }], "plans", remap);
    assert.equal(out[0]?.id, "new-1");
  });

  it("**同时改写指向它的引用** —— 漏掉就是外键约束错误", () => {
    const remap = new Map([["plan-old", "plan-new"]]);
    const out = remapIds([{ id: "task-1", planId: "plan-old" }], "planTasks", remap);
    assert.equal(out[0]?.planId, "plan-new");
    assert.equal(out[0]?.id, "task-1", "自身 id 不在 remap 里就该原样保留");
  });

  it("stars 的三个引用字段都会被改写", () => {
    const remap = new Map([
      ["c1", "c9"],
      ["k1", "k9"],
      ["s1", "s9"],
    ]);
    const out = remapIds(
      [{ id: "s2", constellationId: "c1", checkinId: "k1", prevStarId: "s1" }],
      "stars",
      remap,
    );
    assert.deepEqual(out[0], {
      id: "s2",
      constellationId: "c9",
      checkinId: "k9",
      prevStarId: "s9",
    });
  });

  it("为 null 的引用（如第一枚星的 prevStarId）不动", () => {
    const remap = new Map([["x", "y"]]);
    const out = remapIds([{ id: "s1", prevStarId: null }], "stars", remap);
    assert.equal(out[0]?.prevStarId, null);
  });

  it("没有引用的集合只改自身 id", () => {
    const remap = new Map([["a", "b"]]);
    const out = remapIds([{ id: "a", title: "待办" }], "todos", remap);
    assert.deepEqual(out[0], { id: "b", title: "待办" });
  });

  it("remap 为空时返回等值副本", () => {
    const input = [{ id: "a", planId: "p" }];
    const out = remapIds(input, "planTasks", new Map());
    assert.deepEqual(out, input);
    assert.notEqual(out, input, "应当是副本，不是同一个数组");
  });

  it("**不改动入参** —— 它可能就是别处仍在引用的数组", () => {
    const input = [{ id: "old", planId: "p-old" }];
    remapIds(input, "planTasks", new Map([["old", "new"], ["p-old", "p-new"]]));
    assert.equal(input[0]?.id, "old");
    assert.equal(input[0]?.planId, "p-old");
  });

  it("空数组不抛错", () => {
    assert.deepEqual(remapIds([], "plans", new Map([["a", "b"]])), []);
  });

  it("引用字段缺失时不凭空造出来", () => {
    const remap = new Map([["p", "q"]]);
    const out = remapIds([{ id: "t1" }], "planTasks", remap);
    assert.equal("planId" in (out[0] ?? {}), false);
  });
});

describe("derivedIdFor() 必须是确定性的", () => {
  /*
    这一组锁住的是实测踩到的第二个坑：
    给"被别人占用的 id"换新 id 时如果用 randomUUID，
    同一份文件连导两次会得到两批不同的新 id —— 于是第二次
    "我是否已有这条记录"匹配不上，**又导入一份副本**，幂等性没了。
  */
  const user = "user-abc";
  const original = "cmuxji29h0006o4ugnx8llfdg";

  it("**同样的输入永远得到同样的输出** —— 幂等性的前提", () => {
    assert.equal(derivedIdFor(user, original), derivedIdFor(user, original));
  });

  it("不同账号导入同一个文件得到不同的 id（各自的副本互不冲突）", () => {
    assert.notEqual(derivedIdFor("user-a", original), derivedIdFor("user-b", original));
  });

  it("同一个账号的不同原 id 得到不同的新 id", () => {
    assert.notEqual(derivedIdFor(user, "id-1"), derivedIdFor(user, "id-2"));
  });

  it("形态是带连字符的 32 位十六进制（与 cuid 不冲突）", () => {
    const id = derivedIdFor(user, original);
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(id.replace(/-/g, "").length, 32);
  });

  it("**分隔符能防止拼接歧义** —— 「a|bc」与「ab|c」不该算出同一个 id", () => {
    assert.notEqual(derivedIdFor("a", "bc"), derivedIdFor("ab", "c"));
  });

  it("空字符串也不抛错", () => {
    assert.ok(derivedIdFor("", "").length > 0);
  });
});

describe("EXPORT_REFERENCES 覆盖了所有真实外键", () => {
  it("stars 指向星座、打卡与上一枚星", () => {
    assert.deepEqual([...EXPORT_REFERENCES.stars].sort(), [
      "checkinId",
      "constellationId",
      "prevStarId",
    ]);
  });

  it("计划任务、专注记录、复习卡、打卡分别指向计划或打卡", () => {
    assert.deepEqual([...EXPORT_REFERENCES.planTasks], ["planId"]);
    assert.deepEqual([...EXPORT_REFERENCES.studyRecords], ["checkinId"]);
    assert.deepEqual([...EXPORT_REFERENCES.reviewCards], ["planId"]);
    assert.deepEqual([...EXPORT_REFERENCES.checkins], ["planId"]);
  });

  it("星座、计划、待办没有外键", () => {
    assert.deepEqual([...EXPORT_REFERENCES.constellations], []);
    assert.deepEqual([...EXPORT_REFERENCES.plans], []);
    assert.deepEqual([...EXPORT_REFERENCES.todos], []);
  });

  it("**每个引用字段都在导出白名单里** —— 否则改写它也没有意义", () => {
    for (const [collection, fields] of Object.entries(EXPORT_REFERENCES)) {
      const whitelist = EXPORT_FIELDS[collection as ExportCollection];
      for (const field of fields) {
        assert.ok(whitelist.includes(field), `${collection}.${field} 不在导出白名单里`);
      }
    }
  });
});
