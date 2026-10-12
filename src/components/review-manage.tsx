"use client";

import * as React from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { createCard, deleteCard, type ReviewState } from "@/lib/actions/review";
import { describeInterval } from "@/lib/srs";

/** 新建卡片 */
export function CardCreateForm() {
  const [state, formAction, pending] = React.useActionState<ReviewState, FormData>(
    createCard,
    null,
  );
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="front">正面（问题）</Label>
        <Textarea
          id="front"
          name="front"
          required
          rows={2}
          maxLength={2000}
          placeholder="例如：矩阵可逆的充要条件是什么？"
        />
      </div>
      <div>
        <Label htmlFor="back">背面（答案）</Label>
        <Textarea
          id="back"
          name="back"
          required
          rows={3}
          maxLength={2000}
          placeholder="行列式不为零。"
        />
      </div>
      <div>
        <Label htmlFor="tags">标签（可选）</Label>
        <Input id="tags" name="tags" maxLength={120} placeholder="线性代数, 概念" />
      </div>

      <p role="status" aria-live="polite" className="min-h-[18px] text-[12.5px]">
        {state?.ok === false && <span className="text-danger">{state.error}</span>}
        {state?.ok === true && <span className="text-violet-300">{state.message}</span>}
      </p>

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        加入队列
      </Button>
    </form>
  );
}

/** 卡片列表 */
export function CardList({
  items,
}: {
  items: readonly {
    id: string;
    front: string;
    tags: string | null;
    dueAt: Date;
    interval: number;
    reps: number;
  }[];
}) {
  if (items.length === 0) {
    return <p className="text-[13px] text-ink-muted">还没有卡片。</p>;
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => (
        <li
          key={item.id}
          className="group flex items-center gap-3 rounded-xl border border-line/70 px-3.5 py-2.5 transition-colors hover:border-violet-400/40 hover:bg-surface/40"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] text-ink">{item.front}</p>
            <p className="mt-0.5 truncate text-[11.5px] text-ink-dim">
              {item.tags ? `${item.tags} · ` : ""}
              {/* 复习过才显示间隔；新卡显示"待复习"更有意义 */}
              {item.reps === 0 ? "待首次复习" : describeInterval(item.interval)}
            </p>
          </div>

          <form action={deleteCard} className="flex shrink-0">
            <input type="hidden" name="cardId" value={item.id} />
            <button
              type="submit"
              aria-label={`删除卡片「${item.front}」`}
              className="grid size-7 place-items-center rounded-lg text-ink-dim opacity-60 transition-all duration-200 hover:bg-danger/12 hover:text-danger sm:opacity-0 sm:group-hover:opacity-100"
            >
              <Trash2 className="size-3.5" strokeWidth={2} />
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}
