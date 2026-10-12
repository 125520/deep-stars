"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

/**
 * 通知的写操作
 * ══════════════════════════════════════════════════════════════════
 *
 * 这里**只放真正的用户动作**（标记已读 / 删除），每一条都自己读会话、
 * 并把 userId 写进 where。
 *
 * ⚠️ 不要往这个文件里加 `syncNotifications(userId)` 这类"接收用户身份作为参数"
 * 的函数 —— `"use server"` 文件里的每个导出都是**可被直接调用的端点**，
 * 带 userId 参数就等于把"往谁账号里写"的决定权交给了调用方。
 * 那类内部函数放在 src/lib/notifications-server.ts（不带 "use server"）。
 */

/** 标记单条已读 */
export async function markRead(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!session) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // updateMany 才接受 userId 之外的过滤条件；改别人的通知本来也无意义
  await prisma.notification.updateMany({
    where: { id, userId: session.user.id },
    data: { read: true },
  });
  revalidatePath("/notifications");
}

/** 全部标记已读 */
export async function markAllRead(): Promise<void> {
  const session = await requireSession();
  if (!session) return;

  await prisma.notification.updateMany({
    where: { userId: session.user.id, read: false },
    data: { read: true },
  });
  revalidatePath("/notifications");
}

/** 删除一条 */
export async function deleteNotification(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!session) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.notification.deleteMany({ where: { id, userId: session.user.id } });
  revalidatePath("/notifications");
}
