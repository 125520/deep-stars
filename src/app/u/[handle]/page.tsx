import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Flame, Sparkles, Timer, TrendingUp } from "lucide-react";

import ActivityHeatmap from "@/components/activity-heatmap";
import { ConstellationMap, MAP_VIEW_SIZE, type StarPoint } from "@/components/constellation-map";
import { Starfield } from "@/components/starfield";
import { Card, Viewport } from "@/components/ui/card";
import { computeStreak, toLocalDayKey } from "@/lib/constellation";
import { buildHeatmap, longestStreak, mergeDayMinutes, startOfWeek } from "@/lib/heatmap";
import { normalizeHandle } from "@/lib/handle";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const WEEKS = 26;

/**
 * 公开主页
 * ══════════════════════════════════════════════════════════════════
 *
 * ── 隐私边界（这是本页最重要的一段）────────────────────────────
 *
 * **星图是公开的，笔记不是。**
 *
 * 这一页只暴露三类信息：
 *   · 星图的形状（星点坐标与星等）—— 那是"出现过的次数与分量"的可视化
 *   · 聚合统计（总星数、连续天数、累计时长）
 *   · 每天投入的分钟数（热力图）
 *
 * **绝不暴露**：邮箱、打卡正文、卡点记录、心情、计划与任务、待办。
 * 打卡正文是用户写给自己的东西，公开主页不是它的出口。
 *
 * 所以下面所有查询都用 `select` 逐字段挑，没有一处 `include` 全表 ——
 * 将来 schema 加了敏感列，这里也不会自动泄露出去。
 */

async function findPublicUser(rawHandle: string) {
  const handle = normalizeHandle(rawHandle);
  if (!handle) return null;

  return prisma.user.findFirst({
    // isPublic 必须一起查：不公开的用户与不存在的用户**对外应当无法区分**
    where: { handle, isPublic: true, banned: false },
    select: {
      id: true,
      name: true,
      bio: true,
      image: true,
      handle: true,
      createdAt: true,
    },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const user = await findPublicUser(handle).catch(() => null);
  if (!user) return { title: "找不到这个主页" };

  const title = `${user.name} 的星图`;
  const description = user.bio ?? `${user.name} 的学习星图。`;

  return {
    title,
    description,
    // 复制的是"通过链接分享"，不是"被搜索引擎收录" —— 两者预期不同，
    // 文案里写的是前者，行为就应当与文案一致
    robots: { index: false, follow: false },
    openGraph: { title, description, type: "profile" },
  };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const user = await findPublicUser(handle);
  if (!user) notFound();

  const userId = user.id;
  const today = new Date();
  const since = startOfWeek(today);
  since.setDate(since.getDate() - (WEEKS * 7 + 7));

  const [constellation, hoursGroups, stars] = await Promise.all([
    prisma.constellation.findFirst({
      where: { userId, archived: false },
      orderBy: { createdAt: "asc" },
      select: {
        stars: {
          orderBy: { litAt: "asc" },
          select: { id: true, x: true, y: true, magnitude: true, prevStarId: true },
        },
      },
    }),
    // 只取时长与日期：**不取 content / blocker / mood**
    prisma.checkin.groupBy({
      by: ["checkinDate"],
      where: { userId, checkinDate: { gte: since } },
      _sum: { hours: true },
    }),
    prisma.star.findMany({
      where: { userId },
      select: { litAt: true },
    }),
  ]);

  const starRows = constellation?.stars ?? [];

  // 近半年的热力图走的是打卡时长（访客看不到番茄钟的明细，聚合口径保持一致即可）
  const manualMinutes = new Map<string, number>();
  for (const group of hoursGroups) {
    manualMinutes.set(toLocalDayKey(group.checkinDate), (group._sum.hours ?? 0) * 60);
  }
  const grid = buildHeatmap(mergeDayMinutes(new Map(), manualMinutes), today, WEEKS);

  // 同仪表盘：数据库存的是归一化坐标（0..1），星图的坐标空间是 0..MAP_VIEW_SIZE。
  // 漏掉这个乘法会让所有星点挤在左上角一个像素里，星图看起来一片空白。
  const starPoints: StarPoint[] = starRows.map((s) => ({
    id: s.id,
    x: s.x * MAP_VIEW_SIZE,
    y: s.y * MAP_VIEW_SIZE,
    magnitude: s.magnitude,
  }));

  const links: Array<[string, string]> = starRows
    .filter((s): s is typeof s & { prevStarId: string } => s.prevStarId !== null)
    .map((s) => [s.prevStarId, s.id]);

  const todayKey = toLocalDayKey(today);
  const starDays = stars.map((s) => toLocalDayKey(s.litAt));
  const totalMin = [...manualMinutes.values()].reduce((sum, n) => sum + n, 0);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-12">
      <header className="mb-8">
        <div className="flex items-start gap-4">
          {user.image ? (
            // 头像存的是 data URL（见 schema 注释：零对象存储）
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.image}
              alt=""
              className="size-14 shrink-0 rounded-2xl object-cover ring-1 ring-line-2"
            />
          ) : (
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-violet-600/20 ring-1 ring-violet-400/30">
              <Sparkles className="size-6 text-violet-300" strokeWidth={2} />
            </span>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.015em] text-ink text-balance">
              {user.name}
            </h1>
            <p className="mt-1.5 text-[12.5px] text-ink-dim">@{user.handle}</p>
            {user.bio && (
              <p className="mt-3 text-[14px] leading-relaxed text-ink-muted text-pretty">
                {user.bio}
              </p>
            )}
          </div>
        </div>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={Sparkles} label="星图" value={starRows.length} unit="枚星" />
        <Stat icon={Flame} label="当前连续" value={computeStreak(starDays, todayKey)} unit="天" />
        <Stat icon={TrendingUp} label="最长连续" value={longestStreak(starDays)} unit="天" />
        <Stat
          icon={Timer}
          label="近半年专注"
          value={Math.round(totalMin / 60)}
          unit="小时"
        />
      </div>

      <Viewport className="relative mb-6 min-h-[340px]">
        {/*
          背景星野压暗到 35% —— 它和「用户的星」都是画点，全对比度会把用户
          那几颗彻底盖住。同一个问题在观测台上早先修过，这里当时漏了。
        */}
        <Starfield className="absolute inset-0 opacity-35" />
        {starPoints.length > 0 ? (
          <ConstellationMap
            stars={starPoints}
            links={links}
            className="absolute inset-0"
            /* 与观测台一致：最新点亮的那一枚给最大的那圈十字光芒。
               星点按 litAt 升序取，所以最后一枚就是最新的。 */
            highlightId={starPoints[starPoints.length - 1]?.id}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <p className="ds-on-deep-muted text-[13px]">这片星图还是空的。</p>
          </div>
        )}
      </Viewport>

      <Viewport className="relative px-6 py-7">
        <Starfield className="absolute inset-0" />
        <div className="relative">
          <ActivityHeatmap grid={grid} unit="分钟" />
        </div>
      </Viewport>

      <footer className="mt-10 flex flex-col items-center gap-3 text-center">
        <p className="text-[12px] text-ink-dim">
          这是公开主页，只展示星图与统计 —— 打卡内容不会出现在这里。
        </p>
        <Link href="/" className="text-[12.5px] text-violet-300 transition-colors hover:text-violet-200">
          也想画一张自己的星图 →
        </Link>
      </footer>
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
