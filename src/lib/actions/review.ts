"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { GRADES, initialState, schedule, type Grade } from "@/lib/srs";

/**
 * 复习卡的写操作
 * ══════════════════════════════════════════════════════════════════
 *
 * 与其他模块同样的纪律：**每一条 where 里都有 userId。**
 */

export type ReviewState = { ok: true; message: string } | { ok: false; error: string } | null;

const MAX_SIDE = 2000;

export async function createCard(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "登录状态已过期，请重新登录。" };

  const front = String(formData.get("front") ?? "").trim();
  const back = String(formData.get("back") ?? "").trim();

  if (!front) return { ok: false, error: "正面还没写。" };
  if (!back) return { ok: false, error: "背面还没写。" };
  if (front.length > MAX_SIDE || back.length > MAX_SIDE) {
    return { ok: false, error: `每面最多 ${MAX_SIDE} 字。` };
  }

  const rawTags = String(formData.get("tags") ?? "").trim();
  // 标签统一成"逗号分隔、去空、去重"，避免同一张卡因为写法不同被分成两类
  const tags = rawTags
    ? [...new Set(rawTags.split(/[,，]/).map((t) => t.trim()).filter(Boolean))].join(",")
    : null;

  const now = new Date();
  const initial = initialState(now);

  await prisma.reviewCard.create({
    data: {
      userId: session.user.id,
      front,
      back,
      tags,
      ease: initial.ease,
      interval: initial.interval,
      reps: initial.reps,
      lapses: initial.lapses,
      // 新卡立刻到期：加进来就是为了现在能复习它
      dueAt: initial.dueAt,
      state: initial.state,
    },
  });

  revalidatePath("/review");
  return { ok: true, message: "已加入复习队列。" };
}

/**
 * 评分。
 *
 * 这里刻意**不用 FormData**，而是直接收参数：复习是一个连续的会话，
 * 每评一张就要立刻切到下一张，走表单提交会多出一次构造 FormData 的仪式，
 * 而且客户端需要知道"提交完成了"才能前进 —— 直接 await 一个 Promise 更自然。
 * （创建与删除仍走 FormData，因为它们本来就在表单里。）
 */
export async function gradeCard(cardId: string, rawGrade: string): Promise<void> {
  const session = await requireSession();
  if (!session) return;

  if (!cardId) return;
  if (!GRADES.includes(rawGrade as Grade)) return;
  const grade = rawGrade as Grade;

  const userId = session.user.id;

  const card = await prisma.reviewCard.findFirst({
    where: { id: cardId, userId },
    select: { id: true, ease: true, interval: true, reps: true, lapses: true },
  });
  // 读不到就静默返回：不泄露"这张卡存在但不属于你"
  if (!card) return;

  const now = new Date();
  const next = schedule(card, grade, now);

  /*
    调度状态与复习日志必须一起写。
    只更新卡片会丢掉"这次评了多少分"的历史 —— 而那正是将来调参
    （比如判断易记因子是不是该换一套初始值）唯一的数据来源。
  */
  await prisma.$transaction(async (tx) => {
    await tx.reviewCard.updateMany({
      where: { id: cardId, userId },
      data: {
        ease: next.ease,
        interval: next.interval,
        reps: next.reps,
        lapses: next.lapses,
        dueAt: next.dueAt,
        state: next.state,
      },
    });

    await tx.reviewLog.create({
      data: {
        cardId,
        userId,
        grade,
        prevInterval: card.interval,
        nextInterval: next.interval,
        easeAfter: next.ease,
      },
    });
  });

  revalidatePath("/review");
}

export async function deleteCard(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!session) return;

  const cardId = String(formData.get("cardId") ?? "");
  if (!cardId) return;

  // deleteMany 才接受 userId 之外的过滤条件；日志由 schema 的级联一并清掉
  await prisma.reviewCard.deleteMany({ where: { id: cardId, userId: session.user.id } });
  revalidatePath("/review");
}
