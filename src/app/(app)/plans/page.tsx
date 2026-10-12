import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Target } from "lucide-react";

import PlanCreateForm from "@/components/plan-create-form";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { planProgress, progressSummary } from "@/lib/plans";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "星图计划" };

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const session = await requireSession();
  if (!session) redirect("/login");

  const plans = await prisma.plan.findMany({
    where: { userId: session.user.id, status: { not: "archived" } },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      name: true,
      goal: true,
      status: true,
      tasks: { select: { status: true } },
    },
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <header className="mb-8">
        <Badge tone="violet">
          <Target className="size-3" />
          星图计划
        </Badge>
        <h1 className="mt-4 text-[26px] leading-[1.2] font-semibold tracking-[-0.015em] text-ink">
          把一件长事拆成能做的步子
        </h1>
        <p className="mt-3 max-w-lg text-[14px] text-ink-muted text-pretty">
          计划负责「要做什么」，专注负责「现在做」。两者最终都会落在同一张星图上。
        </p>
      </header>

      <div className="mb-8">
        <PlanCreateForm />
      </div>

      {plans.length === 0 ? (
        <Card className="px-6 py-10 text-center">
          <p className="text-[13px] text-ink-muted">还没有计划。建一个，从第一项任务开始。</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {plans.map((plan) => {
            const progress = planProgress(plan.tasks);
            return (
              <li key={plan.id}>
                <Link href={`/plans/${plan.id}`} className="block">
                  <Card hover className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h2 className="truncate text-[15px] font-semibold tracking-tight text-ink">
                          {plan.name}
                        </h2>
                        {plan.goal && (
                          <p className="mt-1 truncate text-[12.5px] text-ink-muted">{plan.goal}</p>
                        )}
                      </div>
                      {plan.status === "done" && <Badge tone="neutral">已完成</Badge>}
                    </div>

                    <div className="mt-3.5 flex items-center gap-3">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <div
                          className="h-full rounded-full bg-violet-500 transition-[width] duration-500"
                          style={{ width: `${Math.round(progress.ratio * 100)}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-[11.5px] text-ink-dim tabular-nums">
                        {progressSummary(progress)}
                      </span>
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
