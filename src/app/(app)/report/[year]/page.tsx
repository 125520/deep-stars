import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarDays, Flame, Sparkles, Timer } from "lucide-react";

import ActivityHeatmap from "@/components/activity-heatmap";
import { Starfield } from "@/components/starfield";
import { Badge } from "@/components/ui/badge";
import { Card, Viewport } from "@/components/ui/card";
import { buildAnnualReport, availableYears, describeDay } from "@/lib/annual";
import { addDays, buildHeatmap, mergeDayMinutes, startOfWeek } from "@/lib/heatmap";
import { MONTH_LABELS } from "@/lib/heatmap";
import { toLocalDayKey } from "@/lib/constellation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ year: string }>;
}): Promise<Metadata> {
  const { year } = await params;
  return { title: `${year} 年度报告` };
}

export default async function AnnualReportPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const session = await requireSession();
  if (!session) redirect("/login");

  const { year: rawYear } = await params;
  const year = Number.parseInt(rawYear, 10);
  const currentYear = new Date().getFullYear();

  /*
    非法年份直接 404，而不是回退到今年 —— 静默回退会让分享出去的
    /report/abc 看起来是正常的，只是内容不对。

    未来年份同样 404：年份切换器（availableYears）刻意不列未来年份，
    如果 /report/2099 能打开，就出现了一个"界面到不了、但地址有效"的页面，
    而且它上面写着"这一年还没有留下记录"—— 可那一年根本还没到。
  */
  if (!Number.isInteger(year) || year < 2000 || year > currentYear) notFound();

  const userId = session.user.id;
  const rangeStart = new Date(year, 0, 1);
  const rangeEnd = new Date(year + 1, 0, 1);

  const [recordGroups, checkinGroups, allStars] = await Promise.all([
    prisma.studyRecord.groupBy({
      by: ["date"],
      where: { userId, date: { gte: rangeStart, lt: rangeEnd } },
      _sum: { totalMinutes: true },
    }),
    prisma.checkin.groupBy({
      by: ["checkinDate"],
      where: { userId, checkinDate: { gte: rangeStart, lt: rangeEnd } },
      _sum: { hours: true },
    }),
    // 全量取星的日期：年报要按年切换，年份列表只能从全量数据里推
    prisma.star.findMany({ where: { userId }, select: { litAt: true } }),
  ]);

  // 口径与统计页一致：两个来源取较大者，避免重复计数（见 lib/heatmap.ts）
  const timerMinutes = new Map<string, number>();
  for (const group of recordGroups) {
    timerMinutes.set(toLocalDayKey(group.date), group._sum.totalMinutes ?? 0);
  }
  const manualMinutes = new Map<string, number>();
  for (const group of checkinGroups) {
    manualMinutes.set(toLocalDayKey(group.checkinDate), (group._sum.hours ?? 0) * 60);
  }
  const minutesByDay = mergeDayMinutes(timerMinutes, manualMinutes);

  const starDays = allStars.map((s) => toLocalDayKey(s.litAt));
  const report = buildAnnualReport({ year, minutesByDay, starDays });
  const years = availableYears(starDays, new Date().getFullYear());

  // 年报里的热力图覆盖整年：从当年 1 月 1 日所在周开始，到 12 月 31 日所在周
  const weeks = Math.ceil(
    (addDays(startOfWeek(new Date(year, 11, 31)), 7).getTime() -
      startOfWeek(new Date(year, 0, 1)).getTime()) /
      (7 * 86_400_000),
  );
  const grid = buildHeatmap(minutesByDay, new Date(year, 11, 31), weeks);

  const peak = Math.max(...report.monthly, 1);
  const isCurrentYear = year === currentYear;

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <Link
          href="/stats"
          className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-3.5" />
          统计
        </Link>

        <div className="flex flex-wrap items-center gap-1.5">
          {years.map((y) => (
            <Link
              key={y}
              href={`/report/${y}`}
              className={
                y === year
                  ? "rounded-lg bg-violet-500/15 px-2.5 py-1 text-[12px] font-medium text-violet-200"
                  : "rounded-lg px-2.5 py-1 text-[12px] text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              }
            >
              {y}
            </Link>
          ))}
        </div>
      </div>

      <header className="mb-8">
        <Badge tone="violet">
          <CalendarDays className="size-3" />
          年度报告
        </Badge>
        <h1 className="mt-4 text-[34px] leading-[1.1] font-semibold tracking-[-0.02em] text-ink tabular-nums">
          {year}
          {isCurrentYear && <span className="ml-3 text-[15px] font-normal text-ink-dim">进行中</span>}
        </h1>
        <p className="mt-3 max-w-lg text-[14px] text-ink-muted text-pretty">
          {report.activeDays === 0
            ? "这一年还没有留下记录。"
            : `这一年你在 ${report.activeDays} 天里留下了痕迹，一共 ${report.totalHours} 小时。`}
        </p>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={Timer} label="累计专注" value={report.totalHours} unit="小时" />
        <Stat icon={CalendarDays} label="有记录" value={report.activeDays} unit="天" />
        <Stat icon={Flame} label="最长连续" value={report.longestStreak} unit="天" />
        <Stat icon={Sparkles} label="点亮" value={report.stars} unit="枚星" />
      </div>

      <Card className="mb-6 px-6 py-6">
        <h2 className="mb-5 text-[14px] font-semibold tracking-tight text-ink">十二个月</h2>
        {report.totalMinutes === 0 ? (
          <p className="text-[13px] text-ink-muted">还没有数据。</p>
        ) : (
          <ol className="flex h-40 items-end gap-1.5">
            {report.monthly.map((minutes, index) => (
              /*
                ⚠️ 柱子的百分比高度需要一个**高度确定**的父元素。
                最初把 `height: X%` 直接挂在 li 的子元素上，而 ol 用了 items-end ——
                align-items: flex-end 会让 li 不再被拉伸，li 高度塌成内容高度，
                于是百分比相对 auto 解析成 0：**12 根柱子一根都看不见**，
                而数据完全正确（单测全绿）。这类错误只有看截图才能发现。

                所以中间加一层 flex-1 的容器：它在 h-full 的 li 里拿到确定高度，
                柱子再相对它取百分比。
              */
              <li key={index} className="flex h-full flex-1 flex-col items-center gap-2">
                <div className="flex w-full flex-1 items-end">
                  <span
                    title={`${MONTH_LABELS[index]} · ${Math.round(minutes)} 分钟`}
                    className="w-full rounded-t-[4px] bg-violet-500/80 transition-[height] duration-500"
                    style={{
                      // 有数据的最矮 6%，没数据的留 2% 一条底线：
                      // 完全空着会让人以为图表没渲染出来
                      height: `${Math.max(minutes > 0 ? 6 : 2, (minutes / peak) * 100)}%`,
                    }}
                  />
                </div>
                <span className="text-[10px] text-ink-dim tabular-nums">{index + 1}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card className="px-6 py-5">
          <p className="text-[12px] text-ink-muted">投入最多的一个月</p>
          {report.bestMonth ? (
            <>
              <p className="mt-2 text-[22px] leading-none font-semibold tracking-tight text-ink">
                {report.bestMonth.label}
              </p>
              <p className="mt-2 text-[12px] text-ink-dim">
                {Math.round(report.bestMonth.minutes / 60)} 小时
              </p>
            </>
          ) : (
            <p className="mt-2 text-[13px] text-ink-dim">—</p>
          )}
        </Card>

        <Card className="px-6 py-5">
          <p className="text-[12px] text-ink-muted">最投入的一天</p>
          {report.bestDay ? (
            <>
              <p className="mt-2 text-[22px] leading-none font-semibold tracking-tight text-ink tabular-nums">
                {report.bestDay.key.slice(5)}
              </p>
              <p className="mt-2 text-[12px] text-ink-dim">
                {Math.round(report.bestDay.minutes)} 分钟 · {describeDay(report.bestDay.minutes)}
              </p>
            </>
          ) : (
            <p className="mt-2 text-[13px] text-ink-dim">—</p>
          )}
        </Card>
      </div>

      <Viewport className="relative px-6 py-7">
        <Starfield className="absolute inset-0" />
        <div className="relative">
          <ActivityHeatmap grid={grid} unit="分钟" />
        </div>
      </Viewport>

      {report.firstDay && report.lastDay && (
        <p className="mt-6 text-center text-[12px] text-ink-dim">
          从 {report.firstDay} 到 {report.lastDay}
        </p>
      )}
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
