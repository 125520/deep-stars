/*
  相对路径 + .ts 扩展名：纯领域模块必须能被 node --test 直接加载。
  由 eslint 的 no-restricted-imports 强制，原因见该规则。
*/
import { longestStreak, MONTH_LABELS } from "./heatmap.ts";

/**
 * 年度报告聚合
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯函数：输入"日期 → 分钟数"和"有打卡的日子"，输出一份可直接渲染的年报。
 *
 * 这一块的价值全在**边界**上：一份年报一年只生成一次，
 * 出错没人会发现，而它会一直被当成年终总结留在那里。
 * 所以空年份、闰年、跨年数据混入、并列最大值这些都要有明确行为。
 */

export type AnnualReport = {
  year: number;
  /** 全年专注分钟数 */
  totalMinutes: number;
  /** 全年专注小时数（保留一位小数） */
  totalHours: number;
  /** 有记录的天数 */
  activeDays: number;
  /** 最长连续天数（**只在本年内计算**，不跨年） */
  longestStreak: number;
  /** 打卡产生的星数 */
  stars: number;
  /** 12 个月的分钟数，索引 0 = 1 月 */
  monthly: number[];
  bestMonth: { month: number; label: string; minutes: number } | null;
  bestDay: { key: string; minutes: number } | null;
  firstDay: string | null;
  lastDay: string | null;
};

/** 日期键是否属于指定年份。用前缀判断，不做日期解析。 */
function inYear(key: string, year: number): boolean {
  return key.startsWith(`${year}-`);
}

/** 从 YYYY-MM-DD 取月份索引（0–11）。取不到返回 -1。 */
function monthOf(key: string): number {
  const month = Number(key.slice(5, 7)) - 1;
  return Number.isInteger(month) && month >= 0 && month <= 11 ? month : -1;
}

export function buildAnnualReport(input: {
  year: number;
  /** YYYY-MM-DD → 当天专注分钟数 */
  minutesByDay: ReadonlyMap<string, number>;
  /** 有打卡的日子（可能有重复；也**可能包含其他年份**，这里会过滤） */
  starDays: readonly string[];
}): AnnualReport {
  const { year } = input;

  const monthly = new Array<number>(12).fill(0);
  let totalMinutes = 0;
  let activeDays = 0;
  let bestDay: { key: string; minutes: number } | null = null;

  // 先按日期排序，firstDay / lastDay 才能用首尾元素直接取到
  const keys = [...input.minutesByDay.keys()].filter((key) => inYear(key, year)).sort();

  for (const key of keys) {
    const raw = input.minutesByDay.get(key) ?? 0;
    // 脏数据不该把整年的合计算成 NaN —— 一处坏值只丢弃它自己
    if (!Number.isFinite(raw) || raw <= 0) continue;

    totalMinutes += raw;
    activeDays += 1;

    const month = monthOf(key);
    // 用 `= (x ?? 0) + raw` 而不是 `+=`：tsconfig 开了 noUncheckedIndexedAccess，
    // 索引访问的类型是 number | undefined，复合赋值过不了类型检查
    if (month >= 0) monthly[month] = (monthly[month] ?? 0) + raw;

    // 严格大于：并列时保留**更早**的那天（keys 已排序），
    // 否则"全年最好的一天"会随 Map 的遍历顺序变来变去
    const previousBest = bestDay;
    if (previousBest === null || raw > previousBest.minutes) {
      bestDay = { key, minutes: raw };
    }
  }

  const yearStars = [...new Set(input.starDays.filter((key) => inYear(key, year)))];

  let bestMonth: AnnualReport["bestMonth"] = null;
  for (const [index, minutes] of monthly.entries()) {
    if (minutes <= 0) continue;
    if (!bestMonth || minutes > bestMonth.minutes) {
      bestMonth = { month: index + 1, label: MONTH_LABELS[index] ?? `${index + 1}月`, minutes };
    }
  }

  return {
    year,
    totalMinutes,
    totalHours: Math.round((totalMinutes / 60) * 10) / 10,
    activeDays,
    // 传入的是本年的日期，所以连续段不会跨年 —— 年报说"最长连续 30 天"
    // 指的应当是"这一年里的最长一段"，而不是横跨两年的那一段
    longestStreak: longestStreak(yearStars),
    stars: yearStars.length,
    monthly,
    bestMonth,
    bestDay,
    firstDay: keys.length > 0 ? keys[0]! : null,
    lastDay: keys.length > 0 ? keys[keys.length - 1]! : null,
  };
}

/** 可供切换的年份列表：从有数据的第一年到今年 */
export function availableYears(dayKeys: readonly string[], currentYear: number): number[] {
  const years = new Set<number>();
  for (const key of dayKeys) {
    const year = Number(key.slice(0, 4));
    if (Number.isInteger(year) && year > 1900 && year <= currentYear) years.add(year);
  }
  years.add(currentYear);
  return [...years].sort((a, b) => b - a);
}

/**
 * 一天的分钟数 → 一句评价。年报里每个数字都配一句人话，比只有数字好读。
 *
 * 阈值按"一天 1440 分钟"来定：4 小时才配得上「大半天」，
 * 8 小时才是「几乎一整天」。最初写成 180/360，结果 3.3 小时
 * 被说成「几乎一整天」—— 那是测试抓出来的，不是看出来的。
 */
export function describeDay(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "没有记录";
  if (minutes < 30) return "轻轻碰了一下";
  if (minutes < 90) return "认真了一段时间";
  if (minutes < 240) return "投入了大半天";
  if (minutes < 480) return "几乎一整天";
  return "那一整天都在里面";
}
