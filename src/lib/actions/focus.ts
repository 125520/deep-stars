"use server";

import { revalidatePath } from "next/cache";

import { startOfLocalDay } from "@/lib/constellation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

/**
 * 记录一段专注
 * ══════════════════════════════════════════════════════════════════
 *
 * 计时本身全在客户端（浏览器里跑），只有**完成时**才写一次库 ——
 * 番茄钟不需要每秒都往服务端发心跳，那样既费流量又毫无意义：
 * 中途关掉页面的那一段本来就不该计入。
 */

export type FocusState = { ok: true; minutes: number } | { ok: false; error: string } | null;

/** 与 focus.ts 的上限保持一致：单段最多 8 小时 */
const MAX_MINUTES = 8 * 60;
/** 低于这个时长不值得记一笔（多半是误触） */
const MIN_MINUTES = 0.5;

export async function recordFocus(_prev: FocusState, formData: FormData): Promise<FocusState> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "登录状态已过期，请重新登录。" };

  const raw = Number.parseFloat(String(formData.get("minutes") ?? ""));
  // 非法值按 0，随后被下限拦掉；不因为一个坏数字就整段丢失
  const minutes = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), MAX_MINUTES) : 0;

  if (minutes < MIN_MINUTES) {
    return { ok: false, error: "这段太短了，没有记录。" };
  }

  const subject = String(formData.get("subject") ?? "").trim() || null;

  await prisma.studyRecord.create({
    data: {
      userId: session.user.id,
      date: startOfLocalDay(String(formData.get("date") ?? "")),
      totalMinutes: minutes,
      subject,
      source: "pomodoro",
    },
  });

  revalidatePath("/focus");
  revalidatePath("/dashboard");
  return { ok: true, minutes };
}
