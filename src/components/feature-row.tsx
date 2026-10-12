import type { CSSProperties } from "react";

import {
  FeatureCard,
  type FeatureCardProps,
  type FeatureVariant,
} from "@/components/ui/feature-card";
import { cn } from "@/lib/utils";

/**
 * 玻璃陈列：书柜
 * ══════════════════════════════════════════════════════════════════
 *
 * 四块方形玻璃**侧立**在一块平直的玻璃层板上 —— 像四本立起来的书。
 *
 * ── 为什么取消了重叠 ──────────────────────────────────────────
 *
 * 这一块原本是「层叠」的：每块向左压住邻块 24px。
 * 但层叠与「看见厚度」是**直接冲突**的 —— 厚度长在每块的左侧截面上，
 * 而下一块的正面正好盖在那儿。重叠越多，厚度越看不见。
 *
 * 两者只能留一个。既然立体感正是这一块要的东西，就留厚度、去重叠，
 * 改用等距排列：四块各自独立地立在柜上。
 *
 * ── 立体感的三个来源 ──────────────────────────────────────────
 *
 * 1. perspective    —— 没有透视，rotateY 只是"压扁"，不是"转过去"
 * 2. rotateY(30deg) —— 角度必须够大。7° 时侧截面只投出 2.4px，等于没画
 * 3. 侧截面         —— **关键的一层**。只画正面永远是二维的；
 *                      那片用 rotateY(90deg) 转出来的玻璃才是"厚度"本身
 *
 * 三者齐了，四块才会读成"立在柜子上的玻璃块"，而不是四个矩形。
 */

export type FeatureRowItem = Pick<FeatureCardProps, "icon" | "title" | "desc" | "ai" | "href">;

export function FeatureRow({
  items,
  variant = "placard",
  className,
}: {
  items: readonly FeatureRowItem[];
  variant?: FeatureVariant;
  className?: string;
}) {
  /*
    向左投的阴影，落在邻块一侧。
    清玻璃没有底色，投影是它与背景之间唯一的"离开"关系，
    所以要比实心卡片更明显一点。
  */
  const cast = "-20px 8px 46px -34px rgba(0, 0, 0, 0.85)";

  return (
    /*
      书柜：透视容器 → 一排侧立的玻璃块 → 玻璃层板。

      perspective 必须放在**共同的父元素**上，四块才会共享同一个视点；
      挂在每块自己身上就成了四次互不相干的投影，纵深会各说各话。
    */
    <div className={cn("ds-shelf mt-12", className)}>
      <div className="ds-shelf-row grid gap-6 sm:grid-cols-2 lg:flex lg:items-stretch lg:gap-7">
        {items.map((item, i) => (
          <FeatureCard
            key={item.title}
            {...item}
            variant={variant}
            className={cn(
              // ds-shelf-item：这一层负责 3D —— rotateY 的玻璃块本体，
              // 以及用 ::after 转出来的侧截面（厚度）。
              //
              // 它**不做任何悬停位移**：这一层就是命中区域，一动就会产生
              // "进去→移开→出来→复位"的高频抖动。位移全部交给里面的正面，
              // 由 globals.css 里的 .ds-shelf-item:hover > article 驱动。
              "ds-shelf-item lg:min-w-0 lg:flex-1",
              "lg:z-[var(--z)] lg:hover:z-50",
            )}
            style={
              {
                // 悬停时把当前一块抬到最上
                "--z": i + 1,
                "--ds-cast": cast,
              } as CSSProperties
            }
          />
        ))}
      </div>

      {/* 玻璃层板（托底）：四块玻璃侧立在它上面 */}
      <div aria-hidden="true" className="ds-shelf-base" />
    </div>
  );
}
