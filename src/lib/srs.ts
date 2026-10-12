/**
 * 间隔重复调度（SM-2 变体）
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯函数，`now` 显式传入。这是整个应用里**最值得被测试**的一段逻辑：
 * 它的输出是"什么时候再让你看这张卡"，规则错了不会报错，
 * 只会让人在错误的时间复习 —— 而这种损害是静默的、累积的。
 *
 * ── 相对经典 SM-2 的三处偏离（都是有意的）───────────────────────
 *
 * 1. **四档评分，不是 0–5。** 界面上是 again / hard / good / easy 四个按钮，
 *    对应质量分 2 / 3 / 4 / 5。人对着 0–5 打分时，打分本身就成了负担，
 *    而且不同人对"4 分"的理解不一致 —— 一致性比精细度重要。
 *
 * 2. **"再来一次"当天重来，不是明天。** 经典实现把 q<3 的间隔设为 1 天，
 *    但那意味着刚答错的卡要等到明天 —— 那时早就忘了当时为什么错。
 *    这里改为 10 分钟后，并在同一次复习会话里再次出现。
 *
 * 3. **间隔有 10 年上限。** 到不了上限的卡片不该出问题，
 *    但一个算错的大数会变成"再也不会出现"，那等于卡片消失。
 */

/** 四档评分 */
export const GRADES = ["again", "hard", "good", "easy"] as const;
export type Grade = (typeof GRADES)[number];

/** 评分 → SM-2 质量分（0–5）*/
const QUALITY: Record<Grade, number> = { again: 2, hard: 3, good: 4, easy: 5 };

export const GRADE_LABELS: Record<Grade, string> = {
  again: "再来一次",
  hard: "有点难",
  good: "记得",
  easy: "很简单",
};

export function gradeLabel(grade: Grade): string {
  return GRADE_LABELS[grade];
}

/** 易记因子下限。SM-2 的原始论文里就是这个值，低于它间隔会几乎不增长。 */
const MIN_EASE = 1.35;
/** 易记因子上限。不封顶的话连续点"很简单"会让间隔膨胀到不合理的程度。 */
const MAX_EASE = 3.2;
/** 间隔上限（天）≈ 10 年 */
const MAX_INTERVAL = 3650;
/** 答错后多久重来（分钟）*/
const RELEARN_MINUTES = 10;
/** 初次"有点难"的间隔（天）*/
const HARD_FIRST = 1;
/** 初次"记得"的间隔（天）。6 天是 SM-2 的原始取值。 */
const GOOD_FIRST = 1;
const GOOD_SECOND = 6;
/** 初次"很简单"的间隔（天）*/
const EASY_FIRST = 4;

export type SrsState = {
  ease: number;
  interval: number;
  reps: number;
  lapses: number;
};

export type SrsResult = SrsState & {
  dueAt: Date;
  /** learning（当天还要再看）| review（进入正常间隔）*/
  state: "learning" | "review";
};

/** 新卡片的初始调度状态：立刻可复习 */
export function initialState(now: Date): SrsState & { dueAt: Date; state: "new" } {
  return { ease: 2.5, interval: 0, reps: 0, lapses: 0, dueAt: now, state: "new" };
}

/**
 * 按 SM-2 调整易记因子。
 *
 * 公式取自原论文：EF' = EF + (0.1 − (5−q) × (0.08 + (5−q) × 0.02))
 * 四档对应的增量分别是 −0.32 / −0.14 / 0 / +0.10。
 * 注意"记得"（q=4）的增量正好是 0 —— 也就是说
 * **只有答错会惩罚、只有"很简单"会奖励**，中间两档维持现状。
 */
function nextEase(ease: number, grade: Grade): number {
  const q = QUALITY[grade];
  const delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  const raw = ease + delta;
  // 先夹下限再夹上限：两个边界都是硬约束，顺序不影响结果但要都做
  return Math.min(MAX_EASE, Math.max(MIN_EASE, Number(raw.toFixed(4))));
}

function clampInterval(days: number): number {
  if (!Number.isFinite(days)) return GOOD_FIRST;
  return Math.min(MAX_INTERVAL, Math.max(1, Math.round(days)));
}

function addDays(now: Date, days: number): Date {
  // 用构造器而不是加毫秒：跨夏令时加 86400000 会落到前一天的 23:00
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, now.getHours(), now.getMinutes());
}

/**
 * 计算下一次复习时间。
 *
 * 不修改传入的 state（返回新对象）—— 调用方常常直接把数据库读出的行传进来。
 */
export function schedule(current: SrsState, grade: Grade, now: Date): SrsResult {
  const ease = nextEase(current.ease, grade);

  // ── 答错：回到学习阶段 ──
  if (grade === "again") {
    const dueAt = new Date(now.getTime() + RELEARN_MINUTES * 60_000);
    return {
      ease,
      // interval 归零而不是保留旧值：留着旧间隔会让"连续答对次数"
      // 与间隔长度脱节，下次答对时算出来的间隔会大得离谱
      interval: 0,
      reps: 0,
      lapses: current.lapses + 1,
      dueAt,
      state: "learning",
    };
  }

  const reps = current.reps + 1;

  let interval: number;
  if (grade === "hard") {
    // "有点难"不该让间隔归零，但也不该让它按易记因子增长
    interval =
      current.interval <= 0 ? HARD_FIRST : clampInterval(current.interval * 1.2);
  } else if (grade === "good") {
    if (current.interval <= 0) interval = GOOD_FIRST;
    else if (reps <= 2) interval = GOOD_SECOND;
    else interval = clampInterval(current.interval * ease);
  } else {
    // easy：在正常增长之上再乘 1.3，且首次就给一个更长的间隔
    interval =
      current.interval <= 0 ? EASY_FIRST : clampInterval(current.interval * ease * 1.3);
  }

  return {
    ease,
    interval,
    reps,
    lapses: current.lapses,
    dueAt: addDays(now, interval),
    state: "review",
  };
}

/** 是否到了该复习的时间 */
export function isDue(card: { dueAt: Date }, now: Date): boolean {
  return card.dueAt.getTime() <= now.getTime();
}

/**
 * 把间隔天数说成人话。
 * 卡片列表上写"3 天后"比写"间隔 3"有用得多 —— 前者直接回答"我什么时候要再看它"。
 */
export function describeInterval(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "今天";
  if (days === 1) return "明天";
  if (days < 30) return `${Math.round(days)} 天后`;
  if (days < 365) return `${Math.round(days / 30)} 个月后`;
  const years = days / 365;
  return `${years < 1.5 ? "1" : Math.round(years)} 年后`;
}
