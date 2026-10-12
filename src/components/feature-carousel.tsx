import type { CSSProperties } from "react";

import { FeatureCard, type FeatureCardProps } from "@/components/ui/feature-card";
import { cn } from "@/lib/utils";

/**
 * 线路式横向循环轨道
 * ══════════════════════════════════════════════════════════════════
 *
 * 把四个模块挂在一条横向循环滚动的「线路」上，线上串着太阳系八大行星：
 *
 *      ┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐
 *      │ 卡片 │   │ 卡片 │   │ 卡片 │   │ 卡片 │
 *      └──┬───┘   └──┬───┘   └──┬───┘   └──┬───┘
 *         │          │          │          │
 *   ──────●──────────●──────────●──────────●──────   ← 紫色线路
 *
 * 轨道持续左移形成循环，两端用遮罩渐隐 —— 比硬切边高级，
 * 也顺手藏住了首尾衔接处。
 *
 * ── 四个实现要点 ──────────────────────────────────────────────
 *
 * 1. **无缝循环靠「轨道宽度恰为半轨的两倍」。**
 *    间距因此用每项的 margin-right，而不是容器的 gap：
 *    用 gap 的话两份之间只多出一个间隙，轨道就不是两倍整，
 *    移到 -50% 时会差半个 gap，循环处出现可见跳变。
 *
 * 2. **横线放在轨道内部，而不是外面。**
 *    它铺满整条轨道，所以随轨道滚动时视觉上是静止的 ——
 *    这样就不必去对齐「固定横线」与「滚动行星」两个独立坐标系，
 *    少一类必然会对不齐的隐患。
 *
 * 3. **行星必须与模块解耦，但半轨长度必须同时是「模块数的倍数」和
 *    「行星数的倍数」。** 否则同一张卡片在循环前后会配到不同行星，
 *    归位瞬间看得见跳变。推导与降级保护见 resolveLayout()。
 *
 * 4. **自动滚动必须能被停下来。**
 *    悬停与键盘聚焦都暂停（见 globals.css），
 *    并且在 prefers-reduced-motion 下直接停掉动画而不是把时长压到 0
 *    —— 后者会让它瞬间跳到终点并停住，露出一条被裁掉一半的轨道。
 */

/** 卡片宽度（px） */
const CARD_WIDTH = 320;
/** 项间距（px）。用 margin 而非 gap，理由见上 */
const ITEM_GAP = 24;
/**
 * 星带的厚度（px）。
 * 30px 有两个约束同时决定：给"纵向密度衰减"留出层次，
 * 并且要能**完整包住最大的行星**（木星 27px，在带内跨 [5.5, 32.5]，带跨 [4, 34]）——
 * 行星落在带内才读作"浮在星云里"。
 */
const LINE = 30;
/**
 * 行星圆心距星带底边的高度。
 * 必须容纳最大行星（木星 27px）的半径 13.5px，再留出垫片空间。
 */
const NODE_CENTER_FROM_BOTTOM = 19;
/** 星带的 bottom：让带子以行星圆心为中心，而不是让上沿对齐圆心 */
const LINE_BOTTOM = NODE_CENTER_FROM_BOTTOM - LINE / 2;
/**
 * 卡片底边距列底的高度（常量）。**它直接决定"文字到星带"的距离。**
 *
 * 四列的自然高度都等于「卡片内容高 + 这个常量」，卡片取 flex-1 后正好填满，
 * 没有多余留白 —— 所以缩小它就等于把星带往上提。
 * 46 对应的间隙：46 − (19 + 15) = 12px。
 *
 * 行星越大，它上方的留白越薄、垫片也越薄，两者恰好抵消，
 * 四列卡片的底边因此严格齐平。
 * 校验：留白 + 行星 + 垫片 = (46-19-d/2) + d + (19-d/2) = 46 ✓
 */
const CARD_BOTTOM_FROM_COLUMN = 46;

