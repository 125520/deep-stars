"use server";

import { revalidatePath } from "next/cache";

import { pickComplexity, type ConstellationComplexity } from "@/lib/constellation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ZODIAC_SIGNS } from "@/lib/zodiac";

/**
 * 换一个星座继续点亮
 * ══════════════════════════════════════════════════════════════════
 *
 * 规则：**当前星座画满之后才能换。**
 *
 * 为什么要求"画满"而不是随时可换：一张星图的价值来自它记录了**一段时间**。
 * 如果随时能换，遇到难熬的一周就会换一个星座重新开始，最后手里全是
 * 画了一半的图 —— 那正是这个产品想解决的问题本身。
 * 画满才换，等于把"换"变成一种奖励而不是一种逃避。
 *
 * 换完之后原来的星座**保留**（archived = true），不是删除：
 * 它是用户真实度过的时间，不该因为开了新的一页就消失。
 * 而且允许再选同一个星座 —— 重新点亮一遍自己那个星座，是有意义的动作。
 */

export type StartConstellationState =
  | { ok: true; sign: string; complexity: ConstellationComplexity }
  | { ok: false; error: string }
  | null;

export async function startConstellation(
  _prev: StartConstellationState,
  formData: FormData,
): Promise<StartConstellationState> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "登录状态已过期，请重新登录。" };

  const key = String(formData.get("sign") ?? "").trim();
  const sign = ZODIAC_SIGNS.find((s) => s.key === key);
  if (!sign) return { ok: false, error: "没有这个星座。" };

  const userId = session.user.id;

  const current = await prisma.constellation.findFirst({
    where: { userId, archived: false },
    orderBy: { createdAt: "asc" },
    select: { id: true, sign: true, complexity: true, completedAt: true },
  });

  /*
    完整性判断以**星点数**为准，而不是只看 completedAt：
    completedAt 是上一版之后才有的字段，老数据里是空的，
    只看它会让老用户永远换不了星座。
  */
  if (current) {
    const lit = await prisma.star.count({ where: { constellationId: current.id } });
    const currentSign = current.sign ? ZODIAC_SIGNS.find((s) => s.key === current.sign) : null;
    const total = currentSign
      ? (current.complexity === "simple" ? currentSign.simple : currentSign.full).stars.length
      : 0;

    // 没有模板的星座（老数据、或没填生日）永远画不满 → 允许换，否则会把用户锁死
    if (total > 0 && lit < total) {
      return {
        ok: false,
        error: `「${currentSign?.name ?? "当前星座"}」还差 ${total - lit} 枚星，画满之后才能换下一个。`,
      };
    }
  }

  // 复杂度跟着**当前**的计划规模重新判定：换星座往往意味着进入新阶段
  // （Plan 没有结束日期，所以 horizon 那一项固定 0，见 checkin.ts 的说明）
  const [activePlans, totalTasks] = await Promise.all([
    prisma.plan.count({ where: { userId, status: { not: "done" } } }),
    prisma.planTask.count({ where: { userId, status: { not: "done" } } }),
  ]);
  const complexity = pickComplexity({ activePlans, totalTasks, longestPlanDays: 0 });

  await prisma.$transaction(async (tx) => {
    if (current) {
      await tx.constellation.update({ where: { id: current.id }, data: { archived: true } });
    }
    await tx.constellation.create({
      data: { userId, name: sign.name, sign: sign.key, complexity },
    });
  });

  revalidatePath("/dashboard");
  return { ok: true, sign: sign.key, complexity };
}
