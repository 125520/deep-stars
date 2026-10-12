import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Bot,
  CalendarCheck,
  Download,
  Layers,
  MessagesSquare,
  Repeat2,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Target,
  Timer,
  TrendingUp,
  Trophy,
} from "lucide-react";

import { ConstellationMap, demoConstellation } from "@/components/constellation-map";
import { FeatureCarousel } from "@/components/feature-carousel";
import { FeatureRow } from "@/components/feature-row";
import { GithubMark } from "@/components/icons/github-mark";
import { Starfield } from "@/components/starfield";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Viewport } from "@/components/ui/card";
import { FeatureCard } from "@/components/ui/feature-card";

const CORE_FEATURES = [
  {
    icon: CalendarCheck,
    title: "星座打卡",
    desc: "每日点亮一枚星，星等由专注时长与当天状态决定；连续天数自动连成星座。",
  },
  {
    icon: Target,
    title: "星图计划",
    desc: "任务制进度，计划与打卡三方联动。AI 可按计划文档拆解成可执行清单。",
  },
  {
    icon: Timer,
    title: "深空专注",
    desc: "番茄钟与沉浸模式，完成即写入观测记录；离线也能打卡，联网自动同步。",
  },
  {
    icon: Bot,
    title: "观测台 · AI",
    desc: "分析你的星图生成个性化计划，长期记忆偏好，每日推送一份观测简报。",
    ai: true,
  },
  {
    icon: BookOpen,
    title: "知识星云",
    desc: "上传 md / pdf / docx 建立私人知识库，向量检索后基于你的资料回答。",
    ai: true,
  },
  {
    icon: MessagesSquare,
    title: "实时频道",
    desc: "引用回复、@AI 流式应答、在线人数实时同步；断线自动重连不丢消息。",
  },
] as const;

const BOOSTS = [
  {
    icon: Repeat2,
    title: "间隔重复复习",
    desc: "SM-2 算法把知识点排进复习队列，到期自动提醒 —— 让「记录」真正变成「记住」。",
  },
  {
    icon: Trophy,
    title: "年度星图报告",
    desc: "一整年的专注轨迹汇成一页可分享的报告图，总时长与最亮的月份一目了然。",
  },
  {
    icon: Share2,
    title: "公开分享页",
    desc: "可选地把星图开放成只读页面，任何人可访问；原始笔记永不外露。",
  },
  {
    icon: Download,
    title: "数据完全属于你",
    desc: "JSON / CSV / Markdown 一键导出与导入，随时带走，不做平台锁定。",
  },
] as const;

/**
 * 工程品质。
 *
 * 刻意拆成「标题 + 描述」而不是一行用间隔号连起来的长标签 ——
 * 这样才能填进与上面完全相同的卡片解剖。此前这里是
 * `{ icon, label }` 的内联小标签，与其余区块的卡片毫无共同点，
 * 是页面割裂感的主要来源。
 */
const ENGINEERING = [
  {
    icon: Smartphone,
    title: "PWA 离线可用",
    desc: "可装到桌面，断网也能打卡，恢复联网后自动同步。",
  },
  {
    icon: Star,
    title: "真实星等配色",
    desc: "按恒星光谱分类上色，从蓝白到红橙，接近真实夜空。",
  },
  {
    icon: ShieldCheck,
    title: "安全加固",
    desc: "接口限流、每日 AI 配额、Markdown 渲染 XSS 白名单。",
  },
  {
    icon: Layers,
    title: "零外部依赖",
    desc: "不需要 Docker 与数据库服务，两条命令即可自部署。",
  },
] as const;

