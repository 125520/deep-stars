/*
  相对路径 + .ts 扩展名：纯领域模块必须能被 node --test 直接加载。
  由 eslint 的 no-restricted-imports 强制。
*/
import { computeStreak, toLocalDayKey } from "./constellation.ts";

/**
 * 主动教练：信号识别与措辞
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯函数。**没有 AI 密钥时它就是教练本身** —— 这不是"降级"，而是刻意的设计：
 * 基于规则的建议在这个产品里能做到的事情，比一句通用鼓励多得多。
 * 配了密钥之后，这里识别出的**信号**会作为上下文交给模型去润色，
 * 但"该不该提醒、提醒什么"始终由规则决定。
 *
 * ── 一条贯穿全篇的措辞纪律 ──────────────────────────────────────
 *
 * **绝不指责。** 这个产品的立场写在别处：空白不代表失败，只是那天没记。
 * 断签提醒如果写成"你已经 3 天没学习了"，收到的效果是让人不敢打开应用 ——
 * 那正好和产品目标相反。
 *
 * 所以每条消息都必须满足两点：
 *   · 陈述事实，不评价人格（说"今天还没记录"，不说"你太懒了"）
 *   · 给出一个**足够小**的下一步（说"点一枚星"，不说"把落下的补回来"）
 */

export type CoachSignalKind =
  | "newcomer"
  | "streak-at-risk"
  | "comeback"
  | "review-backlog"
  | "plan-stalled";

export type CoachSignal = {
  kind: CoachSignalKind;
  /** 排序用：越小越该先说 */
  priority: number;
  /** 供措辞与 AI 上下文使用的原始数据 */
  data: Record<string, string | number>;
};

export type CoachPlanInput = {
  name: string;
  /** 最近一次完成任务的时刻；从未完成过则为 null */
  lastDoneAt: Date | null;
  openTasks: number;
};

export type CoachContext = {
  now: Date;
  /** 有打卡的日子（YYYY-MM-DD，可重复、可乱序） */
  checkinDays: readonly string[];
  plans: readonly CoachPlanInput[];
  /** 今天到期的复习卡数量 */
  reviewDue: number;
};

/** 断签提醒的触发时刻：过了这个点还没打卡才提醒，否则一天要被打扰好几次 */
const EVENING_HOUR = 18;
/** 计划停滞多久算停滞 */
const PLAN_STALLED_DAYS = 7;
/** 复习卡积压到多少张才值得提醒 */
const REVIEW_BACKLOG = 10;
/** 间隔多少天以上再回来，算「回来」而不是「连续」 */
const COMEBACK_GAP_DAYS = 3;

const DAY_MS = 86_400_000;

function dayKeyOf(date: Date): string {
  return toLocalDayKey(date);
}

/** 两个日期间隔几天（按日期算，不看时分秒） */
function daysBetween(fromKey: string, toKey: string): number {
  const parse = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y!, m! - 1, d!).getTime();
  };
  return Math.round((parse(toKey) - parse(fromKey)) / DAY_MS);
}

/**
 * 识别当前值得说一句的信号。
 *
 * 返回**按优先级排序**的数组：调用方通常只取第一条 ——
 * 一次抛三条提醒会让人一条都不想看。
 */
