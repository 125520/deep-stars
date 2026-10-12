import type { ComponentType, CSSProperties } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { IconTile } from "@/components/ui/icon-tile";
import { cn } from "@/lib/utils";

/**
 * 统一功能卡片
 * ══════════════════════════════════════════════════════════════════
 *
 * 全站所有「小功能模块」都用这一个组件渲染，只有形态不同：
 *
 *   flat     常规卡片（核心能力用，矩形轮廓）
 *   placard  展示牌 —— 顶角大圆角的牛奶白厚板
 *
 * 卡片解剖在两种形态下完全一致：
 *
 *   ┌──────────────────────┐
 *   │      [图标砖 48]      │  居中
 *   │      模块名称          │  居中 · 15.5px · semibold
 *   │  ──────────────────  │  发丝线
 *   │  描述文字，靠左对齐     │  13px · 行高 1.75
 *   └──────────────────────┘
 *
 * 为什么标签区居中而正文靠左：短名称居中便于横向扫读比对，
 * 长句左对齐才有稳定的行首基准线。中间的**发丝线是必需的** ——
 * 没有它，两种对齐放在同一张卡里会读成「没对齐」。
 */

export type FeatureVariant = "flat" | "placard" | "bare";

export type FeatureCardProps = {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  desc: string;
  /** AI 功能：标题旁加徽标，图标砖换成更深的一档紫 */
  ai?: boolean;
  variant?: FeatureVariant;
  className?: string;
  style?: CSSProperties;
  /**
   * 给了就整张卡片可点。留空则保持纯展示。
   *
   * 有这个字段的原因：这些卡片原本全是静态的，访客看完一整屏功能介绍会下意识去点，
   * 结果什么都没发生 —— 读起来像页面坏了。
   */
  href?: string;
};

const VARIANT = {
  flat: {
    /**
     * 磨砂玻璃：背景被模糊掉，注意力收在文字上。
     * 核心能力那一块是「读」的内容，用磨砂面。
     */
    surface: "ds-glass-frost ds-glass-frost-hover",
    silhouette: "",
    pad: "px-6 py-7",
    /** 发丝线：切分居中的标签区与靠左的正文 */
    hairline: "ds-hairline",
    /** 网格布局里没有 3D 变换，悬停外凸可以直接挂在卡片自己身上 */
    pop: true,
    /** 不是 3D 陈列块，不渲染侧截面与顶面 */
    solid3d: false,
  },
  placard: {
    /**
     * 方形。上一版这里是上圆下方的大圆角（展示牌轮廓），现在改成近乎直角 ——
     * 这一块要读成「立在柜上的方形玻璃块」，而弧顶会让侧截面的上下两端
     * 与正面轮廓对不齐，厚度会露馅。小圆角只用来避免尖角，不参与造型。
     */
    surface: "ds-glass-clear",
    silhouette: "rounded-[10px]",
    pad: "px-6 py-7",
    hairline: "ds-hairline",
    /**
     * 不带 ds-pop。
     * 这一块的悬停位移由 .ds-shelf-item:hover > article 统一驱动（见 globals.css）——
     * 位移必须挂在外层静止的命中框上、视觉动在里面，否则会与 3D 变换叠加成抖动。
     * 再挂一个 ds-pop 就是两套位移打架。
     */
    pop: false,
    /**
     * 渲染侧截面与顶面，把"一片板"补成"一块砖"。
     *
     * ⚠️ 这两片必须挂在 article **内部**，不能挂在外层的命中区上。
     * 悬停位移施加在 article 上（理由见 feature-row.tsx 的注释）；
     * 若玻璃面挂在命中区，正面抬起来时它们不动，整块玻璃会**散架**。
     * 挂进 article 之后，命中区仍然静止（不抖），而正面、侧截面、顶面一起动（不散）。
     */
    solid3d: true,
  },
  bare: {
    /**
     * 无底板：内容直接浮在底色带上。
     * 用在「线路式轨道」里 —— 那一段的视觉主体是紫线与节点，
     * 再加一层白方块会和线条抢戏，也把轨道压得很重。
     * 内边距收窄，让文字拿到整栏宽度。
     *
     * 不带发丝线：这一段下方已经有紫线与节点作为结构，
     * 再插一条横线会形成两套并列的「分隔语言」，互相削弱。
     * 标签区的最小高度仍在，所以同排各列的正文起点依然对齐。
     */
    surface: "",
    silhouette: "",
    pad: "px-1",
    hairline: null,
    pop: true,
    solid3d: false,
  },
} as const;