export default function LandingPage() {
  const { stars, links } = demoConstellation();

  return (
    <>
      {/* ══════════ 顶部导航 ══════════ */}
      <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/80 backdrop-blur-xl">
        <nav className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-3">
          <Link href="/" className="ds-pop flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-[10px] bg-violet-600 shadow-[0_6px_16px_-6px_var(--color-violet-600)]">
              <Sparkles className="size-4 text-white" strokeWidth={2.2} />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-ink">
              Deep <span className="text-violet-600">Stars</span>
            </span>
          </Link>

          {/*
            导航里不再出现「核心能力 / 增强特性 / 工程品质」这类词 ——
            它们是**我们对内的工作分块**，不是对用户的表达，
            并且各区块的标题已经把意思说清楚了，再挂一遍只是重复。
          */}

          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden sm:block">
              <Button variant="ghost" size="sm">
                登录
              </Button>
            </Link>
            <Link href="/register" className="whitespace-nowrap">
              <Button size="sm">
                开始观测
                <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        {/* ══════════ Hero ══════════ */}
        <section className="mx-auto w-full max-w-7xl px-5 pt-14 pb-16 sm:pt-20">
          <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.02fr]">
            {/* 左：文案 */}
            <div className="ds-anim-rise min-w-0">
              <Badge tone="violet" className="mb-5">
                <Sparkles className="size-3" />
                深空观测台 · v3.2
              </Badge>

              {/*
                中文标题排版：行高不低于 1.15（汉字字面撑满 em 框，
                照搬拉丁字母的 1.0～1.1 会让上下两行视觉粘连）；
                字距压到 -0.01em 只为收紧标点。
              */}
              <h1 className="text-[40px] leading-[1.18] font-semibold tracking-[-0.015em] sm:text-[56px]">
                <span className="bg-gradient-to-r from-violet-700 via-violet-500 to-violet-400 bg-clip-text text-transparent">
                  把每一次专注
                </span>
                <br />
                <span className="text-ink">点成一枚星</span>
              </h1>

              <p className="mt-5 max-w-xl text-[15px] text-ink-muted sm:text-base">
                打卡点亮星点，连续天数连成星座，累计时长撑开整片星云。
                星图计划、深空专注、知识星云与 AI 观测员 ——
                你的所有学习轨迹，最终都落在同一张星图上。
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/register">
                  <Button size="lg">
                    开始观测
                    <ArrowRight className="size-4" />
                  </Button>
                </Link>
                <a href="#core">
                  <Button size="lg" variant="outline">
                    看看有什么
                  </Button>
                </a>
              </div>

              <div className="mt-9 flex flex-wrap gap-2.5">
                <span className="ds-chip">
                  <TrendingUp className="size-3.5 text-violet-600" />
                  连续 <b className="font-semibold text-ink">128</b> 天
                </span>
                <span className="ds-chip">
                  <Timer className="size-3.5 text-violet-600" />
                  累计 <b className="font-semibold text-ink">342</b> 小时
                </span>
                <span className="ds-chip">
                  <Star className="size-3.5 text-warn" />
                  最高星等 <b className="font-semibold text-ink">4.8</b>
                </span>
              </div>
            </div>

            {/* 右：观测窗 —— 全页唯一的深色区域 */}
            <div className="ds-anim-rise min-w-0 [animation-delay:120ms]">
              <Viewport className="relative mx-auto aspect-square w-full max-w-[520px]">
                <Starfield className="absolute inset-0" />

                <div className="absolute inset-0 p-7">
                  <ConstellationMap stars={stars} links={links} />
                </div>

                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 bg-gradient-to-t from-void/90 to-transparent p-5 pt-12">
                  <div className="min-w-0">
                    <p className="ds-on-deep text-[13px] font-medium">本周星座</p>
                    <p className="ds-on-deep-muted mt-0.5 text-[11px]">
                      12 枚星点 · 10 段连线 · 由近 30 天打卡生成
                    </p>
                  </div>
                  <Badge tone="deep" className="shrink-0">
                    示例数据
                  </Badge>
                </div>

                <div className="pointer-events-none absolute top-4 left-5 flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-star-o ds-anim-twinkle" />
                  <span className="ds-on-deep-muted font-mono text-[10.5px] tracking-wider">
                    LIVE · 观测中
                  </span>
                </div>
              </Viewport>
            </div>
          </div>
        </section>

        <div className="ds-hairline mx-auto max-w-7xl" />

        {/* ══════════ 核心能力 ══════════ */}
        <section id="core" className="mx-auto w-full max-w-7xl px-5 py-20">
          <SectionHeading
            title="一张星图，装下整个学习闭环"
            desc="从今天点亮一枚星，到年底回看整片星云 —— 记录、计划、专注、复习、协作，全在同一条链路上。"
          />

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CORE_FEATURES.map((f) => (
              <FeatureCard
                key={f.title}
                icon={f.icon}
                title={f.title}
                desc={f.desc}
                ai={"ai" in f && f.ai}
                // 每张卡片都通向注册 —— 未登录时点功能页也会被弹回登录，
                // 直接给注册入口更顺；已登录时注册页自己会送到观测台。
                href="/register"
              />
            ))}
          </div>
        </section>

        {/*
          增强特性 + 工程品质共用同一条底色带。

          合并成一个连续的深色区是有意的：两块各自带 border-y 会在中间压出
          双线，而且会把它们读成两个不相干的页面区块 —— 那正是要消除的割裂感。
          背景比页面底噪略深一档，牛奶白的展示牌才能从上面「浮」出来。
        */}
        <div className="border-y border-line/60 bg-surface-2/75">
          {/* ══════════ 增强特性 ══════════ */}
          <section id="boost" className="mx-auto w-full max-w-7xl px-5 py-20">
            <SectionHeading
              title="不止于打卡的四件事"
              desc="这些是同类项目里通常没有、但真正决定「能不能坚持用下去」的部分。"
            />

            {/* 四块展示牌横向层叠：互相遮掩 24px，投影落在邻块上 */}
            <FeatureRow items={BOOSTS.map((b) => ({ ...b, href: "/register" }))} />
          </section>

          {/* ══════════ 工程品质 ══════════ */}
          <section id="engineering" className="mx-auto w-full max-w-7xl px-5 pb-20">
            <SectionHeading
              title="任何人都能装上并自己跑起来"
              desc="不需要 Docker、不需要数据库服务、不需要 API Key —— 克隆下来两条命令就能用。填上 Key 之后 AI 能力自动启用。"
            />

            {/* 线路式横向循环轨道：四个模块挂在一条滚动的紫色线路上 */}
            <FeatureCarousel items={ENGINEERING.map((e) => ({ ...e, href: "/register" }))} />
          </section>
        </div>

        {/* ══════════ 底部 CTA ══════════ */}
        <section className="mx-auto w-full max-w-7xl px-5 pb-24">
          <Viewport className="relative overflow-hidden px-8 py-16 text-center sm:px-16">
            <Starfield className="absolute inset-0" />
            <div className="relative">
              <h2 className="ds-on-deep text-balance text-[26px] leading-[1.3] font-semibold tracking-[-0.015em] sm:text-[32px]">
                今晚，从点亮第一枚星开始
              </h2>
              <p className="ds-on-deep-muted mx-auto mt-4 max-w-md text-[14px] text-pretty">
                注册即可使用全部功能。AI 相关能力在没有配置密钥时会以本地规则引擎降级运行，不会影响使用。
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link href="/register">
                  <Button size="lg">
                    创建我的星图
                    <ArrowRight className="size-4" />
                  </Button>
                </Link>
                <a
                  href="https://github.com/125520/deep-stars"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex"
                >
                  <Button size="lg" variant="onDeep">
                    <GithubMark className="size-4" />
                    GitHub
                  </Button>
                </a>
              </div>
            </div>
          </Viewport>
        </section>
      </main>

      {/* ══════════ 页脚 ══════════ */}
      <footer className="border-t border-line/70 bg-canvas/60">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-3 px-5 py-7 text-[12px] text-ink-dim sm:flex-row">
          <p>Deep Stars · 深星 —— 把每一次专注，点成一枚星。</p>
          <p className="flex items-center gap-2">
            <span>MIT License</span>
            <span aria-hidden="true">·</span>
            <span>Next.js + Prisma</span>
          </p>
        </div>
      </footer>
    </>
  );
}

/**
 * 章节标题：只有标题与说明。
 *
 * 这里原本还有一个「核心能力 / 增强特性 / 工程品质」的小胶囊标，已移除 ——
 * 那是对内的工作分块（我们自己给自己划的任务边界），不是对用户的表达。
 * 成品页面不该让读者看到开发过程的分区方式。
 *
 * 标题左对齐：大段介绍文字居中会拖慢阅读，每行的起始位置随长度浮动，
 * 眼睛每次都要重新找行首。居中的只留给卡片里那种「标签级」的短名称。
 */
function SectionHeading({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-[26px] leading-[1.3] font-semibold tracking-[-0.015em] text-ink text-balance sm:text-[34px]">
        {title}
      </h2>
      <p className="mt-4 max-w-xl text-[14px] text-ink-muted text-pretty">{desc}</p>
    </div>
  );
}
