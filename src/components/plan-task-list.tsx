"use client";

import * as React from "react";
import { Check, Loader2, Minus, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addTask, cycleTaskStatus, deleteTask, setTaskStatus, type PlanState } from "@/lib/actions/plan";
import { normalizeTaskStatus, type TaskStatus } from "@/lib/plans";
import { cn } from "@/lib/utils";

/**
 * 计划任务列表
 * ══════════════════════════════════════════════════════════════════
 *
 * 点一下状态图标就循环切换（待开始 → 进行中 → 已完成 → 待开始）。
 * 不用下拉框：任务状态是高频动作，多一次点击（展开菜单、选中）
 * 在几十条任务上就是几十次多余操作。
 */

export type PlanTaskItem = {
  id: string;
  title: string;
  status: string;
  dayNumber: number | null;
};

const STATUS_STYLE: Record<TaskStatus, { icon: React.ReactNode; box: string; text: string }> = {
  pending: {
    icon: null,
    box: "border-line-2 hover:border-violet-400",
    text: "text-ink",
  },
  doing: {
    icon: <span className="block size-2 rounded-full bg-white" />,
    box: "border-violet-400 bg-violet-500/70",
    text: "text-ink",
  },
  done: {
    icon: <Check className="size-3" strokeWidth={3} />,
    box: "border-violet-500 bg-violet-500 text-white",
    text: "text-ink-muted line-through",
  },
  skipped: {
    icon: <Minus className="size-3" strokeWidth={3} />,
    box: "border-line-2 text-ink-dim",
    text: "text-ink-dim line-through",
  },
};

export default function PlanTaskList({
  planId,
  groups,
}: {
  planId: string;
  groups: readonly { day: number | null; items: readonly PlanTaskItem[] }[];
}) {
  const [state, formAction, pending] = React.useActionState<PlanState, FormData>(addTask, null);
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  const empty = groups.every((g) => g.items.length === 0);

  return (
    <div className="flex flex-col gap-5">
      <form ref={formRef} action={formAction} className="flex gap-2">
        <input type="hidden" name="planId" value={planId} />
        <Input name="title" required maxLength={200} placeholder="加一项任务…" aria-label="新任务" />
        <Input
          name="dayNumber"
          type="number"
          min={1}
          max={365}
          placeholder="第几天"
          aria-label="第几天（可留空）"
          className="w-24 shrink-0"
        />
        <Button type="submit" disabled={pending} className="shrink-0">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          添加
        </Button>
      </form>

      <p role="status" aria-live="polite" className="min-h-[18px] text-[12.5px] text-danger">
        {state?.ok === false ? state.error : ""}
      </p>

      {empty && <p className="text-[13px] text-ink-muted">还没有任务。加一项试试。</p>}

      {groups.map((group) => (
        <section key={group.day ?? "unscheduled"}>
          <h3 className="mb-2.5 text-[11.5px] font-medium tracking-wide text-ink-dim">
            {group.day === null ? "未排期" : `第 ${group.day} 天`} · {group.items.length}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {group.items.map((task) => {
              const status = normalizeTaskStatus(task.status);
              const style = STATUS_STYLE[status];
              return (
                <li
                  key={task.id}
                  className="group flex items-center gap-3 rounded-xl border border-line/70 px-3.5 py-2.5 transition-colors hover:border-violet-400/40 hover:bg-surface/40"
                >
                  <form action={cycleTaskStatus} className="flex shrink-0">
                    <input type="hidden" name="taskId" value={task.id} />
                    <button
                      type="submit"
                      aria-label={`${task.title}（当前：${status}）`}
                      className={cn(
                        "grid size-[18px] place-items-center rounded-md border transition-all duration-200",
                        "hover:scale-110 active:scale-95",
                        style.box,
                      )}
                    >
                      {style.icon}
                    </button>
                  </form>

                  <span className={cn("min-w-0 flex-1 text-[13.5px] break-words", style.text)}>
                    {task.title}
                  </span>

                  {/*
                    「跳过」必须有独立入口。
                    循环切换只有 待开始→进行中→已完成→待开始 三态，
                    而 skipped 是第四态 —— 领域模型和进度计算都依赖它，
                    界面上到不了就等于这个状态不存在，用户只能靠删任务来"了结"它，
                    而那会让进度分母白白变小。
                  */}
                  {(status === "pending" || status === "doing") && (
                    <form action={setTaskStatus} className="flex shrink-0">
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="status" value="skipped" />
                      <button
                        type="submit"
                        aria-label={`跳过任务「${task.title}」`}
                        className="rounded-lg px-2 py-1 text-[11.5px] text-ink-dim opacity-60 transition-all duration-200 hover:bg-surface-2 hover:text-ink-muted sm:opacity-0 sm:group-hover:opacity-100"
                      >
                        跳过
                      </button>
                    </form>
                  )}

                  <form action={deleteTask} className="flex shrink-0">
                    <input type="hidden" name="taskId" value={task.id} />
                    <button
                      type="submit"
                      aria-label={`删除任务「${task.title}」`}
                      className="grid size-7 place-items-center rounded-lg text-ink-dim opacity-60 transition-all duration-200 hover:bg-danger/12 hover:text-danger sm:opacity-0 sm:group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" strokeWidth={2} />
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
