/*
  ⚠️ 纯领域模块内部一律用「相对路径 + .ts 扩展名」。
  两个原因叠在一起：
    1. Node 的测试运行器不读 tsconfig 的 paths，`@/` 别名会报 ERR_MODULE_NOT_FOUND
    2. ESM 的相对导入**必须带扩展名**，省略同样解析不到
  只有打包器能容忍这两点，而 `node --test` 直接跑的就是这些文件。
  这条约束由 eslint 的 no-restricted-imports 强制，别靠记性。
*/
import { toLocalDayKey } from "./constellation.ts";

/**
 * 活动热力图
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯函数，输入是「日期 → 数值」的映射，输出是可直接渲染的二维网格。
 *
 * ⚠️ **日期推进一律用 Date 构造器，不要加毫秒。**
 *
 * `new Date(t + 86_400_000)` 在夏令时切换那天会得到前一天的 23:00，
 * 于是整张网格从那里开始错位一格 —— 而且只在一年里的两天出错，
 * 本地开发几乎不可能撞上。`new Date(y, m, d + n)` 由构造器负责归一化，
 * 没有这个问题。
 */

/** 热力等级 0..4。0 = 没有活动 */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export type HeatmapDay = {
  /** YYYY-MM-DD（本地时区） */
  key: string;
  value: number;
  level: HeatLevel;
  /** 该日还未到来（网格尾部为了补齐一周而多出来的格子） */
  future: boolean;
};

/** 一列 = 一周，7 行 */
export type HeatmapGrid = HeatmapDay[][];

/**
 * 合并两个来源的每日分钟数。
 *
 * 「专注时长」有两个来源，它们描述的是同一件事，**直接相加就是重复计数**：
 *   · 番茄钟写下的 StudyRecord（机器计时，可信）
 *   · 打卡时手填的 hours（自我报告）
 *
 * 规则取**较大者**，而不是"有计时器就以计时器为准"。
 *
 * ⚠️ 后者看似更"精确"，实际会得出荒谬结果：某天跑了一个 25 分钟的番茄钟，
 * 又手填了一条"今天学了 2 小时"的打卡，那天就只显示 25 分钟 ——
 * 用户会认为这个统计坏了。取较大者既不会重复计数，也不会把大数压成小数。
 *
 * 代价是：同一天两段真正独立的投入会被低估成其中较大的一段。
 * **宁可少算也不多算** —— 统计虚高会让人误判自己的投入。
 */
export function mergeDayMinutes(
  timerMinutes: ReadonlyMap<string, number>,
  manualMinutes: ReadonlyMap<string, number>,
): Map<string, number> {
  const merged = new Map<string, number>();

  for (const [key, value] of timerMinutes) {
    if (Number.isFinite(value) && value > 0) merged.set(key, value);
  }
  for (const [key, value] of manualMinutes) {
    if (!Number.isFinite(value) || value <= 0) continue;
    merged.set(key, Math.max(merged.get(key) ?? 0, value));
  }

  return merged;
}

/** 专注分钟数的分档：≥1 / ≥30 / ≥60 / ≥120 */
export const MINUTE_THRESHOLDS = [1, 30, 60, 120] as const;

/** DST 安全地加减天数 */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * 所在周的周一（本地时区）。
 *
 * 用周一而不是周日：中文语境里"这周"从周一算起，
 * 日历第一列是周日会让所有人第一眼看错位置。
 */
export function startOfWeek(date: Date): Date {
  // getDay(): 0=周日。转成"距周一几天"：周一 0、周日 6
  const offset = (date.getDay() + 6) % 7;
  return addDays(date, -offset);
}

/**
 * 把数值映射到 0..4。
 * 语义是"达到或超过第几档"：value ≥ thresholds[0] 记 1，≥ thresholds[1] 记 2……
 */
export function levelFor(value: number, thresholds: readonly number[]): HeatLevel {
  if (!Number.isFinite(value) || value <= 0) return 0;
  let level = 0;
  for (const threshold of thresholds) {
    if (value >= threshold) level += 1;
  }
  return Math.min(level, 4) as HeatLevel;
}

