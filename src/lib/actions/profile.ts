"use server";

import { revalidatePath } from "next/cache";

import { profilePath, validateHandle } from "@/lib/handle";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

/**
 * 个人资料与公开主页设置
 * ══════════════════════════════════════════════════════════════════
 *
 * ── 两条判断 ────────────────────────────────────────────────────
 *
 * 1. **用户名留空表示"不改"，不表示"清空"。**
 *    用户改简介时顺手把用户名框清掉是常见动作；如果那等于清空，
 *    他的公开主页会突然 404。要取消公开应该用开关，不是删名字。
 *
 * 2. **公开主页必须有用户名。** 没有名字就没有地址，开了开关也访问不到 ——
 *    那种"显示已开启但打不开"的状态比直接报错糟得多。
 */

export type ProfileState = { ok: true; message: string } | { ok: false; error: string } | null;

const MAX_BIO = 300;

/**
 * 判断是不是唯一约束冲突。
 *
 * 用结构判断而不是 `instanceof PrismaClientKnownRequestError`：
 * 生成的客户端在不同输出路径下可能有两份类定义，
 * instanceof 会**静默地**判成 false，于是冲突被当成未知错误抛出去，
 * 用户看到的是 500 而不是"这个名字被占用了"。
 */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "P2002";
}

export async function updateProfile(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "登录状态已过期，请重新登录。" };

  const userId = session.user.id;

  const rawHandle = String(formData.get("handle") ?? "");
  let submitted: string | null = null;
  if (rawHandle.trim()) {
    const check = validateHandle(rawHandle);
    if (!check.ok) return { ok: false, error: check.error };
    submitted = check.handle;
  }

  const bio = String(formData.get("bio") ?? "").trim() || null;
  if (bio && bio.length > MAX_BIO) {
    return { ok: false, error: `简介太长了（上限 ${MAX_BIO} 字）。` };
  }

  const isPublic = formData.get("isPublic") === "on";

  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { handle: true },
  });

  // 留空 = 保持原样（见文件头的判断 1）
  const nextHandle = submitted ?? current?.handle ?? null;

  if (isPublic && !nextHandle) {
    return { ok: false, error: "要公开主页，得先有一个用户名。" };
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { handle: nextHandle, bio, isPublic },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: "这个用户名已经被占用了，换一个吧。" };
    }
    throw error;
  }

  revalidatePath("/settings");
  // 公开页也要刷新，否则改完名字旧地址还能打开
  if (nextHandle) revalidatePath(profilePath(nextHandle));

  return {
    ok: true,
    message: isPublic
      ? nextHandle
        ? `已保存。公开主页：${profilePath(nextHandle)}`
        : "已保存。"
      : "已保存。公开主页当前是关闭的。",
  };
}
