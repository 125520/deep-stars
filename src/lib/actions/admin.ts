"use server";

import { revalidatePath } from "next/cache";

import { canPromote, canRestrict, isAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { readUserFlags, requireSession } from "@/lib/session";

/**
 * 管理后台的写操作
 * ══════════════════════════════════════════════════════════════════
 *
 * ── 三条纪律 ────────────────────────────────────────────────────
 *
 * 1. **每次调用都重新校验管理员身份。** 不能只靠页面入口把关 ——
 *    Server Action 是一个可以被直接调用的端点，页面上藏起按钮不等于关掉了入口。
 *
 * 2. **约束来自 lib/admin.ts 的纯函数**，而不是散落在这里的 if。
 *    那里有测试，覆盖了"对自己动手"与"最后一个管理员"两条锁死路径。
 *
 * 3. **计数与读取放在同一次查询里**，避免"读到 2 个管理员、实际只剩 1 个"的竞态。
 */

export type AdminState = { ok: true; message: string } | { ok: false; error: string } | null;

/**
 * 读取当前会话并确认管理员身份。
 *
 * 用**同一个** session 对象做判断与取邮箱：分两次读会在大约
 * "会话刚过期"的窗口里出现判断通过但邮箱为空的情况。
 */
async function requireAdmin() {
  const session = await requireSession();
  if (!session) return { ok: false as const, error: "登录状态已过期，请重新登录。" };

  // role 现查（见 lib/auth.ts 里为什么不放进 additionalFields）
  const flags = await readUserFlags();
  if (flags?.banned) return { ok: false as const, error: "没有权限。" };

  const user = { email: session.user.email, role: flags?.role };
  if (!isAdminUser(user, process.env.DEEP_STARS_ADMIN_EMAIL)) {
    return { ok: false as const, error: "没有权限。" };
  }
  return { ok: true as const, email: session.user.email };
}

/** 读取目标用户 + 当前管理员总数。两者放在一起查，减少不一致的窗口。 */
async function loadTarget(targetId: string) {
  const [target, adminCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, email: true, role: true, banned: true },
    }),
    prisma.user.count({ where: { role: "admin" } }),
  ]);
  return { target, adminCount };
}

export async function setUserRole(formData: FormData): Promise<void> {
  const actor = await requireAdmin();
  if (!actor.ok) return;

  const targetId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!targetId || !["admin", "user"].includes(role)) return;

  const { target, adminCount } = await loadTarget(targetId);
  if (!target) return;

  if (role === "admin") {
    const check = canPromote(target);
    if (!check.ok) return;
  } else {
    const check = canRestrict(actor.email, target, adminCount);
    if (!check.ok) return;
  }

  await prisma.user.update({ where: { id: target.id }, data: { role } });
  revalidatePath("/admin");
}

export async function setUserBanned(formData: FormData): Promise<void> {
  const actor = await requireAdmin();
  if (!actor.ok) return;

  const targetId = String(formData.get("userId") ?? "");
  const banned = String(formData.get("banned") ?? "") === "1";
  if (!targetId) return;

  const { target, adminCount } = await loadTarget(targetId);
  if (!target) return;

  // 解封不需要约束；封禁才需要（它削弱权限）
  if (banned) {
    const check = canRestrict(actor.email, target, adminCount);
    if (!check.ok) return;
  }

  await prisma.user.update({ where: { id: target.id }, data: { banned } });

  /*
    封禁之后必须**踢掉他现有的会话**。
    否则被封的人凭着手里的 cookie 还能继续用到会话过期 ——
    最长 30 天，那等于封禁没生效。
  */
  if (banned) {
    await prisma.session.deleteMany({ where: { userId: target.id } });
  }

  revalidatePath("/admin");
}