/**
 * 生成网格：`weeks` 列 × 7 行，最后一列包含 `endDate`。
 *
 * 尾部格子若晚于 endDate 会标记为 future，界面据此渲染成"还没到"，
 * 而不是渲染成一个"那天没学习"的空白格 —— 两者含义完全不同。
 */
export function buildHeatmap(
  values: ReadonlyMap<string, number>,
  endDate: Date,
  weeks: number,
  thresholds: readonly number[] = MINUTE_THRESHOLDS,
): HeatmapGrid {
  const safeWeeks = Math.max(1, Math.trunc(weeks));
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const endTime = end.getTime();
  const gridStart = addDays(startOfWeek(end), -(safeWeeks - 1) * 7);

  const grid: HeatmapGrid = [];
  for (let column = 0; column < safeWeeks; column += 1) {
    const week: HeatmapDay[] = [];
    for (let row = 0; row < 7; row += 1) {
      const date = addDays(gridStart, column * 7 + row);
      const key = toLocalDayKey(date);
      const value = values.get(key) ?? 0;
      week.push({
        key,
        value,
        level: levelFor(value, thresholds),
        future: date.getTime() > endTime,
      });
    }
    grid.push(week);
  }
  return grid;
}

/**
 * 最长连续天数（与 computeStreak 的区别：这里找的是历史最长，不是当前）。
 *
 * 输入允许重复与乱序 —— 调用方常常是直接 map 出来的日期数组。
 */
export function longestStreak(dayKeys: readonly string[]): number {
  const times = [...new Set(dayKeys)]
    .map((key) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
      if (!m) return null;
      const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
      return Number.isNaN(t) ? null : t;
    })
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);

  if (times.length === 0) return 0;

  let best = 1;
  let run = 1;
  for (let i = 1; i < times.length; i += 1) {
    const gapDays = Math.round((times[i]! - times[i - 1]!) / 86_400_000);
    if (gapDays === 1) {
      run += 1;
      if (run > best) best = run;
    } else if (gapDays > 1) {
      run = 1;
    }
    // gapDays === 0 是重复日期，已在 Set 里去重，不会走到
  }
  return best;
}

/** 网格里所有非 future 格子的数值总和 */
export function sumGrid(grid: HeatmapGrid): number {
  let total = 0;
  for (const week of grid) {
    for (const day of week) {
      if (!day.future && Number.isFinite(day.value)) total += day.value;
    }
  }
  return total;
}

/** 有活动的天数（值 > 0 且不是未来） */
export function activeDays(grid: HeatmapGrid): number {
  let count = 0;
  for (const week of grid) {
    for (const day of week) {
      if (!day.future && day.value > 0) count += 1;
    }
  }
  return count;
}

export const MONTH_LABELS = [
  "1月", "2月", "3月", "4月", "5月", "6月",
  "7月", "8月", "9月", "10月", "11月", "12月",
] as const;

/**
 * 每一列顶部的月份标签，与 grid 的列一一对应；不需要标注的位置是空串。
 *
 * 抽成纯函数有两个理由：
 *   · 它是一段**推演**（哪一列该出现标签），不是渲染细节，值得单独测试
 *   · 在组件的 .map() 里改一个闭包变量来做"上一列是什么"，是渲染期的副作用，
 *     React 的 immutability 规则会（正确地）拦下来
 *
 * `minGap` 是必要的：网格起点若落在月末，第 0 列是"3月"、第 1 列就是"4月"，
 * 两个标签会挤在一起糊成一团。所以换月之后还要隔开几列才允许再标。
 */
export function monthLabels(grid: HeatmapGrid, minGap = 3): string[] {
  const labels: string[] = [];
  let previousMonth = -1;
  let lastLabelAt = -Infinity;

  for (const [index, week] of grid.entries()) {
    const first = week[0];
    if (!first) {
      labels.push("");
      continue;
    }

    const month = Number(first.key.slice(5, 7)) - 1;
    const changed = month !== previousMonth;
    previousMonth = month;

    if (!changed || index - lastLabelAt < minGap) {
      labels.push("");
      continue;
    }

    labels.push(MONTH_LABELS[month] ?? "");
    lastLabelAt = index;
  }

  return labels;
}