export function detectSignals(ctx: CoachContext): CoachSignal[] {
  const signals: CoachSignal[] = [];
  const today = dayKeyOf(ctx.now);
  const uniqueDays = [...new Set(ctx.checkinDays)].sort();
  const total = uniqueDays.length;

  // ── 一条记录都没有：引他去点第一枚星 ──
  if (total === 0) {
    signals.push({
      kind: "newcomer",
      priority: 10,
      data: {},
    });
    return signals;
  }

  const lastDay = uniqueDays[uniqueDays.length - 1]!;

  // ── 断签提醒：连续还活着、但今天还没记，且已经到晚上 ──
  // 用 computeStreak 判断"连续还活着"而不是自己数 —— 那条规则（今天没打
  // 不算断）已经在那里定义过一遍，重复实现迟早分叉。
  const streak = computeStreak(uniqueDays, today);
  if (streak > 0 && lastDay !== today && ctx.now.getHours() >= EVENING_HOUR) {
    signals.push({
      kind: "streak-at-risk",
      priority: 1,
      data: { streak, lastDay },
    });
  }

  /*
    ── 离开一段时间又回来了 ──

    ⚠️ 间隔要算**最后两次打卡之间**，不是"最后一次到今天"。
    后者在"今天确实记了"的前提下恒为 0，这个信号永远不会触发 ——
    第一版就是这么写的，被测试当场抓住。
  */
  if (lastDay === today && uniqueDays.length >= 2) {
    const previousDay = uniqueDays[uniqueDays.length - 2]!;
    const gap = daysBetween(previousDay, lastDay);
    if (gap >= COMEBACK_GAP_DAYS) {
      signals.push({
        kind: "comeback",
        priority: 2,
        data: { gap },
      });
    }
  }

  // ── 复习积压 ──
  if (ctx.reviewDue >= REVIEW_BACKLOG) {
    signals.push({
      kind: "review-backlog",
      priority: 3,
      data: { due: ctx.reviewDue },
    });
  }

  // ── 计划停滞：还有没做完的任务，但很久没推进 ──
  for (const plan of ctx.plans) {
    if (plan.openTasks <= 0) continue;
    const reference = plan.lastDoneAt ?? null;
    // 从未完成过任何任务的计划，从"停滞"的角度看没有基准点，跳过
    if (!reference) continue;

    const stalled = Math.floor((ctx.now.getTime() - reference.getTime()) / DAY_MS);
    if (stalled >= PLAN_STALLED_DAYS) {
      signals.push({
        kind: "plan-stalled",
        priority: 4,
        data: { plan: plan.name, days: stalled, open: plan.openTasks },
      });
    }
  }

  return signals.sort((a, b) => a.priority - b.priority);
}

export type CoachMessage = {
  title: string;
  body: string;
  /** 点进去能直接做那件事 */
  actionUrl: string;
};

/**
 * 把信号写成人话。
 *
 * 每条都遵守文件头的措辞纪律：先陈述事实，再给一个足够小的下一步。
 * 注意「今天还没记录」与「你已经 3 天没学习」的差别 ——
 * 前者是事实，后者是判决。
 */
export function composeMessage(signal: CoachSignal): CoachMessage {
  switch (signal.kind) {
    case "newcomer":
      return {
        title: "从点亮第一枚星开始",
        body: "写下今天做了什么，星图上就会亮起第一枚星。一句话就够。",
        actionUrl: "/dashboard",
      };

    case "streak-at-risk": {
      const streak = Number(signal.data.streak ?? 0);
      return {
        title: "今天还没记录",
        body: `已经连着 ${streak} 天了。今天还剩几个小时 —— 一句话就能把它接上。`,
        actionUrl: "/dashboard",
      };
    }

    case "comeback": {
      const gap = Number(signal.data.gap ?? 0);
      return {
        title: "欢迎回来",
        body: `隔了 ${gap} 天。不用补，从今天这一枚星重新开始就行。`,
        actionUrl: "/dashboard",
      };
    }

    case "review-backlog": {
      const due = Number(signal.data.due ?? 0);
      return {
        title: `${due} 张卡到期了`,
        body: "趁还记得的时候过一遍，比攒到周末再突击有效得多。",
        actionUrl: "/review",
      };
    }

    case "plan-stalled": {
      const plan = String(signal.data.plan ?? "计划");
      const days = Number(signal.data.days ?? 0);
      return {
        title: `「${plan}」停了 ${days} 天`,
        body: "不用一次推很多，挑最小的一项做完就算推进。",
        actionUrl: "/plans",
      };
    }
  }
}

/**
 * 一次性得到"当前最该说的那句话"，没有值得说的就返回 null。
 *
 * 调用方（仪表盘、通知生成器）只需要这一个入口 ——
 * 让它来决定"取第几条"，避免两个地方各排一次序。
 */
export function pickCoachMessage(ctx: CoachContext): CoachMessage | null {
  const signal = detectSignals(ctx)[0];
  return signal ? composeMessage(signal) : null;
}
