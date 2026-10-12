"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { normalizeTaskStatus, nextTaskStatus } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

/**
 * 计划的写操作
 * ══════════════════════════════════════════════════════════════════
 *
 * 与待办同样的纪律：**每一条写操作的 where 里都必须有 userId。**
 * 计划任务还多一层 —— 它属于某个计划，而计划属于某个用户，
 * 所以要么带上 userId，要么先确认计划归属，不能只按 taskId 改。
 */

export type PlanState = { ok: true } | { ok: false; error: string } | null;

const MAX_NAME = 80;
const MAX_TITLE = 200;
const MAX_DOCUMENT = 20_000;

export async function createPlan(_prev: PlanState, formData: FormData): Promise<PlanState> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "登录状态已过期，请重新登录。" };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "给这个计划起个名字。" };
  if (name.length > MAX_NAME) return { ok: false, error: `名字太长了（上限 ${MAX_NAME} 字）。` };

  const goal = String(formData.get("goal") ?? "").trim() || null;
  const document = String(formData.get("document") ?? "").trim() || null;
  if (document && document.length > MAX_DOCUMENT) {
    return { ok: false, error: `文档太长了（上限 ${MAX_DOCUMENT} 字）。` };
  }

  const plan = await prisma.plan.create({
    data: { userId: session.user.id, name, goal, document },
    select: { id: true },
  });

  revalidatePath("/plans");
  // 建完直接进详情页 —— 建一个空计划然后让用户自己找过去是多余的一步
  redirect(`/plans/${plan.id}`);
}

/** 归属校验：计划 id 与 userId 一起查，查不到就当作不存在 */
async function ownedPlanId(userId: string, planId: string): Promise<string | null> {
  const plan = await prisma.plan.findFirst({
    where: { id: planId, userId },
    select: { id: true },
  });
  return plan?.id ?? null;
}

export async function addTask(_prev: PlanState, formData: FormData): Promise<PlanState> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "登录状态已过期，请重新登录。" };

  const planId = String(formData.get("planId") ?? "");
  const title = String(formData.get("title") ?? "").trim();

  if (!title) return { ok: false, error: "写点什么再添加。" };
  if (title.length > MAX_TITLE) return { ok: false, error: `太长了（上限 ${MAX_TITLE} 字）。` };

  // 计划不属于当前用户时静默失败：连"这个计划存在但不属于你"都不必告诉对方
  const owned = await ownedPlanId(session.user.id, planId);
  if (!owned) return { ok: false, error: "找不到这个计划。" };

  const rawDay = Number.parseInt(String(formData.get("dayNumber") ?? ""), 10);
  const dayNumber = Number.isInteger(rawDay) && rawDay > 0 ? rawDay : null;

  await prisma.planTask.create({
    data: { planId: owned, userId: session.user.id, title, dayNumber },
  });

  revalidatePath(`/plans/${owned}`);
  return { ok: true };
}

export async function cycleTaskStatus(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!session) return;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return;

  const userId = session.user.id;

  // 读时带上 userId：PlanTask 自身就有 userId，不必回查计划
  const task = await prisma.planTask.findFirst({
    where: { id: taskId, userId },
    select: { status: true, planId: true },
  });
  if (!task) return;

  const status = nextTaskStatus(task.status);

  await prisma.planTask.updateMany({
    where: { id: taskId, userId },
    data: {
      status,
      // 完成时间只在转到 done 时写入，退回其它状态要清掉 ——
      // 否则会出现"未完成却有完成时间"的自相矛盾数据
      completedAt: status === "done" ? new Date() : null,
    },
  });

  revalidatePath(`/plans/${task.planId}`);
}

export async function deleteTask(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!session) return;

  const taskId = String(formData.get("taskId") ?? "");
  if (!taskId) return;

  await prisma.planTask.deleteMany({ where: { id: taskId, userId: session.user.id } });
  revalidatePath("/plans");
}

/** 显式设置状态（用于"跳过"这类不在循环里的转换） */
export async function setTaskStatus(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!session) return;

  const taskId = String(formData.get("taskId") ?? "");
  const status = normalizeTaskStatus(String(formData.get("status") ?? ""));
  if (!taskId) return;

  const userId = session.user.id;
  const task = await prisma.planTask.findFirst({
    where: { id: taskId, userId },
    select: { planId: true },
  });
  if (!task) return;

  await prisma.planTask.updateMany({
    where: { id: taskId, userId },
    data: { status, completedAt: status === "done" ? new Date() : null },
  });

  revalidatePath(`/plans/${task.planId}`);
}

export async function setPlanStatus(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!session) return;

  const planId = String(formData.get("planId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!planId || !["active", "done", "archived"].includes(status)) return;

  await prisma.plan.updateMany({
    where: { id: planId, userId: session.user.id },
    data: { status },
  });

  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
}

export async function deletePlan(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!session) return;

  const planId = String(formData.get("planId") ?? "");
  if (!planId) return;

  // 计划下的任务由 schema 的 onDelete: Cascade 一并清掉
  await prisma.plan.deleteMany({ where: { id: planId, userId: session.user.id } });
  revalidatePath("/plans");
  redirect("/plans");
}
