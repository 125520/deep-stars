"use client";

import * as React from "react";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { createCheckin, type CheckinState } from "@/lib/actions/checkin";

/**
 * 打卡表单
 * ══════════════════════════════════════════════════════════════════
 *
 * 用 useActionState 接 Server Action 的返回值。
 * 不用自己 fetch /api/checkins：那样要手写一遍状态机（pending / error /
 * 成功后重置），而 useActionState 已经把这套做完了，且和表单的
 * progressive enhancement 是配套的。
 */

const MOODS = [
  { value: "1", label: "很累" },
  { value: "2", label: "一般" },
  { value: "3", label: "还行" },
  { value: "4", label: "不错" },
  { value: "5", label: "很好" },
] as const;

/** 本地时区的今天，YYYY-MM-DD —— <input type="date"> 要的格式 */
function todayLocal(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default function CheckinForm() {
  const [state, formAction, pending] = React.useActionState<CheckinState, FormData>(
    createCheckin,
    null,
  );
  const formRef = React.useRef<HTMLFormElement>(null);

  // 成功后清空输入，方便连着记第二次；失败时保留内容，别让用户白打一遍
  React.useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="content">今天做了什么</Label>
        <Textarea
          id="content"
          name="content"
          required
          rows={3}
          maxLength={2000}
          placeholder="一句话就够。连续的天数会连成星座。"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="hours">专注时长（小时）</Label>
          <Input
            id="hours"
            name="hours"
            type="number"
            min={0}
            max={24}
            step={0.5}
            defaultValue={1}
            inputMode="decimal"
          />
        </div>
        <div>
          <Label htmlFor="subject">科目 / 主题（可选）</Label>
          <Input id="subject" name="subject" type="text" maxLength={40} placeholder="例如：线性代数" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="date">日期</Label>
          {/* 默认今天，但允许改 —— 补录昨天的记录是真实需求 */}
          <Input id="date" name="date" type="date" defaultValue={todayLocal()} />
        </div>
        <div>
          <Label htmlFor="mood">今天的状态</Label>
          <select
            id="mood"
            name="mood"
            defaultValue="3"
            className="h-10 w-full rounded-xl border border-line-2 bg-canvas px-3 text-sm text-ink transition-[border-color,box-shadow] duration-200 hover:border-violet-200 focus:border-violet-500 focus:ring-4 focus:ring-violet-500/12 focus:outline-none"
          >
            {MOODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/*
        状态区固定高度：成功与失败都占用同一块空间，
        否则提示出现时整个表单会往下跳一行，正在填的字段会移位。
      */}
      <p
        role="status"
        aria-live="polite"
        className="min-h-[18px] text-[12.5px]"
      >
        {state?.ok === false && <span className="text-danger">{state.error}</span>}
        {state?.ok === true && (
          <span className="text-violet-300">
            <Sparkles className="mr-1 inline size-3.5 align-[-2px]" />
            星图上新亮了一枚星（星等 {state.magnitude.toFixed(2)}）
          </span>
        )}
      </p>

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending && <Loader2 className="size-4 animate-spin" />}
        {pending ? "正在点亮…" : "点亮今天的星"}
      </Button>
    </form>
  );
}
