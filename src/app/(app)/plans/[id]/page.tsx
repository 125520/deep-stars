import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import PlanTaskList, { type PlanTaskItem } from "@/components/plan-task-list";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { deletePlan, setPlanStatus } from "@/lib/actions/plan";
import { groupTasksByDay, planProgress, progressSummary } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** 计划名会出现在标题里。查不到就交给 notFound()，不在这里静默兜底。 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const session = await requireSession();
  if (!session) return { title: "计划" };

  const { id } = await params;
  const plan = await prisma.plan.findFirst({
    where: { id, userId: session.user.id },
    select: { name: true },
  });
  return { title: plan?.name ?? "计划" };
}

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  if (!session) redirect("/login");

  const { id } = await params;

  /*
    用 findFirst + userId 而不是 findUnique({ where: { id } })：
    后者会返回别人的计划。查不到直接 notFound()——
    对访问者来说"不存在"和"不属于你"本来就应该是同一个结果。
  */
  const plan = await prisma.plan.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      name: true,
      goal: true,
      document: true,
      status: true,
      tasks: {
        orderBy: [{ dayNumber: "asc" }, { createdAt: "asc" }],
        select: { id: true, title: true, status: true, dayNumber: true },
      },
    },
  });

  if (!plan) notFound();

  const progress = planProgress(plan.tasks);
  const groups = groupTasksByDay<PlanTaskItem>(plan.tasks);

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <Link
        href="/plans"
        className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        全部计划
      </Link>

      <header className="mb-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.015em] text-ink text-balance">
              {plan.name}
            </h1>
            {plan.goal && <p className="mt-3 text-[14px] text-ink-muted text-pretty">{plan.goal}</p>}
          </div>
          {plan.status !== "active" && (
            <Badge tone="neutral">{plan.status === "done" ? "已完成" : "已归档"}</Badge>
          )}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-violet-500 transition-[width] duration-500"
              style={{ width: `${Math.round(progress.ratio * 100)}%` }}
            />
          </div>
          <span className="shrink-0 text-[12px] text-ink-dim tabular-nums">
            {Math.round(progress.ratio * 100)}%
          </span>
        </div>
        <p className="mt-2 text-[12px] text-ink-muted">{progressSummary(progress)}</p>
      </header>

      {plan.document && (
        <Card className="mb-6 px-6 py-5">
          <h2 className="mb-3 text-[12px] font-medium tracking-wide text-ink-dim">计划文档</h2>
          {/*
            这里**不渲染 Markdown**，原样按等宽文本显示。
            渲染 Markdown 需要清洗 HTML，而白名单一旦有疏漏就是 XSS ——
            那件事属于后面的「安全加固」，到那时再连同消毒一起做。
            现在用一个安全且诚实的方式：把原文显示出来。
          */}
          <pre className="max-h-72 overflow-auto text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-muted">
            {plan.document}
          </pre>
        </Card>
      )}

      <Card className="px-6 py-6">
        <h2 className="mb-5 text-[15px] font-semibold tracking-tight text-ink">任务</h2>
        <PlanTaskList planId={plan.id} groups={groups} />
      </Card>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <form action={setPlanStatus}>
          <input type="hidden" name="planId" value={plan.id} />
          <input type="hidden" name="status" value={plan.status === "done" ? "active" : "done"} />
          <button
            type="submit"
            className="rounded-lg border border-line-2 px-3.5 py-2 text-[12.5px] text-ink-muted transition-colors hover:border-violet-400 hover:text-ink"
          >
            {plan.status === "done" ? "标记为进行中" : "标记为已完成"}
          </button>
        </form>

        <form action={setPlanStatus}>
          <input type="hidden" name="planId" value={plan.id} />
          <input type="hidden" name="status" value="archived" />
          <button
            type="submit"
            className="rounded-lg border border-line-2 px-3.5 py-2 text-[12.5px] text-ink-muted transition-colors hover:border-violet-400 hover:text-ink"
          >
            归档
          </button>
        </form>

        <form action={deletePlan} className="ml-auto">
          <input type="hidden" name="planId" value={plan.id} />
          <button
            type="submit"
            className="rounded-lg px-3.5 py-2 text-[12.5px] text-ink-dim transition-colors hover:bg-danger/12 hover:text-danger"
          >
            删除计划
          </button>
        </form>
      </div>
    </main>
  );
}
