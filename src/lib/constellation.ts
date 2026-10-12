/**
 * 星图领域逻辑
 * ══════════════════════════════════════════════════════════════════
 *
 * 这一层**不碰数据库、不碰 React**，全是纯函数 —— 因为星图的规则是这个产品
 * 最核心的表达（一次打卡 = 一枚星，星等 = 那天的分量），它必须能被直接测试，
 * 而不是只能靠"跑起来看看"。
 *
 * schema 里写死了一条约束：**星点位置由服务端推演，保证可复现**。
 * 所以这里一个随机数都不能有。
 */

/**
 * 黄金角（≈137.508°）。
 *
 * 用连续累加黄金角来做散点，是「叶序」排列的经典手法：
 * 得到的分布**看似随机、实则完全确定**，而且任意截断前 N 项都均匀 ——
 * 不会像伪随机那样出现明显的成团与空洞。
 * 这正是"可复现"与"好看"能同时成立的原因。
 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * 一圈放满多少枚星就回到内圈重排。
 * 60 枚分布在半径 0.44 的圆面上，最近邻间距仍在可辨认范围内；
 * 再密就会糊成一团，星与星之间看不出「连线」。
 */
const STARS_PER_RING = 60;

/** 星点分布的最大半径（归一化坐标，圆心 0.5） */
const MAX_RADIUS = 0.44;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * 第 index 枚星在星座坐标系中的位置，返回 0..1 的归一化坐标。
 *
 * 半径取 **sqrt** 而不是线性：线性的点会全部挤在圆心附近
 * （因为圆面积按 r² 增长），sqrt 才让点在圆面上均匀铺开。
 */
export function starPosition(index: number): { x: number; y: number } {
  const i = Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0;
  const seat = i % STARS_PER_RING;
  // +0.5 让第 0 枚星也离圆心有一点距离，否则首星会正好压在星座中心
  const radius = MAX_RADIUS * Math.sqrt((seat + 0.5) / STARS_PER_RING);
  const theta = i * GOLDEN_ANGLE;

  return {
    x: clamp(0.5 + radius * Math.cos(theta), 0.02, 0.98),
    y: clamp(0.5 + radius * Math.sin(theta), 0.02, 0.98),
  };
}

