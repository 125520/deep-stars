"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { nextSortOrder } from "@/lib/todos";

/**
 * 待办的写操作
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ **每一条都必须把 userId 写进 where 条件里。**
 *
 * 常见的写法是"先按 id 查出来，判断 userId 对不对，再更新"——
 * 那有两个问题：多一次往返，而且在查与改之间留了一个可乘之机。
 * 直接把 `{ id, userId }` 一起放进 where，数据库层面就不会命中别人的行，
 * 命中 0 行时静默返回，连"这条不属于你"都不必告诉对方。
 *
 * id 是 cuid、确实不好猜 —— 但**"不好猜"不是访问控制**。
 */

export type TodoState = { ok: true } | { ok: false; error: string } | null;

const MAX_TITLE = 200;

const PATH = "/todos";

export async function createTodo(_prev: TodoState, formData: FormData): Promise<TodoState> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "登录状态已过期，请重新登录。" };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, error: "写点什么再添加。" };
  if (title.length > MAX_TITLE) {
    return { ok: false, error: `太长了（上限 ${MAX_TITLE} 字）。` };
  }

  const userId = session.user.id;
  const existing = await prisma.todo.findMany({
    where: { userId },
    select: { sortOrder: true },
  });

  await prisma.todo.create({
    data: { userId, title, sortOrder: nextSortOrder(existing.map((t) => t.sortOrder)) },
  });

  revalidatePath(PATH);
  return { ok: true };
}

export async function toggleTodo(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!session) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const userId = session.user.id;

  // 读也带上 userId：读不到就直接返回，不泄露"这个 id 存在但不属于你"
  const todo = await prisma.todo.findFirst({
    where: { id, userId },
    select: { completed: true },
  });
  if (!todo) return;

  /*
    写同样带上 userId（用 updateMany 而不是 update）。
    两次都带是刻意的冗余：万一将来有人把上面那次查询删掉，
    这次写入仍然改不到别人的数据。
  */
  await prisma.todo.updateMany({
    where: { id, userId },
    data: { completed: !todo.completed },
  });

  revalidatePath(PATH);
}

/** deleteMany 而不是 delete —— 只有批量版本才接受 userId 之外的过滤条件 */
export async function deleteTodo(formData: FormData): Promise<void> {
  const session = await requireSession();
  if (!session) return;

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await prisma.todo.deleteMany({ where: { id, userId: session.user.id } });
  revalidatePath(PATH);
}

export async function clearCompletedTodos(): Promise<void> {
  const session = await requireSession();
  if (!session) return;

  await prisma.todo.deleteMany({ where: { userId: session.user.id, completed: true } });
  revalidatePath(PATH);
}
