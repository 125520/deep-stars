import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Layers } from "lucide-react";

import ReviewSession, { type DueCard } from "@/components/review-session";
import { CardCreateForm, CardList } from "@/components/review-manage";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { describeInterval } from "@/lib/srs";

export const metadata: Metadata = { title: "复习" };

export const dynamic = "force-dynamic";

/** 一次会话最多放这么多张。太多会让人望而却步，反而不敢开始。 */
const SESSION_LIMIT = 20;

export default async function ReviewPage() {
  const session = await requireSession();
  if (!session) redirect("/login");

  const userId = session.user.id;
  const now = new Date();

  const [due, counts, recent] = await Promise.all([
    prisma.reviewCard.findMany({
      where: { userId, state: { not: "suspended" }, dueAt: { lte: now } },
      // 先复习最该复习的：按到期时间升序
      orderBy: { dueAt: "asc" },
      take: SESSION_LIMIT,
      select: {
        id: true,
        front: true,
        back: true,
        tags: true,
        ease: true,
        interval: true,
        reps: true,
        lapses: true,
      },
    }),
    prisma.reviewCard.groupBy({ by: ["state"], where: { userId }, _count: { _all: true } }),
    prisma.reviewCard.findMany({
      where: { userId },
      orderBy: { dueAt: "asc" },
      take: 12,
      select: { id: true, front: true, tags: true, dueAt: true, interval: true, reps: true },
    }),
  ]);

  const total = counts.reduce((sum, group) => sum + group._count._all, 0);
  const dueTotal = counts
    .filter((g) => g.state !== "suspended")
    .reduce((sum, group) => sum + group._count._all, 0);

  const cards: DueCard[] = due;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <header className="mb-8">
        <Badge tone="violet">
          <Layers className="size-3" />
          复习
        </Badge>
        <h1 className="mt-4 text-[26px] leading-[1.2] font-semibold tracking-[-0.015em] text-ink">
          在快要忘记的时候再见一次
        </h1>
        <p className="mt-3 max-w-lg text-[14px] text-ink-muted text-pretty">
          每张卡按你的评分安排下次出现的时间。答错的当天会再来一次，
          答对的间隔会越来越长 —— 直到它真正变成长期记忆。
        </p>
      </header>

      <Card className="mb-6 px-6 py-6">
        {due.length > 0 ? (
          <ReviewSession cards={cards} />
        ) : (
          <div className="py-10 text-center">
            <p className="text-[13px] text-ink-muted">
              {total === 0
                ? "还没有卡片。在下面加第一张。"
                : "现在没有到期的卡片，休息一下。"}
            </p>
            {total > 0 && (
              <p className="mt-2 text-[12px] text-ink-dim">
                队列里共 {dueTotal} 张，最近的会在{" "}
                {recent[0] ? describeInterval(daysUntil(recent[0].dueAt, now)) : "不久后"}到期
              </p>
            )}
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="px-6 py-6">
          <h2 className="mb-5 text-[15px] font-semibold tracking-tight text-ink">加一张卡</h2>
          <CardCreateForm />
        </Card>

        <Card className="px-6 py-6">
          <h2 className="mb-5 text-[15px] font-semibold tracking-tight text-ink">
            全部卡片 · {total}
          </h2>
          <CardList items={recent} />
        </Card>
      </div>
    </main>
  );
}

/** 距今天数（向上取整到至少 0）。跨月跨年交给 Date 构造器。 */
function daysUntil(dueAt: Date, now: Date): number {
  const days = Math.ceil((dueAt.getTime() - now.getTime()) / 86_400_000);
  return Math.max(0, days);
}
