"use client";

import * as React from "react";

/**
 * 深空星野 —— 只放进「观测窗」面板内部。
 *
 * 配色依据（这是这次重做的重点）：
 *   真实星空的颜色不是美术选色，而是恒星表面温度的直接结果，
 *   按 Morgan–Keenan 光谱分类从热到冷是：
 *     O/B 蓝白 → A 白 → F 黄白 → G 黄 → K 橙 → M 红
 *   夜空里肉眼可见的星以 A/F/G 居多，蓝白与暖橙各占两端，
 *   红矮星数量最多但因为暗，肉眼几乎看不到 —— 所以这里也压低 M 型比例。
 *   发色权重：蓝白 22% / 白 34% / 黄白 26% / 金黄 13% / 橙红 5%。
 *
 * 另外两个让它「像真的」的细节：
 *   1. 银河带 —— 约 30% 的星贴着一条斜向带分布，形成银河的密度反差。
 *      均匀撒点的星空一眼就假。
 *   2. 星云紫 —— 深空并非纯黑，有淡淡的电离气体辉光。
 *
 * 性能取舍：全部用 Canvas 2D。星点只需要「圆 + 透明度」，
 * WebGL 的上下文创建成本远大于收益，而这块面板在页面上常驻。
 */

/** 光谱档位 → CSS 颜色变量名 */
const SPECTRAL = [
  { varName: "--color-star-o", weight: 0.22 },
  { varName: "--color-star-a", weight: 0.34 },
  { varName: "--color-star-f", weight: 0.26 },
  { varName: "--color-star-k", weight: 0.13 },
  { varName: "--color-star-m", weight: 0.05 },
] as const;

/** 累积权重，用于一次随机数完成档位抽样 */
const CUMULATIVE = SPECTRAL.reduce<number[]>((acc, s, i) => {
  acc.push((acc[i - 1] ?? 0) + s.weight);
  return acc;
}, []);

type Star = {
  /** 归一化坐标 0..1 */
  x: number;
  y: number;
  r: number;
  /** 视差深度 0..1 */
  depth: number;
  phase: number;
  /** 光谱档位下标 */
  spectral: number;
};

type Rgb = { r: number; g: number; b: number };

