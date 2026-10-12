import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Timer } from "lucide-react";

import FocusTimer from "@/components/focus-timer";
import { Starfield } from "@/components/starfield";
import { Badge } from "@/components/ui/badge";
import { Card, Viewport } from "@/components/ui/card";
import { startOfLocalDay, toLocalDayKey } from "@/lib/constellation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "深空专注" };

export const dynamic = "force-dynamic";

export default async function FocusPage() {
  const session = await requireSession();
  if (!session) redirect("/login");

  const userId = session.user.id;
  const today = startOfLocalDay();

  const [todayAgg, recent] = await Promise.all([
    // 用聚合而不是把今天的记录全捞回来：这个数字每完成一段就要刷新一次，
    // 走数据库求和比在 Node 里 reduce 更省内存也更快
    prisma.studyRecord.aggregate({
      where: { userId, date: today },
      _sum: { totalMinutes: true },
      _count: { _all: true },
    }),
    prisma.studyRecord.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, totalMinutes: true, subject: true, date: true },
    }),
  ]);

  const todayMinutes = Math.round(todayAgg._sum.totalMinutes ?? 0);
  const todayCount = todayAgg._count._all;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <header className="mb-8">
        <Badge tone="violet">
          <Timer className="size-3" />
          深空专注
        </Badge>
        <h1 className="mt-4 text-[26px] leading-[1.2] font-semibold tracking-[-0.015em] text-ink">
          把这段时间交给一件事
        </h1>
        <p className="mt-3 max-w-lg text-[14px] text-ink-muted text-pretty">
          计时在浏览器里跑，剩余时间按真实时间推算 —— 中途切去别的标签页也不会走慢。
          刷新页面也不会丢。
        </p>
      </header>

      <Viewport className="relative mb-6 px-6 py-10">
        <Starfield className="absolute inset-0" />
        <div className="relative">
          <FocusTimer />
        </div>
      </Viewport>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="px-6 py-5">
          <p className="text-[12px] text-ink-muted">今天的专注</p>
          <p className="mt-2 text-[26px] leading-none font-semibold tracking-tight text-ink">
            {todayMinutes}
            <span className="ml-1.5 text-[12px] font-normal text-ink-dim">分钟</span>
          </p>
          <p className="mt-2 text-[12px] text-ink-dim">
            {todayCount > 0 ? `共 ${todayCount} 段` : "还没有记录"}
          </p>
        </Card>

        <Card className="px-6 py-5">
          <p className="mb-3 text-[12px] text-ink-muted">最近几段</p>
          {recent.length === 0 ? (
            <p className="text-[13px] text-ink-dim">完成第一段之后会出现在这里。</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {recent.slice(0, 4).map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="truncate text-ink-muted">
                    {r.subject ?? "未命名"} · {toLocalDayKey(r.date)}
                  </span>
                  <span className="shrink-0 text-ink-dim tabular-nums">
                    {Math.round(r.totalMinutes)} 分
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}