/** mood 可能是 "1".."5"，也可能是自由文本（schema 允许两种）。取不出来的就当作没填。 */
function parseMood(mood: string | null | undefined): number | null {
  if (!mood) return null;
  const parsed = Number.parseInt(mood, 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;
}

/**
 * 星等：0..1，越大越亮，决定它在星图上的大小与不透明度。
 *
 * 由两部分构成，**时长封顶 6 小时**：超过之后不再更亮。
 * 这条封顶是有意的 —— 不封顶的话"刷时长"就成了唯一的变亮途径，
 * 而这个产品想奖励的是「持续出现」，不是单日时长。
 * 状态（mood）只占 0.2 的权重，起微调作用，不该能左右整体。
 */
export function starMagnitude(hours: number, mood?: string | null): number {
  const safeHours = Number.isFinite(hours) ? Math.max(0, hours) : 0;
  const byHours = (Math.min(safeHours, 6) / 6) * 0.55;

  const moodScore = parseMood(mood);
  const byMood = moodScore === null ? 0 : ((moodScore - 1) / 4) * 0.2;

  return clamp(0.25 + byHours + byMood, 0.15, 1);
}

/** 新用户的默认星座名。一人一座，后续可以按科目再分。 */
export const DEFAULT_CONSTELLATION_NAME = "我的星图";

// ══════════════════════════════════════════════════════════════════
//  星座模板：按真实星座的形状落位
// ══════════════════════════════════════════════════════════════════

/**
 * 模板只需要「有一串带 x/y 的星点」。
 *
 * 这里刻意用结构化类型而不是 import 星座数据模块：
 *   · 本文件是纯领域逻辑，不该被一份数据文件的形状绑住；
 *   · 数据模块可以自由增删字段而不惊动这里。
 */
export type PatternLike = {
  stars: ReadonlyArray<{ x: number; y: number }>;
};

export type ConstellationComplexity = "simple" | "full";

/**
 * 第 index 枚星该落在哪。
 *
 * 有模板就按模板落位 —— 于是星图长得像那个星座；
 * 没有模板（没填生日的早期用户）就退回黄金角散点，
 * **行为与加模板之前完全一致**，不会出现"升级之后老用户星图变了"。
 *
 * 星数超过模板时也走散点：星座画满了还在涨，说明用户已经远超这个星座
 * 能表达的量，此时继续往模板坐标上堆点只会让图形糊掉。
 */
export function slotPosition(
  pattern: PatternLike | null | undefined,
  index: number,
): { x: number; y: number } {
  const i = Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0;
  const star = pattern?.stars?.[i];
  if (star) {
    return { x: clamp(star.x, 0.02, 0.98), y: clamp(star.y, 0.02, 0.98) };
  }
  return starPosition(i);
}

/** 一份模板能被点亮多少枚星 */
export function patternSize(pattern: PatternLike | null | undefined): number {
  return pattern?.stars?.length ?? 0;
}

/**
 * 星座进度。`complete` 只在**模板存在**且星点占满时才为真 ——
 * 没有模板的星座永远不算"完成"，否则黄金角布局会在第 60 枚星时
 * 莫名其妙地宣布完成。
 */
export function constellationProgress(
  pattern: PatternLike | null | undefined,
  litCount: number,
): { lit: number; total: number; ratio: number; complete: boolean } {
  const lit = Number.isFinite(litCount) ? Math.max(0, Math.trunc(litCount)) : 0;
  const total = patternSize(pattern);
  if (total === 0) return { lit, total: 0, ratio: 0, complete: false };
  return {
    lit: Math.min(lit, total),
    total,
    ratio: Math.min(1, lit / total),
    complete: lit >= total,
  };
}

/**
 * 学习计划的复杂度 → 星图用简约档还是完整档。
 *
 * 为什么值得做这件事：一个只想每天读半小时书的人，拿到一张 14 枚星的完整
 * 狮子座，要打卡两周才画完，中途看不出任何进展；而一个同时铺开四个计划的人
 * 拿到 5 枚星的简约档，一周就画满了，之后无事可做。
 * 两种人需要的**信息密度**不一样，星图应该跟着变。
 *
 * 打分而不是写一串 if：分数让"为什么这次是完整档"可以被解释、可以被测试，
 * 也让以后调整阈值时不必重写判断结构。
 *
 *   每个任务 1 分 · 每个活跃计划 3 分 · 长期计划额外 6 分（30 天以上 3 分）
 *
 * 阈值 12 分：大概相当于「一个计划 + 八九个任务」或「三个计划」。
 * 低于它说明这个人要的是简单反馈，高于它说明他要的是一张能撑住的图。
 */
export function planComplexityScore(input: {
  activePlans: number;
  totalTasks: number;
  longestPlanDays: number;
}): number {
  const plans = Number.isFinite(input.activePlans) ? Math.max(0, input.activePlans) : 0;
  const tasks = Number.isFinite(input.totalTasks) ? Math.max(0, input.totalTasks) : 0;
  const days = Number.isFinite(input.longestPlanDays) ? Math.max(0, input.longestPlanDays) : 0;

  const horizon = days > 60 ? 6 : days > 30 ? 3 : 0;
  return tasks + plans * 3 + horizon;
}

export function pickComplexity(input: {
  activePlans: number;
  totalTasks: number;
  longestPlanDays: number;
}): ConstellationComplexity {
  return planComplexityScore(input) > 12 ? "full" : "simple";
}

/** 换星座时可选的主题色。schema 的 accent 字段默认 aurora。 */
export type ConstellationAccent = "aurora" | "nebula" | "starlight";

/**
 * 把用户输入的一天（YYYY-MM-DD）折成当天的起点时刻。
 *
 * 打卡按**天**聚合，所以要有一个明确的「这一天从几点开始」。
 * 用本地时区的 00:00 而不是 UTC —— 用户说"今天"指的是他所在的今天，
 * 用 UTC 会让东八区的凌晨打卡算到前一天去。
 *
 * 传入非法字符串时回退到当前时刻，不抛错：打卡这种操作，
 * 日期解析失败就当成"现在"比让整个请求失败更合理。
 */
export function startOfLocalDay(input?: string | null): Date {
  if (input) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
    if (match) {
      const [, y, m, d] = match;
      const date = new Date(Number(y), Number(m) - 1, Number(d));
      if (!Number.isNaN(date.getTime())) return date;
    }
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** 把 Date 折成 YYYY-MM-DD（**本地**时区），用于按天聚合与去重 */
export function toLocalDayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const DAY_MS = 86_400_000;

function dayKeyToTime(key: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const time = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * 连续打卡天数。
 *
 * 有一条容易写错、写错就很难发现的规则：
 * **今天还没打卡，不该让连续天数归零。**
 * 否则用户每天早上打开页面看到的是「连续 0 天」——昨天刚坚持过，
 * 一睁眼却被告知清零，这是最伤人的一种反馈。
 * 所以起点允许是今天**或昨天**。
 *
 * 用 Math.round 而不是整除：跨夏令时的那一天不是整 86400000 毫秒，
 * 直接除会得到 0.958 这样的值而被判成"断了"。
 */
export function computeStreak(dayKeys: readonly string[], today: string): number {
  const times = [...new Set(dayKeys)]
    .map(dayKeyToTime)
    .filter((t): t is number => t !== null)
    .sort((a, b) => b - a);

  const todayTime = dayKeyToTime(today);
  if (times.length === 0 || todayTime === null) return 0;

  const sinceLast = Math.round((todayTime - times[0]!) / DAY_MS);
  // 最近一次既不是今天也不是昨天 → 真的断了
  if (sinceLast > 1) return 0;

  let streak = 1;
  let cursor = times[0]!;
  for (let i = 1; i < times.length; i += 1) {
    if (Math.round((cursor - times[i]!) / DAY_MS) !== 1) break;
    streak += 1;
    cursor = times[i]!;
  }
  return streak;
}

/** 累计专注小时数。用于"累计时长撑开整片星云"这类展示。 */
export function totalHours(hoursList: readonly number[]): number {
  return hoursList.reduce((sum, h) => sum + (Number.isFinite(h) && h > 0 ? h : 0), 0);
}
