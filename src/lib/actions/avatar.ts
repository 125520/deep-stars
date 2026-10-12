"use server";

import { revalidatePath } from "next/cache";

import { historyToPrune, validateAvatarDataUrl } from "@/lib/avatar";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

/**
 * 头像的保存与回滚
 * ══════════════════════════════════════════════════════════════════
 *
 * 头像存 **data URL**（见 schema 里 AvatarChange 的注释）：零对象存储，
 * Vercel 的只读文件系统也不会出问题。代价是它必须足够小 ——
 * 所以体积校验放在服务端**再跑一遍**（客户端那套压缩可以被绕过）。
 */

export type AvatarState = { ok: true; message: string } | { ok: false; error: string } | null;

export async function saveAvatar(_prev: AvatarState, formData: FormData): Promise<AvatarState> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "登录状态已过期，请重新登录。" };

  const raw = String(formData.get("image") ?? "");
  const check = validateAvatarDataUrl(raw);
  if (!check.ok) return { ok: false, error: check.error };

  const userId = session.user.id;

  await prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({
      where: { id: userId },
      select: { image: true },
    });

    // 换之前先把当前这张存进历史 —— 否则"一键回滚"根本无源可回
    if (current?.image) {
      await tx.avatarChange.create({ data: { userId, image: current.image } });
    }

    await tx.user.update({ where: { id: userId }, data: { image: raw } });

    /*
      裁剪历史。**必须带 userId**：deleteMany 的 where 由调用方给，
      漏掉它就会删到别人的记录。
    */
    const history = await tx.avatarChange.findMany({
      where: { userId },
      select: { id: true, createdAt: true },
    });
    const prune = historyToPrune(history);
    if (prune.length > 0) {
      await tx.avatarChange.deleteMany({ where: { id: { in: prune }, userId } });
    }
  });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  return { ok: true, message: "头像已更新。" };
}

/**
 * 回滚到上一张头像。
 *
 * 是**交换**而不是"弹出"：当前这张会进历史，所以回滚本身也可以再回滚 ——
 * 手滑点错不会把中间那张弄丢。
 */
export async function rollbackAvatar(): Promise<void> {
  const session = await requireSession();
  if (!session) return;

  const userId = session.user.id;

  await prisma.$transaction(async (tx) => {
    const [current, previous] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { image: true } }),
      tx.avatarChange.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { id: true, image: true },
      }),
    ]);

    if (!previous) return;

    if (current?.image) {
      await tx.avatarChange.create({ data: { userId, image: current.image } });
    }
    await tx.user.update({ where: { id: userId }, data: { image: previous.image } });
    await tx.avatarChange.deleteMany({ where: { id: previous.id, userId } });
  });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
}

/** 移除头像，回到首字母/图标占位 */
export async function deleteAvatar(): Promise<void> {
  const session = await requireSession();
  if (!session) return;

  const userId = session.user.id;

  await prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({
      where: { id: userId },
      select: { image: true },
    });
    // 与换头像一致：当前这张也进历史，删掉之后还能回滚回来
    if (current?.image) {
      await tx.avatarChange.create({ data: { userId, image: current.image } });
    }
    await tx.user.update({ where: { id: userId }, data: { image: null } });
  });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
}
