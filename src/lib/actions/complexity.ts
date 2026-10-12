"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { patternFor, type ZodiacComplexity } from "@/lib/zodiac-ornate";
import { ZODIAC_SIGNS } from "@/lib/zodiac";

/**
 * 换当前星座的详略档
 * ══════════════════════════════════════════════════════════════════
 *
 * 允许随时切换，包括点亮到一半的时候。两条理由：
 *
 *   · 三档是**同一条轮廓的不同密度**（复杂档由完整档沿连线采样而来，
 *     简单的星坐标逐位不变），所以换档之后"已经点亮几枚"这件事仍然成立；
 *   · 卡在一半时想换个更明显的图案看看，是很自然的需求，
 *     为此要求用户先画满再重来一遍反而荒谬。
 *
 * **已经点亮的星会按新档位重新落位。** 这是有意的：星点的位置是
 * 「第几枚」的函数，换了模板就该按新模板排。用户看到的是同一个星座
 * 变得更密或更疏，而不是自己的记录被改动 —— 打卡记录一条都没动。
 */

export type SetComplexityState =
  | { ok: true; complexity: ZodiacComplexity }
  | { ok: false; error: string }
  | null;

export async function setConstellationComplexity(
  _prev: SetComplexityState,
  formData: FormData,
): Promise<SetComplexityState> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "登录状态已过期，请重新登录。" };

  const raw = String(formData.get("complexity") ?? "").trim();
  if (raw !== "simple" && raw !== "full" && raw !== "ornate") {
    return { ok: false, error: "没有这个档位。" };
  }
  const complexity: ZodiacComplexity = raw;

  const userId = session.user.id;
  const current = await prisma.constellation.findFirst({
    where: { userId, archived: false },
    orderBy: { createdAt: "asc" },
    select: { id: true, sign: true },
  });
  if (!current) return { ok: false, error: "还没有星图。" };

  const sign = current.sign ? ZODIAC_SIGNS.find((s) => s.key === current.sign) : null;
  if (!sign) return { ok: false, error: "这个星座没有可选档位。" };

  const pattern = patternFor(sign, complexity);
  const stars = await prisma.star.findMany({
    where: { constellationId: current.id },
    orderBy: { litAt: "asc" },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.constellation.update({ where: { id: current.id }, data: { complexity } }),
    // 按新档位重新落位。超出新模板长度的星退回黄金角散点（与打卡时的规则一致）
    ...stars.map((star, i) =>
      prisma.star.update({
        where: { id: star.id },
        data: (() => {
          const p = pattern.stars[i];
          return p ? { x: p.x, y: p.y } : {};
        })(),
      }),
    ),
  ]);

  revalidatePath("/dashboard");
  return { ok: true, complexity };
}
