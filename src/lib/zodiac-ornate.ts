/**
 * 星座「复杂档」
 * ══════════════════════════════════════════════════════════════════
 *
 * 现有的两档是 `simple`（5~7 枚，主要亮星）与 `full`（9~14 枚）。
 * 这一档把星点数补到 30 个左右，用于「点亮过程中更明显地看出星座图案」。
 *
 * ── 为什么是采样，而不是补真实暗星 ──────────────────────────────
 *
 * 补真实暗星当然更好，但那需要逐个星座查星表、核对赤经赤纬与中文星名，
 * 是一个独立的、以"天文准确性"为目标的活儿。而这一档的目标是**视觉效果**：
 * 让轮廓在点亮过程中越来越清楚、整张图更饱满大气。
 *
 * 所以新增的点**沿现有连线等距采样** —— 它们精确落在星座的轮廓上，
 * 于是星点越多、轮廓越亮越清晰，而不是在旁边散出一片无意义的点。
 * 这也带来两个好处：
 *   · `full` 的每一颗星**坐标逐位不变**（只是被插入了新的邻居），
 *     用户从完整档升到复杂档时，已经点亮的星不会挪位；
 *   · 无需新增连线 —— 新点本来就落在已有的线上。
 *
 * ── 一处诚实说明 ────────────────────────────────────────────────
 *
 * 新增的点是**轮廓上的采样点，不是真实恒星**。它们的星等取暗档（0.18~0.34），
 * 在视觉上读作"这条线上还有更暗的星"，与真实星座图的观感一致；
 * 但它们没有中文星名，也不该被当作天文数据引用。
 */

import type { ZodiacPattern, ZodiacSign, ZodiacStar } from "./zodiac.ts";

export type ZodiacComplexity = "simple" | "full" | "ornate";

/** 复杂档的目标星点数。原要求是「30 个左右」，允许各星座略有出入。 */
export const ORNATE_TARGET = 30;

const clamp01 = (v: number) => Math.min(0.94, Math.max(0.06, v));

/** 两点距离 */
function dist(a: ZodiacStar, b: ZodiacStar): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * 由 `full` 生成复杂档。
 *
 * 做法：把 `full.stars` 当作一条按点亮顺序走的路径，按各段长度**成比例**地
 * 往每段里插点，直到总数接近 target。按长度分配而不是每段平均分，
 * 是因为各段长短悬殊 —— 平均分会让长段上的点稀疏、短段上的点挤成一坨。
 *
 * 插进来的点**不改变原有星的坐标**，只把它们的下标往后推，所以 `links`
 * 要跟着重映射。新点落在已有的线上，因此不需要为它们新增连线。
 */
export function ornatePattern(sign: ZodiacSign, target: number = ORNATE_TARGET): ZodiacPattern {
  const base = sign.full.stars;
  const want = Math.max(base.length, Math.trunc(target));

  if (base.length < 2 || want <= base.length) {
    return { stars: [...base], links: sign.full.links.map(([a, b]) => [a, b] as [number, number]) };
  }

  // 各段长度与总长
  const segLen: number[] = [];
  for (let i = 0; i < base.length - 1; i += 1) segLen.push(dist(base[i]!, base[i + 1]!));
  const total = segLen.reduce((s, n) => s + n, 0);

  const extras = want - base.length;

  /*
    先按长度比例算每段该插几个，再把因为取整而多出/少掉的名额
    补给"当前密度最低"的段 —— 否则总数会与目标差几个。
  */
  const counts = segLen.map((len) => (total > 0 ? Math.floor((len / total) * extras) : 0));
  let assigned = counts.reduce((s, n) => s + n, 0);
  while (assigned < extras && segLen.length > 0) {
    let best = 0;
    let bestDensity = Infinity;
    for (let i = 0; i < segLen.length; i += 1) {
      const density = segLen[i]! / (counts[i]! + 1);
      if (density < bestDensity) {
        bestDensity = density;
        best = i;
      }
    }
    counts[best] = (counts[best] ?? 0) + 1;
    assigned += 1;
  }

  // 组装：原星与其间插入的采样点交替出现
  const stars: ZodiacStar[] = [];
  const remap = new Map<number, number>();

  for (let i = 0; i < base.length; i += 1) {
    remap.set(i, stars.length);
    stars.push({ ...base[i]! });

    const k = counts[i] ?? 0;
    if (k <= 0) continue;

    const a = base[i]!;
    const b = base[i + 1];
    if (!b) break;

    for (let j = 1; j <= k; j += 1) {
      const t = j / (k + 1);
      // 星等取暗档，并让靠近两端的那几颗略暗一点点，读起来更自然
      const magnitude = 0.18 + 0.16 * Math.sin(Math.PI * t);
      stars.push({
        x: clamp01(a.x + (b.x - a.x) * t),
        y: clamp01(a.y + (b.y - a.y) * t),
        magnitude: Math.round(magnitude * 100) / 100,
      });
    }
  }

  return {
    stars,
    links: sign.full.links.map(([a, b]) => [remap.get(a) ?? a, remap.get(b) ?? b] as [number, number]),
  };
}

/**
 * 按档位取布局。
 *
 * **无法识别的值一律回退到 `full`**，不抛错 —— 数据库里存着用户选过的档位，
 * 将来若改了命名或删了某一档，老数据不该让页面直接崩掉。
 */
export function patternFor(sign: ZodiacSign, complexity: string | null | undefined): ZodiacPattern {
  if (complexity === "simple") return sign.simple;
  if (complexity === "ornate") return ornatePattern(sign);
  return sign.full;
}

/** 三档各自的中文说明，界面直接用 */
export const COMPLEXITY_LABELS: Record<ZodiacComplexity, { name: string; hint: string }> = {
  simple: { name: "简约", hint: "只留最亮的几颗，适合小目标" },
  full: { name: "完整", hint: "标准星座形状" },
  ornate: { name: "繁复", hint: "约 30 枚星，轮廓最清楚" },
};
