import { rewriteCoachMessage } from "@/lib/ai/rephrase";
import { pickCoachMessage, type CoachContext } from "@/lib/coach";
import { toLocalDayKey } from "@/lib/constellation";
import { countUnread, planNotifications } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

/**
 * 通知的服务端内部函数
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ **这个文件刻意没有 `"use server"`，而且不能加。**
 *
 * 带 `"use server"` 的文件里，每个导出都会变成一个**可被直接调用的端点** ——
 * 包括带参数的。像 `syncNotifications(userId)` 这种签名，一旦成为端点，
 * 任何人传别人的 userId 就能往对方账号里塞通知。
 *
 * 所以这里只放"由服务端组件在渲染时调用"的函数，它们**自己读会话**，
 * 不接受调用方传入的用户身份。真正的用户动作（标记已读、删除）
 * 放在 src/lib/actions/notifications.ts 里。
 *
 * ── 为什么是「打开页面时顺带生成」而不是定时任务 ────────────────
 *
 * 定时任务需要 Cron 与一个受保护的端点，收益只是"用户没打开页面时也能收到" ——
 * 可他没打开页面时，通知躺在那儿也没人看。
 *
 * 所以改成惰性生成。**关键是必须幂等**：React 在开发模式下会渲染两次
 * （StrictMode），刷新页面也可能触发多次渲染。幂等由 lib/notifications.ts
 * 的「每日去重」保证，那条规则有测试覆盖。
 */

/** 把当前该发的通知写进库。**幂等**：同一天同类型只会有一条。 */
export async function syncNotifications(): Promise<void> {
  const session = await requireSession();
  if (!session) return;
  const userId = session.user.id;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [existing, litDays, plans, reviewDue] = await Promise.all([
    // 只取今天的：去重窗口就是当天，取全部纯属浪费
    prisma.notification.findMany({
      where: { userId, createdAt: { gte: startOfToday } },
      select: { type: true, createdAt: true },
    }),
    prisma.star.findMany({ where: { userId }, select: { litAt: true } }),
    prisma.plan.findMany({
      where: { userId, status: "active" },
      select: { name: true, tasks: { select: { status: true, completedAt: true } } },
    }),
    prisma.reviewCard.count({
      where: { userId, state: { not: "suspended" }, dueAt: { lte: now } },
    }),
  ]);

  const planned = planNotifications({
    now,
    existing,
    coach: pickCoachMessage(buildCoachContext(now, litDays, plans, reviewDue)),
    reviewDue,
  });

  if (planned.length === 0) return;

  /*
    ── 用用户自己的密钥把教练文案改写一遍 ──────────────────────────

    放在这里而不是页面渲染里，是因为**这条路径本身已经按天去重**
    （见 lib/notifications.ts 的每日去重规则）——
    所以一个用户一天最多产生一次付费调用。
    挂在渲染上就完全不是一回事了：刷新几次就把额度刷完。

    改写失败时 rewriteCoachMessage 内部会退回规则文案，
    这里拿到的永远是一句能显示的话。
  */
  const ready = await Promise.all(
    planned.map(async (item) => {
      if (item.type !== "coach") return item;
      const rewrite = await rewriteCoachMessage(userId, { title: item.title, body: item.body, actionUrl: item.actionUrl ?? "" }, {
        streak: litDays.length > 0 ? 1 : 0,
        stars: litDays.length,
        activeDays: litDays.filter((s) => now.getTime() - s.litAt.getTime() < 7 * 86_400_000).length,
        reviewDue,
      });
      return { ...item, body: rewrite.body };
    }),
  );

  await prisma.notification.createMany({
    data: ready.map((item) => ({
      userId,
      type: item.type,
      title: item.title,
      // 领域层叫 body，schema 里的列叫 content —— 在边界上显式映射一次，
      // 而不是把两边的命名硬凑成一样（领域层用 body 更顺，
      // 但改 schema 要动两个变体与已有数据，不值得）
      content: item.body,
      actionUrl: item.actionUrl,
    })),
  });
}

/** 未读数。导航栏的小红点用它。 */
export async function readUnreadCount(): Promise<number> {
  const session = await requireSession();
  if (!session) return 0;

  const rows = await prisma.notification.findMany({
    where: { userId: session.user.id, read: false },
    select: { read: true },
  });
  return countUnread(rows);
}

/**
 * 把数据库里的行装配成教练要的上下文。
 *
 * 仪表盘与通知同步**用同一个函数** —— 两处各写一遍装配逻辑，
 * 迟早出现"页面上显示欢迎回来、通知里却是复习提醒"这种自相矛盾。
 */
export function buildCoachContext(
  now: Date,
  litDays: readonly { litAt: Date }[],
  plans: readonly { name: string; tasks: readonly { status: string; completedAt: Date | null }[] }[],
  reviewDue: number,
): CoachContext {
  return {
    now,
    checkinDays: litDays.map((s) => toLocalDayKey(s.litAt)),
    plans: plans.map((plan) => {
      const done = plan.tasks.filter((t) => t.status === "done" && t.completedAt);
      const latest = done.reduce<Date | null>((acc, t) => {
        const at = t.completedAt!;
        return acc === null || at > acc ? at : acc;
      }, null);
      return {
        name: plan.name,
        lastDoneAt: latest,
        openTasks: plan.tasks.filter((t) => t.status === "pending" || t.status === "doing").length,
      };
    }),
    reviewDue,
  };
}
