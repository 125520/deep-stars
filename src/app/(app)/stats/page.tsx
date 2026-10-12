import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, CalendarDays, Flame, Sparkles, TrendingUp } from "lucide-react";

import ActivityHeatmap from "@/components/activity-heatmap";
import { Starfield } from "@/components/starfield";
import { Badge } from "@/components/ui/badge";
import { Card, Viewport } from "@/components/ui/card";
import { computeStreak, toLocalDayKey, totalHours } from "@/lib/constellation";
import {
  activeDays,
  addDays,
  buildHeatmap,
  longestStreak,
  mergeDayMinutes,
  startOfWeek,
  sumGrid,
} from "@/lib/heatmap";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "统计" };

export const dynamic = "force-dynamic";

/** 展示多少周。26 周 ≈ 半年，一屏放得下；53 周会撑出横向滚动 */
const WEEKS = 26;

export default async function StatsPage() {
  const session = await requireSession();
  if (!session) redirect("/login");

  const userId = session.user.id;
  const today = new Date();
  // 多取一周，保证网格第一列有完整数据
  const since = addDays(startOfWeek(today), -(WEEKS * 7 + 7));

  const [recordGroups, checkinGroups, stars] = await Promise.all([
    prisma.studyRecord.groupBy({
      by: ["date"],
      where: { userId, date: { gte: since } },
      _sum: { totalMinutes: true },
    }),
    prisma.checkin.groupBy({
      by: ["checkinDate"],
      where: { userId, checkinDate: { gte: since } },
      _sum: { hours: true },
    }),
    prisma.star.findMany({
      where: { userId, litAt: { gte: since } },
      select: { litAt: true },
    }),
  ]);

  /*
    按天聚合可以直接用 groupBy 精确时间戳 —— 这是"写入时统一折成当天零点"
    换来的好处：同一天的记录时间戳完全相同，于是 groupBy 天然就是按天分组。
    如果当初存的是真实时刻，这里就得先取出来再在 Node 里按日归并。
  */
  const timerMinutes = new Map<string, number>();
  for (const group of recordGroups) {
    timerMinutes.set(toLocalDayKey(group.date), group._sum.totalMinutes ?? 0);
  }

  const manualMinutes = new Map<string, number>();
  for (const group of checkinGroups) {
    manualMinutes.set(toLocalDayKey(group.checkinDate), (group._sum.hours ?? 0) * 60);
  }

  // 两个来源的合并规则（取较大者）在领域层，有测试覆盖
  const minutesByDay = mergeDayMinutes(timerMinutes, manualMinutes);

  const grid = buildHeatmap(minutesByDay, today, WEEKS);
  const todayKey = toLocalDayKey(today);

  const starDays = stars.map((s) => toLocalDayKey(s.litAt));
  const totalMinutes = sumGrid(grid);
  const active = activeDays(grid);

  const thisWeekStart = startOfWeek(today).getTime();
  const weekMinutes = [...minutesByDay.entries()]
    .filter(([key]) => {
      const [y, m, d] = key.split("-").map(Number);
      return new Date(y!, m! - 1, d!).getTime() >= thisWeekStart;
    })
    .reduce((sum, [, value]) => sum + value, 0);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10">
      <header className="mb-8">
        <Badge tone="violet">
          <TrendingUp className="size-3" />
          统计
        </Badge>
        <h1 className="mt-4 text-[26px] leading-[1.2] font-semibold tracking-[-0.015em] text-ink">
          近半年的轨迹
        </h1>
        <p className="mt-3 max-w-lg text-[14px] text-ink-muted text-pretty">
          每一格是一天。颜色越亮，那天投入得越多 —— 空白不代表失败，只是那天没记。
        </p>
        <Link
          href={`/report/${new Date().getFullYear()}`}
          className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-violet-300 transition-colors hover:text-violet-200"
        >
          <CalendarDays className="size-3.5" />
          看今年到目前为止的年度报告
        </Link>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={Activity} label="今天" value={Math.round(minutesByDay.get(todayKey) ?? 0)} unit="分钟" />
        <Stat icon={TrendingUp} label="本周" value={Math.round(weekMinutes)} unit="分钟" />
        <Stat
          icon={Flame}
          label="当前连续"
          value={computeStreak(starDays, todayKey)}
          unit="天"
        />
        <Stat icon={Sparkles} label="最长连续" value={longestStreak(starDays)} unit="天" />
      </div>

      <Viewport className="relative mb-6 px-6 py-7">
        <Starfield className="absolute inset-0" />
        <div className="relative">
          <ActivityHeatmap grid={grid} unit="分钟" />
        </div>
      </Viewport>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="px-5 py-4">
          <p className="text-[12px] text-ink-muted">累计专注</p>
          <p className="mt-2 text-[22px] leading-none font-semibold tracking-tight text-ink">
            {totalHours([totalMinutes / 60]).toFixed(1)}
            <span className="ml-1 text-[12px] font-normal text-ink-dim">小时</span>
          </p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-[12px] text-ink-muted">有记录的天数</p>
          <p className="mt-2 text-[22px] leading-none font-semibold tracking-tight text-ink">
            {active}
            <span className="ml-1 text-[12px] font-normal text-ink-dim">
              / {WEEKS * 7} 天
            </span>
          </p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-[12px] text-ink-muted">星图上的星</p>
          <p className="mt-2 text-[22px] leading-none font-semibold tracking-tight text-ink">
            {stars.length}
            <span className="ml-1 text-[12px] font-normal text-ink-dim">枚</span>
          </p>
        </Card>
      </div>
    </main>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  unit,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <Card className="px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
        <Icon className="size-3.5" strokeWidth={2} />
        {label}
      </div>
      <p className="mt-2 text-[20px] leading-none font-semibold tracking-tight text-ink tabular-nums">
        {value}
        <span className="ml-1 text-[11.5px] font-normal text-ink-dim">{unit}</span>
      </p>
    </Card>
  );
}
