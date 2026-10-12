import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

/**
 * 深空底纹 —— 精确几何版
 * ══════════════════════════════════════════════════════════════════
 *
 * 三层结构：
 *   1. 星点阵列 + 稀疏经纬线（CSS 背景，见 globals.css 的 .ds-celestial-grid）
 *   2. 行星：纯圆轮廓的行星与环系
 *   3. 轨道参考圆：一圈虚线，读起来像天体轨道图
 *
 * 设计取向：**数字美学** —— 一切由精确几何构成。
 *   · 行星是正圆，不是手绘的不规则轮廓
 *   · 环系是四条严格同心的椭圆边界，中间留白就是卡西尼缝
 *   · 描边宽度统一，没有粗细随机变化的「手抖感」
 *   · 虚线轨道圆提供一层技术图纸般的秩序
 *
 * 有机的线条（蜿蜒的枝条、磕巴的行星轮廓）已全部移除 ——
 * 它们与「严谨」是互斥的两种表达，混在一起只会互相削弱。
 *
 * 两条纪律：
 *   · 全部线稿化、单色（紫），不填实色 —— 填色会在白底上变成脏斑。
 *   · 整体套一层径向渐隐遮罩（.ds-celestial-fade），把中间内容区挖空。
 */

export function CelestialBackdrop({ className }: { className?: string }) {
  return (
    <>
      <div
        aria-hidden="true"
        className={cn(
          "ds-celestial-fade pointer-events-none fixed inset-0 overflow-hidden",
          className,
        )}
      >
        {/* ── 第一层：坐标纸 ── */}
        <div className="ds-celestial-grid absolute inset-0" />

        {/* ── 第二层：行星 ──
            尺寸按「环系跨度约等于 3/4 屏宽」反推：
            viewBox 宽 420，环外缘 rx 182 → 占元素宽 86.7%，
            于是元素取 86vw 时环系正好 ~75vw。
            高度上不设 vh 上限会有问题，所以用 min() 兜一层，
            避免在极窄高的窗口里把行星撑到离谱。

            ds-saturn-rise：首屏不可见，滚过页面一小段后从下方浮上来。
            理由见 globals.css 里那段注释 —— 一打开就在右上压一颗巨大行星，
            会和右上角那块星图抢视线，也让人觉得页面「已经满了」。 */}
        {/* 色调压到 50%：violet-300 在近黑的底上相当亮，全不透明会喧宾夺主。
            背景纹样的本分是「隐约可辨」，不是「被看见」。 */}
        <Saturn className="ds-saturn-rise absolute top-1/2 -right-[22vw] h-[min(86vw,150vh)] w-[min(86vw,150vh)] -translate-y-1/2 text-violet-300/50" />
        <Crescent className="absolute bottom-[9vh] left-[2vw] h-[24vh] w-[24vh] text-violet-300/50" />
        <Orb className="absolute top-[16vh] left-[13vw] h-[9vh] w-[9vh] text-violet-300/50" />
        <Orb className="absolute right-[36vw] bottom-[18vh] h-[6vh] w-[6vh] text-violet-300/50" />
      </div>

      {/*
        流星单独一层，**刻意不套渐隐遮罩**。
        套进去的话，它从右上飞向画面中部时会正好落进遮罩的透明芯，
        被压到只剩不到两成不透明度 —— 半路就凭空消失。
        纹样该让位给内容，但「从出现到消失」本身就是流星的表演，
        不能让它被别的东西吃掉。
        这一层仍在内容之下（内容层 z-10），所以不会盖住正文。
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        {/* 周期、时长、起点、亮度全部错开。用同一组参数会立刻露出破绽 ——
            四颗流星整齐划一地滑落，看起来像加载动画而不是夜空。 */}
        {METEORS.map((m, i) => (
          <span
            key={i}
            className="ds-meteor"
            style={
              {
                top: m.top,
                left: m.left,
                width: `${m.width}px`,
                // 周期与延迟通过变量下发：伪元素 ::before / ::after 各自的
                // 动画要靠它们对齐时间轴。animation-duration 不可继承，
                // 但自定义属性可以 —— 这是让三层同步的唯一干净办法。
                "--ds-meteor-dur": `${m.duration}s`,
                "--ds-meteor-delay": `${m.delay}s`,
                "--ds-meteor-opacity": m.opacity,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </>
  );
}

/**
 * 流星参数。
 *
 * 频率与速度都调高了：周期压到 3.6~5.6s，数量 6 颗。
 * 尾跡长度（width）拉到 420~680px —— 短尾巴看不出「划过」，
 * 长尾巴才留得下痕迹。
 *
 * 起点、周期、亮度、长度仍然全部错开：整齐划一会立刻露出破绽。
 * 起始延迟从 1.2s 起 —— 首屏要干净，刚打开不该正好有一道划过。
 *
 * 注意 width 是**尾迹长度**，不是流星本身的尺寸；
 * 头部光芒由 ::after 自己撑开（52px），不受这个值影响。
 */
const METEORS = [
  { top: "4%", left: "78%", width: 680, delay: 1.2, duration: 3.6, opacity: 0.95 },
  { top: "15%", left: "96%", width: 520, delay: 2.5, duration: 4.4, opacity: 0.75 },
  { top: "-2%", left: "56%", width: 620, delay: 4.0, duration: 5.2, opacity: 0.6 },
  { top: "26%", left: "90%", width: 440, delay: 5.8, duration: 4.0, opacity: 0.5 },
  { top: "9%", left: "68%", width: 640, delay: 7.6, duration: 5.6, opacity: 0.85 },
  { top: "32%", left: "84%", width: 420, delay: 9.6, duration: 4.8, opacity: 0.45 },
];

/* ══════════════════════════════════════════════════════════════════
   行星
   ══════════════════════════════════════════════════════════════════ */

/** 行星半径（局部坐标） */
const R = 90;
/** 环系倾角 */
const TILT = -22;
/** 环的扁率：正视图中环的短半轴 / 长半轴 */
const FLATTEN = 0.275;
/**
 * 环系四条边界半径：外缘 / A 环内缘 / 卡西尼缝内侧 / B 环内缘。
 * 中间 156→138 那段留白就是卡西尼缝 —— 一次画一圈实线是画不出土星的。
 */
const RING_RADII = [182, 156, 138, 104];

/**
 * 土星：纯圆轮廓 + 严格同心的环系。
 *
 * 让它「严谨」而不是「像画了个圈」靠三件事：
 *   · 行星是**正圆**（不是椭圆，也不带手绘抖动）
 *   · 环拆成**四条同心边界**，留白处自然形成卡西尼缝
 *   · 环分成后半 → 行星 → 前半三段绘制，环才会自然从球后绕过去
 *     一次画完会有一条线横穿球面，像被划了一刀
 */
function Saturn({ className }: { className?: string }) {
  return (
    <svg viewBox="-210 -195 420 390" className={className} fill="none" aria-hidden="true">
      <g transform={`rotate(${TILT})`} stroke="currentColor" strokeWidth="1.6">
        {/* ── 后半环：只画被行星挡住的那一半 ── */}
        {RING_RADII.map((rx) => (
          <path key={`back-${rx}`} d={`M ${rx} 0 A ${rx} ${rx * FLATTEN} 0 0 1 ${-rx} 0`} />
        ))}

        {/* ── 轨道参考圆 ──
            一圈虚线，比行星略大。它不表示任何真实天体，纯粹是
            「技术图纸」的语汇 —— 数字美学里最省力的一笔。 */}
        <circle
          r={R * 1.34}
          strokeWidth="1"
          strokeDasharray="3 7"
          opacity="0.55"
        />

        {/* ── 行星 ── */}
        <circle r={R} strokeWidth="1.8" />

        {/* ── 前半环：从行星前面绕回来 ── */}
        {RING_RADII.map((rx) => (
          <path key={`front-${rx}`} d={`M ${-rx} 0 A ${rx} ${rx * FLATTEN} 0 0 1 ${rx} 0`} />
        ))}
      </g>
    </svg>
  );
}

/** 月牙：两段圆弧相减，不带环形山 —— 环形山是写实笔法，与几何取向冲突 */
function Crescent({ className }: { className?: string }) {
  return (
    <svg viewBox="-60 -60 120 120" className={className} fill="none" aria-hidden="true">
      <path
        d="M 14 -46 A 46 46 0 1 0 14 46 A 36 36 0 1 1 14 -46 Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 小型行星：正圆 + 一圈细环 */
function Orb({ className }: { className?: string }) {
  return (
    <svg viewBox="-46 -46 92 92" className={className} fill="none" aria-hidden="true">
      <circle r="26" stroke="currentColor" strokeWidth="1.6" />
      <ellipse
        rx="42"
        ry="12"
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.75"
        transform="rotate(-18)"
      />
    </svg>
  );
}
