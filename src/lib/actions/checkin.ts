"use server";

import { revalidatePath } from "next/cache";

import {
  constellationProgress,
  DEFAULT_CONSTELLATION_NAME,
  pickComplexity,
  slotPosition,
  starMagnitude,
  startOfLocalDay,
  type PatternLike,
} from "@/lib/constellation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { signFromBirthday, ZODIAC_SIGNS } from "@/lib/zodiac";

/**
 * 打卡：写下一次记录，同时点亮一枚星
 * ══════════════════════════════════════════════════════════════════
 *
 * 「一次打卡 = 一枚星」是这个产品的核心表达，所以这两件事**必须在同一个
 * 事务里**完成。只写了一半就会出现"有记录、星图上却没有星"的缺口 ——
 * 而这种缺口在界面上完全看不出来，只会让人觉得"我明明打过卡"。
 */

export type CheckinState = { ok: true; magnitude: number } | { ok: false; error: string } | null;

/** 一天最多 24 小时，录进来的值不能超过它 */
const MAX_HOURS = 24;
const MAX_CONTENT = 2000;

export async function createCheckin(
  _prev: CheckinState,
  formData: FormData,
): Promise<CheckinState> {
  // 写操作走 requireSession：数据库故障要抛出去，不能被伪装成"请重新登录"
  const session = await requireSession();
  if (!session) return { ok: false, error: "登录状态已过期，请重新登录。" };

  const content = String(formData.get("content") ?? "").trim();
  if (!content) return { ok: false, error: "写点什么，再点亮这枚星。" };
  if (content.length > MAX_CONTENT) {
    return { ok: false, error: `内容太长了（上限 ${MAX_CONTENT} 字）。` };
  }

  const rawHours = Number.parseFloat(String(formData.get("hours") ?? ""));
  // 非法或负数一律按 0：打卡是记录，不该因为时长填错就整条失败
  const hours = Number.isFinite(rawHours) ? Math.min(Math.max(rawHours, 0), MAX_HOURS) : 0;

  const mood = String(formData.get("mood") ?? "").trim() || null;
  const subject = String(formData.get("subject") ?? "").trim() || null;
  const checkinDate = startOfLocalDay(String(formData.get("date") ?? ""));
  const userId = session.user.id;

  const magnitude = starMagnitude(hours, mood);

  await prisma.$transaction(async (tx) => {
    /*
      一人一座：没有就现建一个，用户不需要先"创建星座"才能打卡。

      ── 首次打卡点亮哪个星座 ──
      有生日就点用户自己那个黄道星座 —— 这是这个产品最有说服力的第一印象：
      打开页面看到的不是一张空白网格，而是自己的星座。
      没有生日（或格式不对）就退回默认星座，流程不受阻。

      ── 用简约档还是完整档 ──
      由用户当前学习计划的规模决定，见 pickComplexity 的注释。
      这里一次性写进 Constellation.complexity，之后不再随计划变化 ——
      星图是"已经发生的记录"，它不该因为后来多建了两个计划就变形。
    */
    let constellation = await tx.constellation.findFirst({
      where: { userId, archived: false },
      orderBy: { createdAt: "asc" },
      select: { id: true, sign: true, complexity: true },
    });

    if (!constellation) {
      const sign = signFromBirthday(session.user.birthday ?? "");
      /*
        用计划与任务的**数量**衡量这个人的学习规模。
        schema 里 Plan 没有结束日期（只有可空的 startDate），所以拿不到
        "计划周期多长"，horizon 那一项固定传 0 —— 宁可少一个维度，
        也不去猜一个数据库里不存在的值。
      */
      const [activePlans, totalTasks] = await Promise.all([
        tx.plan.count({ where: { userId, status: { not: "done" } } }),
        tx.planTask.count({ where: { userId, status: { not: "done" } } }),
      ]);
      const complexity = pickComplexity({ activePlans, totalTasks, longestPlanDays: 0 });

      constellation = await tx.constellation.create({
        data: {
          userId,
          name: sign?.name ?? DEFAULT_CONSTELLATION_NAME,
          sign: sign?.key ?? null,
          complexity,
        },
        select: { id: true, sign: true, complexity: true },
      });
    }

    /** 这个星座用的模板；没有 sign 就是 null，退回黄金角散点 */
    const pattern: PatternLike | null = (() => {
      if (!constellation.sign) return null;
      const sign = ZODIAC_SIGNS.find((s) => s.key === constellation.sign);
      if (!sign) return null;
      return constellation.complexity === "simple" ? sign.simple : sign.full;
    })();

    // 位置由"已有多少枚星"决定，所以是确定的、可复现的
    const index = await tx.star.count({ where: { constellationId: constellation.id } });
    const { x, y } = slotPosition(pattern, index);

    /*
      连线接在**上一枚创建出来的**星，而不是"日期上更早的"星。
      按日期接的话，补录一条旧记录会让链在此处分叉（后一枚星仍然指着老的
      上一枚），星图出现两条互不相连的支线。按创建顺序接，链永远是一条简单路径。
    */
    const prev = await tx.star.findFirst({
      where: { constellationId: constellation.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    const checkin = await tx.checkin.create({
      data: { userId, content, hours, mood, subject, checkinDate },
      select: { id: true },
    });

    await tx.star.create({
      data: {
        userId,
        constellationId: constellation.id,
        checkinId: checkin.id,
        magnitude,
        x,
        y,
        prevStarId: prev?.id ?? null,
        // litAt 用逻辑上的"那一天"，补录时星图排序仍然正确
        litAt: checkinDate,
      },
    });

    /*
      刚刚这一枚是不是把星座画满了？是就记下完成时刻。
      只在**从"未满"跨到"满"**的那一次写入，重复打卡不会反复刷新它 ——
      否则"完成于何时"会变成"最后一次打卡于何时"，两个意思完全不同。
    */
    const before = constellationProgress(pattern, index);
    const after = constellationProgress(pattern, index + 1);
    if (!before.complete && after.complete) {
      await tx.constellation.update({
        where: { id: constellation.id },
        data: { completedAt: new Date() },
      });
    }
  });

  revalidatePath("/dashboard");
  return { ok: true, magnitude };
}
