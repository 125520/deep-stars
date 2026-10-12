"use client";

import * as React from "react";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createTodo, deleteTodo, toggleTodo, type TodoState } from "@/lib/actions/todo";
import { cn } from "@/lib/utils";

/**
 * 待办列表
 * ══════════════════════════════════════════════════════════════════
 *
 * 勾选与删除用「每个条目一个 form」而不是给整页挂一个。
 * 一个 form 里塞多个按钮要区分是哪个条目（靠 name/value 或隐藏字段），
 * 拆开之后每条提交自己那一个 id，语义直白、也不需要额外的状态管理。
 */

export type TodoItem = {
  id: string;
  title: string;
  completed: boolean;
};

export default function TodoList({
  open,
  done,
}: {
  open: readonly TodoItem[];
  done: readonly TodoItem[];
}) {
  const [state, formAction, pending] = React.useActionState<TodoState, FormData>(
    createTodo,
    null,
  );
  const formRef = React.useRef<HTMLFormElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      // 连着加几条是常态，焦点留在输入框里省得每次重新点
      inputRef.current?.focus();
    }
  }, [state]);

  return (
    <div className="flex flex-col gap-6">
      <form ref={formRef} action={formAction} className="flex gap-2">
        <Input
          ref={inputRef}
          name="title"
          required
          maxLength={200}
          placeholder="下一件要做的事…"
          aria-label="新的待办"
        />
        <Button type="submit" disabled={pending} className="shrink-0">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          添加
        </Button>
      </form>

      <p role="status" aria-live="polite" className="min-h-[18px] text-[12.5px] text-danger">
        {state?.ok === false ? state.error : ""}
      </p>

      <Section title="未完成" items={open} empty="没有待办。加一条试试。" />
      {done.length > 0 && <Section title="已完成" items={done} dimmed />}
    </div>
  );
}

function Section({
  title,
  items,
  empty,
  dimmed = false,
}: {
  title: string;
  items: readonly TodoItem[];
  empty?: string;
  dimmed?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-3 text-[12px] font-medium tracking-wide text-ink-dim">
        {title} · {items.length}
      </h2>
      {items.length === 0 ? (
        <p className="text-[13px] text-ink-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((todo) => (
            <li
              key={todo.id}
              className={cn(
                "group flex items-center gap-3 rounded-xl border border-line/70 px-3.5 py-2.5",
                "transition-colors hover:border-violet-400/40 hover:bg-surface/40",
              )}
            >
              <form action={toggleTodo} className="flex shrink-0">
                <input type="hidden" name="id" value={todo.id} />
                <button
                  type="submit"
                  aria-pressed={todo.completed}
                  aria-label={todo.completed ? `标记「${todo.title}」为未完成` : `完成「${todo.title}」`}
                  className={cn(
                    "grid size-[18px] place-items-center rounded-md border transition-all duration-200",
                    "hover:scale-110 active:scale-95",
                    todo.completed
                      ? "border-violet-500 bg-violet-500/80 text-white"
                      : "border-line-2 hover:border-violet-400",
                  )}
                >
                  {todo.completed && <Check className="size-3" strokeWidth={3} />}
                </button>
              </form>

              <span
                className={cn(
                  "min-w-0 flex-1 text-[13.5px] break-words",
                  // 已完成用 ink-muted 而不是 ink-dim：后者在深底上几乎看不见。
                  // **"弱化"与"看不见"是两回事** —— 用户仍然需要读它来确认自己完成了什么，
                  // 删除线已经足够表达"已完成"这个状态了。
                  dimmed ? "text-ink-muted line-through" : "text-ink",
                )}
              >
                {todo.title}
              </span>

              <form action={deleteTodo} className="flex shrink-0">
                <input type="hidden" name="id" value={todo.id} />
                <button
                  type="submit"
                  aria-label={`删除「${todo.title}」`}
                  className={cn(
                    "grid size-7 place-items-center rounded-lg text-ink-dim transition-all duration-200",
                    // 桌面端悬停才浮现，触屏没有 hover 所以常驻半透明
                    "opacity-60 hover:bg-danger/12 hover:text-danger sm:opacity-0 sm:group-hover:opacity-100",
                  )}
                >
                  <Trash2 className="size-3.5" strokeWidth={2} />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
