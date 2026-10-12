import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextSortOrder, partitionByCompletion, sortTodos } from "../src/lib/todos.ts";

const at = (minutes: number) => new Date(Date.UTC(2026, 2, 9, 0, minutes));

describe("nextSortOrder()", () => {
  it("空列表从 0 开始", () => {
    assert.equal(nextSortOrder([]), 0);
  });

  it("取最大值 + 1，而不是长度", () => {
    assert.equal(nextSortOrder([0, 1, 2]), 3);
    // 删掉中间几条之后长度只剩 3，但序号必须接着 5 走，
    // 否则新条目会插到已有条目中间
    assert.equal(nextSortOrder([0, 2, 5]), 6);
  });

  it("负数与乱序也能取到真正的最大值", () => {
    assert.equal(nextSortOrder([-3, -1, -7]), 0);
  });

  it("忽略 NaN / Infinity，一处脏数据不该让整个列表错乱", () => {
    assert.equal(nextSortOrder([1, Number.NaN, 4]), 5);
    assert.equal(nextSortOrder([Number.NaN, Number.POSITIVE_INFINITY]), 0);
  });

  it("条目很多时不因展开运算符而爆栈", () => {
    const many = Array.from({ length: 200_000 }, (_, i) => i);
    assert.equal(nextSortOrder(many), 200_000);
  });
});

describe("sortTodos()", () => {
  it("按 sortOrder 升序", () => {
    const list = [
      { sortOrder: 2, createdAt: at(0), id: "c" },
      { sortOrder: 0, createdAt: at(1), id: "a" },
      { sortOrder: 1, createdAt: at(2), id: "b" },
    ];
    assert.deepEqual(
      sortTodos(list).map((t) => t.id),
      ["a", "b", "c"],
    );
  });

  it("sortOrder 相同时按创建时间兜底 —— 否则顺序会随机", () => {
    const list = [
      { sortOrder: 0, createdAt: at(30), id: "晚" },
      { sortOrder: 0, createdAt: at(10), id: "早" },
      { sortOrder: 0, createdAt: at(20), id: "中" },
    ];
    assert.deepEqual(
      sortTodos(list).map((t) => t.id),
      ["早", "中", "晚"],
    );
  });

  it("不改动入参数组（那个数组可能就是 React 的 props）", () => {
    const list = [
      { sortOrder: 1, createdAt: at(0), id: "b" },
      { sortOrder: 0, createdAt: at(0), id: "a" },
    ];
    const snapshot = list.map((t) => t.id);
    sortTodos(list);
    assert.deepEqual(
      list.map((t) => t.id),
      snapshot,
    );
  });

  it("脏 sortOrder 归零处理，不会让条目飞到两端之外", () => {
    const list = [
      { sortOrder: Number.NaN, createdAt: at(5), id: "脏" },
      { sortOrder: 1, createdAt: at(0), id: "正常" },
    ];
    assert.deepEqual(
      sortTodos(list).map((t) => t.id),
      ["脏", "正常"],
    );
  });
});

describe("partitionByCompletion()", () => {
  it("未完成在前，且各自内部保持原有顺序", () => {
    const list = [
      { completed: true, id: "a" },
      { completed: false, id: "b" },
      { completed: true, id: "c" },
      { completed: false, id: "d" },
    ];
    const { open, done } = partitionByCompletion(list);
    assert.deepEqual(
      open.map((t) => t.id),
      ["b", "d"],
    );
    assert.deepEqual(
      done.map((t) => t.id),
      ["a", "c"],
    );
  });

  it("空列表不抛错", () => {
    const { open, done } = partitionByCompletion([]);
    assert.deepEqual(open, []);
    assert.deepEqual(done, []);
  });
});