export function FeatureCard({
  icon,
  title,
  desc,
  ai = false,
  variant = "flat",
  className,
  style,
  href,
}: FeatureCardProps) {
  const v = VARIANT[variant];

  /*
    ⚠️ href 是后加的，起因是真实反馈：「网页展示的功能模块点击时没反应」。
    原先这些卡片是**纯展示**的，没有链接、没有 onClick —— 访客看到一整屏功能介绍，
    下意识去点，什么都不会发生。

    ⚠️ 链接容器**必须保持原有的伸缩关系**，不能简单地再包一层：
    外层是 flex 列容器、article 自己带 flex-1，中间插一个没有 flex-1 的 <a>
    会让卡片塌掉，同一行的高度对齐与底座也会错位。
    所以这一层直接是 flex-1 + flex 列，把原来的伸缩原样透传下去。
  */
  const card = (
    <article
      className={cn(
        v.surface,
        v.silhouette,
        v.pad,
        // ds-pop：悬停外凸 + 按下回缩。
        // 色块布局上直接挂卡片自己身上即可；但在 3D 层叠里必须关掉（见 placard 的注释）
        v.pop && "ds-pop",
        // 让内部的侧截面 / 顶面能真正落在 3D 空间里（父级 .ds-shelf-item 已是 preserve-3d）
        v.solid3d && "ds-block-3d",
        "group/article relative flex w-full flex-1 flex-col",
      )}
    >
        {/*
          玻璃块的两片"体"：侧截面（厚度）与顶面。
          必须在这里、而不是在外层命中区上 —— 理由见上面 solid3d 的注释。
          放在正文 div 之前，所以天然画在正文之下。
        */}
        {v.solid3d && (
          <>
            <span aria-hidden="true" className="ds-block-side" />
            <span aria-hidden="true" className="ds-block-top" />
          </>
        )}

        {/* z-10：卡片的 ::before 高光画在子元素之上，
            不抬层正文会被蒙上一层薄雾 */}
        <div className="relative z-10 flex flex-1 flex-col">
          {/*
            标签区固定最小高度 = 图标 48 + 间距 16 + 标题 24 + 2 余量。
            这是让同一行所有卡片的发丝线对齐的关键 —— 否则标题长短不同，
            线就会高低错位，一眼就能看出没对齐。
          */}
          <div className="flex min-h-[90px] flex-col items-center">
            <IconTile icon={icon} ai={ai} />
            <h3 className="mt-4 flex items-center gap-2 text-[15.5px] leading-none font-semibold tracking-tight text-ink">
              {title}
              {ai && <Badge tone="violet">AI</Badge>}
            </h3>
          </div>

          {v.hairline && <div className={cn(v.hairline, "my-5")} />}

          <p className="text-[13px] leading-[1.75] text-ink-muted text-pretty">{desc}</p>

          {href && (
            <span className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-medium text-violet-300 opacity-0 transition-opacity duration-200 group-hover/article:opacity-100">
              去看看 →
            </span>
          )}
        </div>
      </article>
  );

  return (
    /*
      外层包一个 flex 列容器有两个作用：
       1. 它是栅格 / 弹性行里真正的那个「格子」，负外边距与位移都施加在它身上
       2. placard 形态下，立杆与底座要挂在板子下方，必须有地方放
      板子用 flex-1，于是同一行里所有板子等高、所有底座对齐。
    */
    <div className={cn("flex flex-col items-center", className)} style={style}>
      {href ? (
        <Link href={href} className="flex w-full flex-1 flex-col">
          {card}
        </Link>
      ) : (
        card
      )}
    </div>
  );
}
