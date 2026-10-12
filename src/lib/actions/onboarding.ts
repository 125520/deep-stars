"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parseTasksFromDocument } from "@/lib/onboarding";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

/**
 * 从模板创建一个计划
 * ══════════════════════════════════════════════════════════════════
 *
 * 模板表（`PlanTemplate`）由 `pnpm db:seed` 写入，但**之前没有任何地方读它** ——
 * 种进去的数据一直是死数据。这个动作把它接通：
 * 复制模板的正文，并按文档里的列表项生成任务。
 *
 * 刻意**复制而不是引用**：用户拿到计划之后会改它（改名字、删任务、加自己的内容），
 * 引用同一份模板会让所有用户的计划跟着模板一起变。
 */

export type OnboardingState = { ok: true } | { ok: false; error: string } | null;

export async function usePlanTemplate(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "登录状态已过期，请重新登录。" };

  const templateId = String(formData.get("templateId") ?? "");
  if (!templateId) return { ok: false, error: "没有选择模板。" };

  const template = await prisma.planTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, name: true, goal: true, document: true },
  });
  // 模板是全站共用的，不属于任何用户，所以这里不需要按 userId 过滤；
  // 但也因此**不能**让模板内容成为用户数据的一部分 —— 下面全部是复制。
  if (!template) return { ok: false, error: "这个模板不存在了。" };

  const userId = session.user.id;
  const tasks = parseTasksFromDocument(template.document);

  const plan = await prisma.$transaction(async (tx) => {
    const created = await tx.plan.create({
      data: {
        userId,
        name: template.name,
        goal: template.goal,
        document: template.document,
      },
      select: { id: true },
    });

    if (tasks.length > 0) {
      await tx.planTask.createMany({
        data: tasks.map((task) => ({
          planId: created.id,
          userId,
          title: task.title,
          dayNumber: task.dayNumber,
        })),
      });
    }

    return created;
  });

  revalidatePath("/plans");
  revalidatePath("/dashboard");
  // 建完直接进详情页 —— 让用户看到"任务已经拆好了"才算把这件事做完
  redirect(`/plans/${plan.id}`);
}
