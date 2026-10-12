/**
 * 待办领域逻辑
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯函数，不碰数据库。待办的规则本身很简单，但**排序**这一块有真实的边角：
 * sortOrder 允许重复（并发新建、将来拖拽排序都可能产生），
 * 没有稳定的兜底就会出现"刷新一次顺序变一次"的灵异现象。
 */

export type TodoLike = {
  sortOrder: number;
  createdAt: Date;
};

/**
 * 新待办该用的 sortOrder = 现有的最大值 + 1。
 *
 * 用 reduce 而不是 `Math.max(...list)`：展开运算符在条目很多时会撞上
 * 引擎的参数个数上限，抛一个和业务毫无关系的 RangeError。
 *
 * 非有限值（NaN / Infinity）一律忽略 —— 一处脏数据不该让整个列表排序错乱。
 */
export function nextSortOrder(existing: readonly number[]): number {
  let max = Number.NEGATIVE_INFINITY;
  for (const value of existing) {
    if (Number.isFinite(value) && value > max) max = value;
  }
  return Number.isFinite(max) ? max + 1 : 0;
}

/**
 * 排序：先按 sortOrder 升序，**相同时按创建时间升序兜底**。
 *
 * 兜底那一层不是可选的：sortOrder 一旦出现重复，没有它排序就退化成
 * 依赖引擎的实现细节（Array#sort 在旧引擎上甚至不保证稳定），
 * 表现为同样的数据每次渲染顺序都不一样。
 *
 * 不改动入参数组 —— 直接 sort 会就地修改调用方传进来的数组，
 * 而那个数组可能正是 React 的 props。
 */
export function sortTodos<T extends TodoLike>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const byOrder = normalize(a.sortOrder) - normalize(b.sortOrder);
    if (byOrder !== 0) return byOrder;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

function normalize(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** 未完成在前、已完成在后，各自内部保持原顺序 */
export function partitionByCompletion<T extends { completed: boolean }>(
  items: readonly T[],
): { open: T[]; done: T[] } {
  const open: T[] = [];
  const done: T[] = [];
  for (const item of items) (item.completed ? done : open).push(item);
  return { open, done };
}
