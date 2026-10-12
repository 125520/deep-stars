import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * 星座图 —— 深星的视觉核心，纯 SVG。
 *
 * 设计要点：
 *  · 星点颜色取自恒星光谱档位（见 globals.css 的 --color-star-*），
 *    与 Canvas 星野用同一套色，画面才统一。
 *  · 星等决定半径与辉光强度，越亮的星越像「真的在发光」。
 *  · 连线是**星座**概念的载体：真实星座就是古人把亮星连起来，
 *    所以线的颜色要比星点暗、比背景亮，绝不抢戏。
 *  · 无 state、无 effect，服务端可渲染 —— 公开分享页与年度报告要复用它。
 */

/** 光谱档位：0 蓝白 · 1 白 · 2 黄白 · 3 金黄 · 4 橙红 */
export type SpectralClass = 0 | 1 | 2 | 3 | 4;

const SPECTRAL_VAR: Record<SpectralClass, string> = {
  0: "var(--color-star-o)",
  1: "var(--color-star-a)",
  2: "var(--color-star-f)",
  3: "var(--color-star-g)",
  4: "var(--color-star-k)",
};

export type StarPoint = {
  id: string;
  /** viewBox 坐标 */
  x: number;
  y: number;
  /** 星等 0..1，越大越亮 */
  magnitude: number;
  /** 光谱档位，决定颜色 */
  spectral?: SpectralClass;
  label?: string;
};

export type ConstellationMapProps = {
  stars: StarPoint[];
  links: Array<[string, string]>;
  className?: string;
  animate?: boolean;
  showLabels?: boolean;
  /**
   * 最新点亮的那一枚星。
   *
   * 给它单独加一圈**十字光芒并顺时针缓慢旋转 + 闪烁** —— 其余星保持安静。
   * 为什么不给所有星都加：几十枚星同时转，画面会变成一片噪点，
   * 反而看不出「刚刚点亮的是哪一枚」。这个效果的意义就是指出那一枚。
   */
  highlightId?: string;
};

/**
 * 星图的坐标空间边长。**调用方必须把坐标换算到 0..MAP_VIEW_SIZE 再传进来。**
 *
 * ⚠️ 这里踩过一次很贵的坑：数据库里的 `star.x / star.y` 是**归一化坐标（0..1）**，
 * 而本组件的 viewBox 是 `0 0 400 400`。有两个调用方直接把 0..1 传了进来，
 * 于是**所有星点都挤在左上角一个像素范围内**，界面上看起来就是「星图一片空白、
 * 打了卡也没变化」。
 *
 * 而演示数据 `demoConstellation()` 用的是 0..400，所以落地页那张星图一直是对的 ——
 * 两处行为不一致，恰恰说明问题出在**单位约定**上，而不是渲染。
 *
 * 所以现在由本组件导出这个常量，调用方写 `s.x * MAP_VIEW_SIZE`，
 * 把一个隐含约定变成一个显式乘法。
 */
export const MAP_VIEW_SIZE = 400;

const VIEW = MAP_VIEW_SIZE;

/**
 * 星点半径（viewBox 单位）。
 *
 * ⚠️ 这个值改过两次，两次的原因值得记下来：
 *
 * **第一次调大**：线上反馈「打卡点亮第一枚星之后看不出变化」。当时星点
 * `1.5 + 星等×4.2` → 直径约 7 像素，压在装饰星野上完全分不出来。
 * 但那其实不是主因 —— 真正的原因是坐标单位不一致（见 MAP_VIEW_SIZE），
 * 修完之后顺手把半径也放大了一倍。
 *
 * **第二次调小（现在）**：因为每一枚星都加上了旋转的细光芒，
 * 实心圆再那么大就糊成一团光斑，「光芒」反而看不出来了。
 * 光晕交给动画，实心点回归小而锐利 —— 这才像星星。
 */
function radiusFor(magnitude: number) {
  return 2.6 + Math.max(0, Math.min(1, magnitude)) * 4.2;
}

/**
 * 四角星的路径（十字光芒的形状）。
 *
 * 尖角落在 ±R 的四个正方向上，内凹点落在 ±R·w 的对角线上 ——
 * 内凹越深，光芒越"细长锐利"。默认 13% 是试出来的：再小就细成一根线、
 * 看不出光晕，再大就胖成一个菱形、失去"光芒"的感觉。
 * 小光芒用更浅的内凹（16%），因为它整体很小，太细会消失。
 *
 * 图形以原点为中心，调用方负责把它平移到星点位置。
 */
function sparklePath(R: number, wRatio = 0.13) {
  const w = R * wRatio;
  return [
    `M 0 ${-R}`,
    `L ${w} ${-w}`,
    `L ${R} 0`,
    `L ${w} ${w}`,
    `L 0 ${R}`,
    `L ${-w} ${w}`,
    `L ${-R} 0`,
    `L ${-w} ${-w}`,
    "Z",
  ].join(" ");
}

