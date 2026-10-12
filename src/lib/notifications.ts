/**
 * 通知的去重与聚合
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯函数。这里只解决一件事：**同一天不要重复产生同一种通知**。
 *
 * 这里用的是**每日去重**：按本地日期判断今天是否已经发过同类型的通知 ——
 * 因为通知的生成时机是「用户打开仪表盘时顺带检查」，而不是定时任务。
 * 不做去重的话，用户刷新三次页面就会收到三条一样的提醒，然后他就会把通知关掉。
 */

import { toLocalDayKey } from "./constellation.ts";

export type NotificationLike = {
  type: string;
  createdAt: Date;
};

/** 通知类型。与 schema 里 `Notification.type` 的取值保持一致。 */
export const NOTIFICATION_TYPES = ["coach", "report", "review", "reminder", "system"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * 同一天是否已经产生过该类型的通知。
 *
 * 按**本地日期**比较而不是时间差：用户说的"今天"是他所在的今天，
 * 用 24 小时窗口会让"昨晚 23:00 收到过 → 今天 22:00 又收到"这种
 * 跨天但不足 24 小时的情况被误判成重复。
 */
export function hasNotificationForDay(
  existing: readonly NotificationLike[],
  type: string,
  now: Date,
): boolean {
  const today = toLocalDayKey(now);
  return existing.some(
    (item) => item.type === type && toLocalDayKey(item.createdAt) === today,
  );
}

/**
 * 决定这一轮该写入哪些通知。
 *
 * 返回需要**新建**的列表；调用方只需要按它写库。
 * 把判断收在这里而不是散在调用方，是为了让"什么情况下会打扰用户"
 * 变成一处可读、可测的规则。
 */
export function planNotifications(input: {
  now: Date;
  existing: readonly NotificationLike[];
  /** 教练当前想说的话；没有就传 null */
  coach: { title: string; body: string; actionUrl: string } | null;
  /** 到期复习卡数量 */
  reviewDue: number;
  /** 到期卡达到多少张才值得专门发一条通知（比仪表盘卡片的阈值高） */
  reviewThreshold?: number;
}): { type: NotificationType; title: string; body: string; actionUrl: string | null }[] {
  const { now, existing, coach } = input;
  const threshold = input.reviewThreshold ?? 20;
  const planned: { type: NotificationType; title: string; body: string; actionUrl: string | null }[] = [];

  // ── 教练建议：一天最多一条 ──
  if (coach && !hasNotificationForDay(existing, "coach", now)) {
    planned.push({
      type: "coach",
      title: coach.title,
      body: coach.body,
      actionUrl: coach.actionUrl,
    });
  }

  /*
    ── 复习积压 ──
    阈值刻意比仪表盘卡片高（20 vs 10）：卡片是"顺手看一眼"，
    通知是"主动打断"。同一个数量在两个地方该有不同的冒泡门槛。
  */
  if (input.reviewDue >= threshold && !hasNotificationForDay(existing, "review", now)) {
    planned.push({
      type: "review",
      title: `${input.reviewDue} 张卡堆着了`,
      body: "按计划复习的效果最好，攒到周末突击等于重学一遍。",
      actionUrl: "/review",
    });
  }

  return planned;
}

/** 未读数。用于导航栏上的小红点。 */
export function countUnread(items: readonly { read: boolean }[]): number {
  return items.reduce((sum, item) => (item.read ? sum : sum + 1), 0);
}
