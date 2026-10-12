/**
 * 计划领域逻辑
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯函数。计划这一块真正需要判断的只有一件事：**进度怎么算**。
 * 剩下的都是 CRUD，不值得单独成层。
 */

/** 任务状态。数据库里存字符串（SQLite 没有枚举），这里是唯一的解释处。 */
export const TASK_STATUSES = ["pending", "doing", "done", "skipped"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "待开始",
  doing: "进行中",
  done: "已完成",
  skipped: "已跳过",
};

export function taskStatusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status];
}

/**
 * 把数据库里读到的任意字符串收敛成合法状态。
 *
 * 库里存的是字符串（SQLite 没有枚举），所以脏值是**可能出现**的，
 * 不是假想：手改过库、旧版本写进去的状态、将来加了新状态但老代码还在跑。
 * 一律回退到 pending，而不是让界面渲染出一个没有样式的裸标签。
 */
export function normalizeTaskStatus(raw: string | null | undefined): TaskStatus {
  return TASK_STATUSES.includes(raw as TaskStatus) ? (raw as TaskStatus) : "pending";
}

/** 点击时循环切换：待开始 → 进行中 → 已完成 → 待开始 */
export function nextTaskStatus(current: string | null | undefined): TaskStatus {
  const status = normalizeTaskStatus(current);
  if (status === "pending") return "doing";
  if (status === "doing") return "done";
  return "pending";
}

export type PlanProgress = {
  total: number;
  done: number;
  doing: number;
  skipped: number;
  /** 0..1 */
  ratio: number;
};

/**
 * 计划进度。
 *
 * ⚠️ **分母要减掉"已跳过"的任务。**
 *
 * 这是这里唯一需要判断的地方。用户在计划推进中放弃某个任务是正常的
 * （目标变了、方法不对），如果跳过仍然算进分母，那个计划就永远到不了 100% ——
 * 明明该做的都做完了，进度条却卡在 83%，只能靠删任务来"凑数"。
 * 跳过是一种**正当的结束方式**，不是欠债。
 *
 * 全部跳过时返回 0 而不是 NaN —— 0/0 在界面上会渲染成 "NaN%"。
 */
export function planProgress(tasks: readonly { status: string | null }[]): PlanProgress {
  let done = 0;
  let doing = 0;
  let skipped = 0;

  for (const task of tasks) {
    const status = normalizeTaskStatus(task.status);
    if (status === "done") done += 1;
    else if (status === "doing") doing += 1;
    else if (status === "skipped") skipped += 1;
  }

  const total = tasks.length;
  const denominator = total - skipped;

  return {
    total,
    done,
    doing,
    skipped,
    ratio: denominator > 0 ? done / denominator : 0,
  };
}

/** 进度 → 一句人话，避免每个页面各写一遍 */
export function progressSummary(progress: PlanProgress): string {
  if (progress.total === 0) return "还没有任务";
  if (progress.done === 0 && progress.doing === 0 && progress.skipped === 0) {
    return `${progress.total} 项待开始`;
  }
  const parts = [`${progress.done}/${progress.total - progress.skipped} 已完成`];
  if (progress.doing > 0) parts.push(`${progress.doing} 项进行中`);
  if (progress.skipped > 0) parts.push(`${progress.skipped} 项已跳过`);
  return parts.join(" · ");
}

/**
 * 按天分组任务，用于"第 N 天"的展示。
 * dayNumber 为 null 的归到最后一组（未排期的任务）。
 */
export function groupTasksByDay<T extends { dayNumber: number | null }>(
  tasks: readonly T[],
): { day: number | null; items: T[] }[] {
  const buckets = new Map<number | null, T[]>();
  for (const task of tasks) {
    const key = task.dayNumber;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(task);
    else buckets.set(key, [task]);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => {
      // 未排期（null）永远排在最后
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    })
    .map(([day, items]) => ({ day, items }));
}