/** 把 CSS 变量解析成 rgb 三元组，交给 canvas 用 */
function readPalette(el: HTMLElement): Rgb[] {
  const cs = getComputedStyle(el);
  return SPECTRAL.map(({ varName }) => {
    const raw = cs.getPropertyValue(varName).trim();
    // 支持 #rrggbb
    const m = /^#?([0-9a-f]{6})$/i.exec(raw);
    if (m?.[1]) {
      const n = parseInt(m[1], 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
    // 退化值：暖白，保证任何情况下都有颜色可用
    return { r: 246, g: 244, b: 255 };
  });
}

function pickSpectral(): number {
  const r = Math.random();
  for (let i = 0; i < CUMULATIVE.length; i += 1) {
    if (r <= (CUMULATIVE[i] ?? 1)) return i;
  }
  return 1;
}

/** 高斯分布（Box–Muller 的简化版），用于银河带的聚拢 */
function gauss(): number {
  return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
}

/**
 * 星点密度。
 *
 * 真实夜空的样子是「大量暗星 + 少量亮星」，而不是「几十颗均匀的点」。
 * 所以这里刻意取较高的密度（观测窗那种 520px 见方的面板 → 约 380 颗），
 * 靠低透明度把绝大多数压成背景噪点，只有少数几颗真正跳出来。
 * 密度不够时画面会显得空，一眼就假。
 */
function starCountFor(w: number, h: number) {
  const raw = Math.round((w * h) / 1_450);
  return Math.max(380, Math.min(1_600, raw));
}

function makeStars(count: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i += 1) {
    const depth = Math.random();
    // 30% 的星聚在银河带上：一条从右上到左下的斜带
    const onBand = Math.random() < 0.3;
    const x = Math.random();
    const y = onBand
      ? Math.min(1, Math.max(0, 0.28 + x * 0.52 + gauss() * 0.075))
      : Math.random();

    stars.push({
      x,
      y,
      // 越近越大；银河带上的星略暗（它们是背景星族）
      // 尺寸压得很小是有意的：真实的星在屏幕上就是「一个点」，
      // 画成大圆点立刻变成装饰图案。
      r: onBand
        ? 0.28 + Math.random() * 0.5
        : 0.3 + depth * 0.95 + Math.random() * 0.38,
      depth,
      phase: Math.random() * Math.PI * 2,
      spectral: pickSpectral(),
    });
  }
  return stars;
}

/** 最亮的几颗：带十字光芒，给画面视觉锚点 */
const BRIGHT_ANCHORS: Array<{ x: number; y: number; spectral: number; scale: number }> = [
  { x: 0.2, y: 0.24, spectral: 0, scale: 1 },
  { x: 0.76, y: 0.18, spectral: 2, scale: 0.82 },
  { x: 0.87, y: 0.63, spectral: 3, scale: 0.9 },
  { x: 0.34, y: 0.78, spectral: 1, scale: 0.72 },
];

export function Starfield({ className }: { className?: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const pointer = React.useRef({ x: 0, y: 0 });

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const palette = readPalette(canvas);

    let width = 0;
    let height = 0;
    let stars: Star[] = [];
    let raf = 0;
    let running = true;
    let start = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = makeStars(starCountFor(width, height));
      start = performance.now();
    };

    const rgba = (c: Rgb, a: number) => `rgba(${c.r}, ${c.g}, ${c.b}, ${a.toFixed(3)})`;

    const draw = (now: number) => {
      if (!running) return;
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, width, height);

      const px = pointer.current.x * 10;
      const py = pointer.current.y * 10;

      // ── 星云：两团紫色电离气体辉光 ──
      // 透明度刻意压得很低：它是「空气感」，一旦看得清形状就毁掉星空的真实感。
      const nebula = (cx: number, cy: number, radius: number, alpha: number) => {
        const x = cx * width + px * 0.4;
        const y = cy * height + py * 0.4;
        const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
        g.addColorStop(0, `rgba(139, 107, 255, ${alpha})`);
        g.addColorStop(0.45, `rgba(109, 74, 255, ${alpha * 0.35})`);
        g.addColorStop(1, "rgba(109, 74, 255, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      };
      const breathe = reduceMotion ? 0 : Math.sin(t * 0.18) * 0.018;
      nebula(0.78, 0.22, Math.max(width, height) * 0.6, 0.1 + breathe);
      nebula(0.16, 0.86, Math.max(width, height) * 0.46, 0.08 + breathe);

      // ── 银河带 ──
      // 关键：渐变方向要**垂直于**带子，两端透明。
      // 早先用沿带方向的渐变 + 硬边矩形，结果是一条边缘笔直的半透明长条，
      // 一眼就看出是画上去的几何图形。真实银河的边缘是渐隐的。
      ctx.save();
      ctx.translate(width * 0.5, height * 0.46);
      ctx.rotate(-0.34);
      const bandHalf = height * 0.21;
      const bandGrad = ctx.createLinearGradient(0, -bandHalf, 0, bandHalf);
      bandGrad.addColorStop(0, "rgba(170, 191, 255, 0)");
      bandGrad.addColorStop(0.36, "rgba(186, 205, 255, 0.05)");
      bandGrad.addColorStop(0.5, "rgba(214, 224, 255, 0.082)");
      bandGrad.addColorStop(0.64, "rgba(255, 243, 224, 0.045)");
      bandGrad.addColorStop(1, "rgba(255, 243, 224, 0)");
      ctx.fillStyle = bandGrad;
      ctx.fillRect(-width, -bandHalf, width * 2, bandHalf * 2);
      ctx.restore();

      // ── 星点 ──
      for (const s of stars) {
        const twinkle = reduceMotion ? 0.86 : 0.64 + 0.36 * Math.sin(t * 0.85 + s.phase);
        const alpha = (0.3 + s.depth * 0.66) * twinkle;
        const x = s.x * width + px * s.depth;
        const y = s.y * height + py * s.depth;
        const c = palette[s.spectral] ?? palette[1]!;

        ctx.fillStyle = rgba(c, alpha);

        if (s.r < 0.9) {
          ctx.fillRect(x, y, 1, 1);
        } else {
          ctx.beginPath();
          ctx.arc(x, y, s.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ── 亮星：辉光 + 十字星芒 ──
      for (const a of BRIGHT_ANCHORS) {
        const c = palette[a.spectral] ?? palette[1]!;
        const x = a.x * width + px * 0.85;
        const y = a.y * height + py * 0.85;
        const pulse = reduceMotion ? 0.55 : 0.42 + 0.22 * Math.sin(t * 0.6 + a.x * 11);
        const halo = 52 * a.scale;

        const g = ctx.createRadialGradient(x, y, 0, x, y, halo);
        g.addColorStop(0, rgba(c, pulse * 0.72));
        g.addColorStop(0.28, rgba(c, pulse * 0.22));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - halo, y - halo, halo * 2, halo * 2);

        ctx.strokeStyle = rgba(c, pulse * 0.5);
        ctx.lineWidth = 1;
        const spike = 13 * a.scale;
        ctx.beginPath();
        ctx.moveTo(x - spike, y);
        ctx.lineTo(x + spike, y);
        ctx.moveTo(x, y - spike);
        ctx.lineTo(x, y + spike);
        ctx.stroke();

        ctx.fillStyle = rgba(c, 0.95);
        ctx.beginPath();
        ctx.arc(x, y, 1.5 * a.scale, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.current = {
        x: ((e.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2,
        y: ((e.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2,
      };
    };

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        start = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };

    resize();
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
