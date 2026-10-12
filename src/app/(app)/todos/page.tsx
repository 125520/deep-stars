import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ListChecks } from "lucide-react";

import TodoList, { type TodoItem } from "@/components/todo-list";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { clearCompletedTodos } from "@/lib/actions/todo";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { partitionByCompletion, sortTodos } from "@/lib/todos";

export const metadata: Metadata = { title: "待办" };

/** 每次都读数据库，不能静态化 */
export const dynamic = "force-dynamic";

export default async function TodosPage() {
  const session = await requireSession();
  if (!session) redirect("/login");

  const rows = await prisma.todo.findMany({
    where: { userId: session.user.id },
    select: { id: true, title: true, completed: true, sortOrder: true, createdAt: true },
  });

  // 排序与分组都走领域层：那里的规则有测试覆盖，
  // 在页面里现写一遍 sort 迟早会和它对不上
  const { open, done } = partitionByCompletion(sortTodos(rows));

  const toItem = (t: (typeof rows)[number]): TodoItem => ({
    id: t.id,
    title: t.title,
    completed: t.completed,
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <Badge tone="violet">
            <ListChecks className="size-3" />
            待办
          </Badge>
          <h1 className="mt-4 text-[26px] leading-[1.2] font-semibold tracking-[-0.015em] text-ink">
            今天要清掉的碎片
          </h1>
          <p className="mt-3 max-w-lg text-[14px] text-ink-muted text-pretty">
            计划之外临时冒出来的事放这里。它不进星图 —— 星图只留给真正的专注。
          </p>
        </div>

        {done.length > 0 && (
          <form action={clearCompletedTodos} className="shrink-0 pb-1">
            <button
              type="submit"
              className="text-[12.5px] text-ink-dim transition-colors hover:text-danger"
            >
              清空已完成（{done.length}）
            </button>
          </form>
        )}
      </header>

      <Card className="px-6 py-6">
        <TodoList open={open.map(toItem)} done={done.map(toItem)} />
      </Card>
    </main>
  );
}