export function ConstellationMap({
  stars,
  links,
  className,
  animate = true,
  showLabels = false,
  highlightId,
}: ConstellationMapProps) {
  const byId = new Map(stars.map((s) => [s.id, s]));
  const uid = React.useId().replace(/:/g, "");

  return (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={cn("h-full w-full", className)}
      role="img"
      aria-label={`星座图，共 ${stars.length} 枚星点`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        {/* 亮星的柔光 */}
        <filter id={`${uid}-soft`} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="2.6" />
        </filter>
        {/* 连线：从星云紫渐变到淡紫，避免整条线一个死色 */}
        <linearGradient id={`${uid}-line`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-nebula-soft)" stopOpacity="0.62" />
          <stop offset="100%" stopColor="var(--color-nebula)" stopOpacity="0.38" />
        </linearGradient>
      </defs>

      {/* ── 星座连线 ── */}
      <g fill="none" stroke={`url(#${uid}-line)`} strokeLinecap="round">
        {links.map(([from, to], i) => {
          const a = byId.get(from);
          const b = byId.get(to);
          if (!a || !b) return null;
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          return (
            <line
              key={`${from}-${to}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              strokeWidth={1}
              strokeDasharray={animate ? len : undefined}
              strokeDashoffset={animate ? len : undefined}
              style={
                animate
                  ? {
                      animation: `ds-draw 0.9s var(--ease-out-soft) ${(0.2 + i * 0.1).toFixed(2)}s forwards`,
                      ["--ds-dash" as string]: `${len}`,
                    }
                  : undefined
              }
            />
          );
        })}
      </g>

      {/* ── 星点 ── */}
      <g>
        {stars.map((s, i) => {
          const r = radiusFor(s.magnitude);
          const bright = s.magnitude > 0.62;
          const color = SPECTRAL_VAR[s.spectral ?? 1];

          return (
            <g
              key={s.id}
              style={
                animate
                  ? {
                      animation: `ds-rise 0.55s var(--ease-out-soft) ${(i * 0.045).toFixed(2)}s both`,
                    }
                  : undefined
              }
            >
              {/* 只有亮星带辉光：给每颗都加会让画面糊成一团。
                  不透明度从 0.14 提到 0.26 —— 前者在装饰星野上几乎看不出来，
                  辉光的意义就是让「你的星」与背景那些点拉开层次。 */}
              {bright && (
                <circle
                  cx={s.x}
                  cy={s.y}
                  r={r * 3.6}
                  fill={color}
                  opacity={0.26}
                  filter={`url(#${uid}-soft)`}
                />
              )}
              <circle cx={s.x} cy={s.y} r={r} fill={color} opacity={0.62 + s.magnitude * 0.38} />

              {/*
                ── 每一枚已点亮的星都带一圈细光芒 ──
                转得比「最新那一枚」慢很多、也小很多：它们的作用是让整张星图
                看起来是活的，而不是抢注意力。真正的主角仍然是最新那一枚。
                只画一层（最新那枚画两层），因为复杂档有 30 枚星 ——
                每枚两层就是 60 个带动画的节点，没必要。
              */}
              <g transform={`translate(${s.x} ${s.y})`} className="ds-glint" aria-hidden="true">
                <path d={sparklePath(r * 2.1, 0.16)} fill="#fff" />
              </g>

              {/*
                ── 最新点亮那一枚：更大的十字光芒 ──
                画法：整组先平移到星点位置，图形自己画在原点，
                这样旋转天然绕星点进行，不需要 transform-origin
                （SVG 里 transform-origin 的坐标系很容易踩坑，能避开就避开）。

                形状是四角星（尖角在外、内凹在里），也就是常见的十字光芒。
                两段动画叠在一起：光环顺时针转，整体明暗呼吸。
              */}
              {s.id === highlightId && (
                <g transform={`translate(${s.x} ${s.y})`} className="ds-sparkle" aria-hidden="true">
                  <path
                    d={sparklePath(r * 4.6)}
                    fill={color}
                    className="ds-sparkle-halo"
                  />
                  <path d={sparklePath(r * 2.6)} fill="#fff" className="ds-sparkle-core" />
                </g>
              )}
              {/* 最亮的一档加个纯白核心，模拟过曝 */}
              {s.magnitude > 0.85 && (
                <circle cx={s.x} cy={s.y} r={r * 0.42} fill="#fff" opacity={0.9} />
              )}
              {showLabels && s.label && (
                <text
                  x={s.x + r + 6}
                  y={s.y + 3}
                  fontSize="9"
                  fill="var(--color-nebula-soft)"
                  opacity="0.8"
                  className="select-none"
                >
                  {s.label}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/**
 * 由打卡强度生成示意星座。真正接入数据库后由 P2 替换数据源，
 * 布局算法保持在这里 —— 保证同一份打卡记录每次渲染出的星图一致。
 */
export function demoConstellation(): { stars: StarPoint[]; links: Array<[string, string]> } {
  // [x, y, 星等, 光谱档]
  const layout: Array<[number, number, number, SpectralClass]> = [
    [64, 268, 0.95, 0],
    [128, 214, 0.72, 2],
    [196, 186, 0.86, 1],
    [258, 138, 0.62, 3],
    [318, 108, 0.98, 0],
    [212, 300, 0.55, 4],
    [286, 322, 0.68, 2],
    [338, 262, 0.48, 1],
    [96, 118, 0.4, 3],
    [162, 74, 0.34, 1],
    [352, 176, 0.52, 2],
    [46, 168, 0.3, 0],
  ];
  const stars: StarPoint[] = layout.map(([x, y, magnitude, spectral], i) => ({
    id: `s${i}`,
    x,
    y,
    magnitude,
    spectral,
  }));
  const links: Array<[string, string]> = [
    ["s0", "s1"],
    ["s1", "s2"],
    ["s2", "s3"],
    ["s3", "s4"],
    ["s2", "s5"],
    ["s5", "s6"],
    ["s6", "s7"],
    ["s3", "s10"],
    ["s8", "s9"],
    ["s0", "s11"],
  ];
  return { stars, links };
}
