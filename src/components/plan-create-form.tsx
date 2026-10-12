"use client";

import * as React from "react";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { createPlan, type PlanState } from "@/lib/actions/plan";

/**
 * 新建计划
 *
 * 只有三个字段。计划文档（Markdown）是可选的 ——
 * 很多人的计划就是"三个月内把这本书过完"，先逼他写一份文档
 * 只会让人在第一步就放弃。文档留给 AI 拆任务用，需要时再补。
 */
export default function PlanCreateForm() {
  const [open, setOpen] = React.useState(false);
  const [state, formAction, pending] = React.useActionState<PlanState, FormData>(createPlan, null);

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        新建计划
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="plan-name">计划名称</Label>
        <Input
          id="plan-name"
          name="name"
          required
          maxLength={80}
          autoFocus
          placeholder="例如：三个月啃完线性代数"
        />
      </div>
      <div>
        <Label htmlFor="plan-goal">目标（可选）</Label>
        <Input id="plan-goal" name="goal" maxLength={200} placeholder="想达到什么程度" />
      </div>
      <div>
        <Label htmlFor="plan-document">计划文档（可选，Markdown）</Label>
        <Textarea
          id="plan-document"
          name="document"
          rows={4}
          maxLength={20000}
          placeholder="把计划的细节写在这里。后面接入 AI 之后，它会按这份文档帮你拆任务。"
        />
      </div>

      <p role="status" aria-live="polite" className="min-h-[18px] text-[12.5px] text-danger">
        {state?.ok === false ? state.error : ""}
      </p>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          创建
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          取消
        </Button>
      </div>
    </form>
  );
}
