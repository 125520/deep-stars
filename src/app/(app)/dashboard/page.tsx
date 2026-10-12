import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Flame, Sparkles, Timer } from "lucide-react";

import CheckinForm from "@/components/checkin-form";
import CoachCard from "@/components/coach-card";
import { ConstellationMap, MAP_VIEW_SIZE, type StarPoint } from "@/components/constellation-map";
import ComplexitySwitch from "@/components/complexity-switch";
import ConstellationPicker from "@/components/constellation-picker";
import OnboardingCard from "@/components/onboarding-card";
import { Starfield } from "@/components/starfield";
import { Badge } from "@/components/ui/badge";
import { Card, Viewport } from "@/components/ui/card";
import { pickCoachMessage, type CoachContext } from "@/lib/coach";
import { computeStreak, constellationProgress, toLocalDayKey, totalHours } from "@/lib/constellation";
import { syncNotifications } from "@/lib/notifications-server";
import { isNewUser, parseTasksFromDocument } from "@/lib/onboarding";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { ZODIAC_SIGNS } from "@/lib/zodiac";
import { ornatePattern, patternFor, type ZodiacComplexity } from "@/lib/zodiac-ornate";

export const metadata: Metadata = { title: "观测台" };

/** 这一页每次都读会话与数据库，不能被静态化 */
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  /*
    这里用 requireSession 而不是 readSession：
    观测台是**受保护页面**，读不出会话必须去登录，
    绝不能因为数据库故障而把用户当成未登录、静默地踢回登录页 ——
    那样用户会以为是自己没登录，反复尝试。
  */
  const session = await requireSession();
  if (!session) redirect("/login");

  const userId = session.user.id;

  /*
    惰性生成当天的通知。**幂等**：同一天同类型只会写一条
    （规则在 lib/notifications.ts，有测试覆盖），所以开发模式下
    React 渲染两次、用户反复刷新，都不会产生重复通知。
  */
  await syncNotifications();

  const [constellation, recent, litDays, activePlans, reviewDue] = await Promise.all([
    prisma.constellation.findFirst({
      where: { userId, archived: false },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        // 这两个决定星图用哪套模板、以及"画满了没有"
        sign: true,
        complexity: true,
        completedAt: true,
        stars: {
          orderBy: { litAt: "asc" },
          select: { id: true, x: true, y: true, magnitude: true, prevStarId: true },
        },
      },
    }),
    prisma.checkin.findMany({
      where: { userId },
      orderBy: { checkinDate: "desc" },
      take: 8,
      select: {
        id: true,
        content: true,
        hours: true,
        subject: true,
        checkinDate: true,
        star: { select: { magnitude: true } },
      },
    }),
    // 只取日期用于算连续天数。星数增长后这里会变重，
    // 到那时换成按天分组的聚合查询。
    prisma.star.findMany({ where: { userId }, select: { litAt: true } }),
    // 主动教练要判断"计划是不是停了"：需要每个未完成计划的最近完成时刻
    prisma.plan.findMany({
      where: { userId, status: "active" },
      select: {
        name: true,
        tasks: { select: { status: true, completedAt: true } },
      },
    }),
    // 到期复习卡数量
    prisma.reviewCard.count({
      where: { userId, state: { not: "suspended" }, dueAt: { lte: new Date() } },
    }),
  ]);

  /*
    新用户引导的判据：星图空着、也没有任何计划。
    没有 `onboarded` 字段 —— "有没有留下痕迹"本身就是最准的判据，
    用户一旦点亮一枚星或建一个计划，引导自己就消失了。
  */
  const newUser = isNewUser({ starCount: litDays.length, planCount: activePlans.length });

  // 只有新用户才需要模板列表，别让老用户白付一次查询
  const templates = newUser
    ? await prisma.planTemplate.findMany({
        select: { id: true, name: true, description: true, document: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const stars = constellation?.stars ?? [];

  /*
    这个星座用的是哪套模板、画到第几枚了。
    sign 为空（早期数据、或用户没填生日）时 pattern 为 null，
    进度会返回 total 0 —— 那种情况下不显示进度、也不给换星座的入口，
    与加模板之前的行为一致。
  */
  const constellationSign = constellation?.sign
    ? (ZODIAC_SIGNS.find((s) => s.key === constellation.sign) ?? null)
    : null;
  const constellationPattern = constellationSign
    ? patternFor(constellationSign, constellation?.complexity)
    : null;
  const constellationState = constellationProgress(constellationPattern, stars.length);

  /*
    这个星座实际有哪几档可选。
    简约与完整永远给；后一档只在「点数确实比前一档多」时才出现 ——
    否则点了等于没变，那种按钮比没有还糟。
  */
  const availableComplexities: ZodiacComplexity[] = constellationSign
    ? [
        "simple",
        ...(constellationSign.full.stars.length > constellationSign.simple.stars.length
          ? (["full"] as const)
          : []),
        ...(ornatePattern(constellationSign).stars.length > constellationSign.full.stars.length
          ? (["ornate"] as const)
          : []),
      ]
    : [];

  /*
    ⚠️ 必须乘 MAP_VIEW_SIZE：数据库里存的是**归一化坐标（0..1）**，
    而星图的 viewBox 是 0..400。不加这一步，所有星点会挤在左上角一个像素里 ——
    线上反馈「点亮第一枚星看不出变化」的真正原因就是这个。
  */
  const starPoints: StarPoint[] = stars.map((s) => ({
    id: s.id,
    x: s.x * MAP_VIEW_SIZE,
    y: s.y * MAP_VIEW_SIZE,
    magnitude: s.magnitude,
  }));

  // 连线指向"上一枚"，转成 [起点, 终点] 给星图组件
  const links: Array<[string, string]> = stars
    .filter((s): s is typeof s & { prevStarId: string } => s.prevStarId !== null)
    .map((s) => [s.prevStarId, s.id]);

  const today = toLocalDayKey(new Date());
  const streak = computeStreak(
    litDays.map((s) => toLocalDayKey(s.litAt)),
    today,
  );
  const hours = totalHours(recent.map((c) => c.hours));

  /*
    今天那条教练通知。它可能已经被用户自己的 AI 改写过了
    （见 lib/notifications-server.ts），所以卡片优先显示它 ——
    否则同一句建议会在卡片和通知里出现两种说法，
    用户还会以为付费换来的改写根本没生效。
  */
  const todayCoach = await prisma.notification.findFirst({
    where: {
      userId,
      type: "coach",
      createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) },
    },
    orderBy: { createdAt: "desc" },
    select: { title: true, content: true },
  });

  const coachContext: CoachContext = {
    now: new Date(),
    checkinDays: litDays.map((s) => toLocalDayKey(s.litAt)),
    plans: activePlans.map((plan) => {
      const done = plan.tasks.filter((t) => t.status === "done" && t.completedAt);
      const latest = done.reduce<Date | null>((acc, t) => {
        const at = t.completedAt!;
        return acc === null || at > acc ? at : acc;
      }, null);
      return {
        name: plan.name,
        lastDoneAt: latest,
        openTasks: plan.tasks.filter((t) => t.status === "pending" || t.status === "doing").length,
      };
    }),
    reviewDue,
  };

  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-10">
      <header className="mb-8">
        <Badge tone="violet">
          <Sparkles className="size-3" />
          观测台
        </Badge>
        <h1 className="mt-4 text-[28px] leading-[1.2] font-semibold tracking-[-0.015em] text-ink">
          {session.user.name}，今晚从这里开始
        </h1>
        <p className="mt-3 max-w-xl text-[14px] text-ink-muted text-pretty">
          每记录一次，星图上就多一枚星。连续的日子会自动连成星座。
        </p>
      </header>

      {/* 三枚指标 */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat icon={Flame} label="连续" value={streak} unit="天" />
        <Stat icon={Sparkles} label="星图" value={stars.length} unit="枚星" />
        <Stat icon={Timer} label="近期专注" value={Math.round(hours * 10) / 10} unit="小时" />
      </div>

      {/* 没有值得说的话时它自己返回 null，不占位置 */}
      <div className="mb-6">
        <CoachCard
          context={coachContext}
          // 只在标题一致时采用通知里的正文 —— 否则会出现标题说断签、正文说复习的矛盾
          body={
            todayCoach && todayCoach.title === pickCoachMessage(coachContext)?.title
              ? todayCoach.content
              : null
          }
        />
      </div>

      {/* 只有星图空着且没有计划时才出现。留下任何痕迹它就自己消失 */}
      {newUser && (
        <div className="mb-6">
          <OnboardingCard
            templates={templates.map((template) => ({
              id: template.id,
              name: template.name,
              description: template.description,
              taskCount: parseTasksFromDocument(template.document).length,
            }))}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <Card className="h-fit px-6 py-7">
          <h2 className="text-[16px] font-semibold tracking-tight text-ink">点亮今天的星</h2>
          <p className="mt-1.5 mb-6 text-[13px] text-ink-muted">
            专注时长决定星等 —— 星越亮，那一枚在星图上越大。
          </p>
          <CheckinForm />
        </Card>

        <div className="flex flex-col gap-6">
          {/*
            ⚠️ 面板**必须是方的**，这是「星图看不出变化」的主因。
            星图内容按 400×400 的正方形视图缩放（preserveAspectRatio="meet"）。
            面板原先是很扁的（实测 666×318），于是正方形内容只占中间 318×318，
            两侧各空出 170 多像素 —— 星座缩在中间一小块，看起来几乎什么都没有。
            改成正方形后内容铺满整个面板。
          */}
          <Viewport className="relative mx-auto aspect-square w-full max-w-[560px]">
            {/*
              ⚠️ 背景星野**必须压暗**，而且只在星图面板里压。
              它和「你的星」都是画点 —— 装饰星野画了几百颗，全对比度会
              把用户自己那几颗彻底盖住。线上反馈「点亮第一枚星看不出变化」
              有一半原因在这里（另一半是星点半径太小，见 constellation-map.tsx）。
            */}
            <Starfield className="absolute inset-0 opacity-35" />
            {starPoints.length > 0 ? (
              <ConstellationMap
                stars={starPoints}
                links={links}
                className="absolute inset-0"
                animate
                /* 星点按 litAt 升序取，所以最后一枚就是最新点亮的那一枚 —— 给它十字光芒 */
                highlightId={starPoints[starPoints.length - 1]?.id}
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center px-8 text-center">
                <p className="ds-on-deep-muted text-[13px] leading-relaxed">
                  星图还是空的。
                  <br />
                  点亮第一枚星，这里就会亮起来。
                </p>
              </div>
            )}
            {constellation && stars.length > 0 && (
              <div className="absolute bottom-4 left-5 text-[12px] ds-on-deep-muted">
                {constellation.name}
                {constellationState.total > 0
                  ? ` · ${stars.length}/${constellationState.total} 枚星`
                  : ` · ${stars.length} 枚星`}
                {constellationState.complete && " · 已画满"}
              </div>
            )}
          </Viewport>

          {constellation && availableComplexities.length > 1 && (
            <ComplexitySwitch
              current={
                (constellation.complexity === "ornate" || constellation.complexity === "simple"
                  ? constellation.complexity
                  : "full") as ZodiacComplexity
              }
              signName={constellation.name}
              available={availableComplexities}
            />
          )}

          {constellation && (
            <ConstellationPicker
              currentName={constellation.name}
              currentSign={constellation.sign}
              lit={constellationState.lit}
              total={constellationState.total}
              complete={constellationState.complete}
            />
          )}

          <Card className="px-6 py-5">
            <h2 className="mb-4 text-[14px] font-semibold tracking-tight text-ink">最近的记录</h2>
            {recent.length === 0 ? (
              <p className="text-[13px] text-ink-muted">还没有记录。</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {recent.map((c) => (
                  <li key={c.id} className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 size-2 shrink-0 rounded-full bg-violet-400"
                      style={{ opacity: 0.35 + (c.star?.magnitude ?? 0.3) * 0.65 }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-ink">{c.content}</p>
                      <p className="mt-0.5 text-[11.5px] text-ink-dim">
                        {toLocalDayKey(c.checkinDate)}
                        {c.subject ? ` · ${c.subject}` : ""}
                        {c.hours > 0 ? ` · ${c.hours}h` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
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
    <Card className="px-5 py-4">
      <div className="flex items-center gap-2 text-[12px] text-ink-muted">
        <Icon className="size-3.5" strokeWidth={2} />
        {label}
      </div>
      <p className="mt-2 text-[22px] leading-none font-semibold tracking-tight text-ink">
        {value}
        <span className="ml-1 text-[12px] font-normal text-ink-dim">{unit}</span>
      </p>
    </Card>
  );
}