/**
 * 太阳系八大行星。
 *
 * ── 尺寸怎么来的 ──────────────────────────────────────────────
 * 按真实直径**开方压缩**后落到 15~27px。线性缩放不可行：
 * 木星/水星 = 29.3 倍，水星取 12px 时木星要 352px。开方之后仍有 5 倍差距，
 * 而三个层级（岩质 / 冰巨 / 气巨）完整保留。
 *
 * 随后对相邻档位施加 **1px 最小间距** —— 这是可读性下限，不是随手调数字。
 * 真实比值下水星(4879)与火星(6792)、金星(12104)与地球(12756)的差距
 * 不足 1px，会糊成同一个点。顺序、层级、倍率关系全部保留，只是抹平了
 * 这个尺寸下本就不存在的差距。
 *
 * ── 风格怎么定的 ──────────────────────────────────────────────
 * **天文台图鉴风**：真实颜色 + 真实相对大小 + 每颗一样标志物。
 *
 * ── 辨识度只能来自剪影，不能来自颜色 ──────────────────────────
 * 小尺寸下视觉系统**先认轮廓**。图标设计有个标准检验：把图标填成纯黑，
 * 还能认出来才算合格。第一版八颗全是正圆、剪影完全相同，等于把辨识度
 * 全押在色相上 —— 而在滚动条带里逐颗比对色相，人眼本来就做不到。
 *
 * 所以每颗给一样**别的行星没有的**标志物（features），按"能否打破剪影"分两档：
 *   破剪影    土星的环、地球的月亮、天王星的竖直环 —— 一眼可辨
 *   内部对比  木星的大红斑与横带、火星的极冠、海王星的暗斑、水星的环形山
 * 金星**刻意不做任何加工**：它本来就是终年云盖、毫无特征的行星，
 * "唯一一颗什么都没有的暖色球"就是它的身份。
 */
type PlanetFeature = "ring" | "bands" | "moon" | "cap" | "vring" | "spot" | "dspot" | "crater";

type Planet = {
  id: string;
  name: string;
  /** 直径（px） */
  size: number;
  color: string;
  /** 高光色 */
  hi: string;
  /**
   * 标志物。每颗至少一样，且**互不重复** —— 重复就等于没有。
   * 木星是个例外：横带与大红斑是同一颗行星的两个互补特征，一起给。
   */
  features?: readonly PlanetFeature[];
};

/** 按太阳系顺序排列：水 → 金 → 地 → 火 → 木 → 土 → 天 → 海 */
const PLANETS: readonly Planet[] = [
  {
    id: "mercury",
    name: "水星",
    size: 15,
    color: "#9c9188",
    hi: "#d8d2c8",
    features: ["crater"],
  },
  { id: "venus", name: "金星", size: 17, color: "#e8c88a", hi: "#fff3d6" },
  { id: "earth", name: "地球", size: 18, color: "#4a90d9", hi: "#a8d4f5", features: ["moon"] },
  { id: "mars", name: "火星", size: 16, color: "#c1440e", hi: "#f08a5a", features: ["cap"] },
  {
    id: "jupiter",
    name: "木星",
    size: 27,
    color: "#d8a06a",
    hi: "#f5dfc0",
    features: ["bands", "spot"],
  },
  { id: "saturn", name: "土星", size: 26, color: "#e3c98a", hi: "#fff0cc", features: ["ring"] },
  { id: "uranus", name: "天王星", size: 22, color: "#8fd8e0", hi: "#d8f5f8", features: ["vring"] },
  {
    id: "neptune",
    name: "海王星",
    size: 21,
    color: "#3f5fd8",
    hi: "#8fa8f5",
    features: ["dspot"],
  },
];

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * 索引取值。
 *
 * 调用处一律对列表长度取模，所以实际永远不会越界 —— 这里是为了满足
 * TS 的越界检查，而不是在兜底一件真会发生的事。写成显式抛错而不是
 * 静默兜底：万一将来取模写错，应当立刻炸出来，而不是悄悄显示错的行星。
 */
function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) {
    throw new Error(`索引越界：${index} / ${list.length}`);
  }
  return value;
}

/**
 * 决定轨道怎么排。
 *
 * ── 为什么不能简单地把行星按槽位下标分配 ──────────────────────
 *
 * 无缝循环要求**「槽位 i」与「槽位 i + 半轨」渲染完全相同**。
 * 若按槽位下标取行星：槽位 0 = PWA + 水星，槽位 4 = PWA + 木星 ——
 * 同一张卡片在循环前后配了不同行星，归位瞬间会看见跳变。
 *
 * 于是半轨长度必须同时是「模块数的倍数」与「行星数的倍数」：
 *     半轨 = 模块数 × (行星数 / gcd(模块数, 行星数))，并取偶
 * 当前 4 个模块、8 颗行星 → gcd=4 → 半轨 8 个槽位 → 整轨 16 个槽位，
 * 八颗行星在每一份里各出现一次。
 *
 * ── 降级保护 ──────────────────────────────────────────────────
 * 半轨过长会让 DOM 无谓膨胀。超过 12 个槽位就退回「一模块一行星」：
 * 半轨 = 模块数，仍然无缝（行星按下标取模，与模块同步），只是行星变少。
 */
function resolveLayout(itemCount: number) {
  const planetCount = PLANETS.length;
  let slotsPerHalf = itemCount * (planetCount / gcd(itemCount, planetCount));
  if (slotsPerHalf % 2 !== 0) slotsPerHalf *= 2;

  const planetPerModule = slotsPerHalf > 12;
  if (planetPerModule) slotsPerHalf = itemCount;

  return {
    slotsPerHalf,
    totalSlots: slotsPerHalf * 2,
    planetPerModule,
  };
}

export type FeatureCarouselItem = Pick<
  FeatureCardProps,
  "icon" | "title" | "desc" | "ai" | "href"
>;

export function FeatureCarousel({ items }: { items: readonly FeatureCarouselItem[] }) {
  const { totalSlots, planetPerModule } = resolveLayout(items.length);

  return (
    <div className="relative mt-12">
      <div className="ds-marquee-mask overflow-hidden">
        {/* pt-6 是给卡片顶部的投影留空间，否则会被 overflow-hidden 切掉 */}
        <div className="ds-marquee-track relative flex w-max pt-6">
          {/* 星带（银河带）。铺满整条轨道，所以随轨道滚动也看不出在动。
              它没有硬边 —— 边界由星点密度衰减形成，不再是数学直线。 */}
          <span
            aria-hidden="true"
            className="ds-star-band absolute inset-x-0"
            style={{ bottom: `${LINE_BOTTOM}px`, height: `${LINE}px` }}
          />

          {Array.from({ length: totalSlots }, (_, i) => {
            const item = at(items, i % items.length);
            // 行星与模块解耦：按槽位取，于是八颗在一份半轨里各出现一次
            const planet = at(
              PLANETS,
              planetPerModule ? i % items.length : i % PLANETS.length,
            );

            // 行星越大，上方留白越薄、垫片也越薄 —— 两者抵消，卡片底边因此齐平
            const spacer = NODE_CENTER_FROM_BOTTOM - planet.size / 2;
            const leadGap = CARD_BOTTOM_FROM_COLUMN - NODE_CENTER_FROM_BOTTOM - planet.size / 2;

            return (
              <div
                key={`${item.title}-${i}`}
                // 复制出来的那些份对读屏隐藏，避免同一内容被念两遍
                aria-hidden={i >= items.length ? true : undefined}
                className="flex shrink-0 flex-col items-center"
                style={{ width: CARD_WIDTH, marginRight: ITEM_GAP }}
              >
                {/* 无底板：这一段的主体是星带与行星，再加白方块会和它们抢戏。

                    flex-1 必须加在**外层包装**上，而不是里面的 article 上：
                    作为弹性子项的是包装层，它不生长的话，多出来的自由空间会
                    滞留在整列底部，把行星顶到星带上方去。 */}
                <FeatureCard {...item} variant="bare" className="w-full flex-1" />

                {/*
                  模块与行星之间的留白。

                  这里原本是一条"星尘降"竖线，已取消：模块与行星**本来就不
                  一一对应**（八颗行星循环出现），那条线却在说"这颗行星属于
                  这个模块"—— 关系不成立。取消之后才自洽。

                  留白本身保留（等高不可见），垂直节奏与卡片底边对齐关系
                  完全不变，只是不再画出来。
                */}
                <span aria-hidden="true" style={{ height: `${leadGap}px` }} />

                <span
                  aria-hidden="true"
                  className={cn(
                    "ds-planet",
                    planet.features?.map((f) => `ds-planet--${f}`),
                  )}
                  // 原生 tooltip：给好奇的人一个交代，零成本
                  title={planet.name}
                  style={
                    {
                      "--ds-planet-size": `${planet.size}px`,
                      "--ds-planet-color": planet.color,
                      "--ds-planet-hi": planet.hi,
                    } as CSSProperties
                  }
                />

                {/* 底部垫片。NODE_CENTER_FROM_BOTTOM 就是按它和行星半径算出来的 */}
                <span aria-hidden="true" style={{ height: `${spacer}px` }} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
