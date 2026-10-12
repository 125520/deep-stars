"use client";

import * as React from "react";
import { Layers } from "lucide-react";

import { setConstellationComplexity, type SetComplexityState } from "@/lib/actions/complexity";
import { cn } from "@/lib/utils";
import { COMPLEXITY_LABELS, type ZodiacComplexity } from "@/lib/zodiac-ornate";

/**
 * 星图详略档切换
 * ══════════════════════════════════════════════════════════════════
 *
 * 放在星图旁边（打卡页与公开页都合适，后者只读所以传 readonly）。
 *
 * 三档是**同一条轮廓的不同密度**：简约只留最亮的几颗，完整是标准形状，
 * 繁复约 30 枚、轮廓最清楚。想看清图案就选繁复，想快点画满就选简约。
 *
 * 已在用 `useActionState` 接 Server Action，理由与打卡表单一致：
 * 不必手写 pending / error 这套状态机。
 */
export default function ComplexitySwitch({
  current,
  signName,
  available,
}: {
  current: ZodiacComplexity;
  signName: string;
  /** 这个星座实际可选的档位。星座不同、star 数不同，界面就跟着变 */
  available: readonly ZodiacComplexity[];
}) {
  const [state, formAction, pending] = React.useActionState<SetComplexityState, FormData>(
    setConstellationComplexity,
    null,
  );
  const active = state?.ok ? state.complexity : current;

  return (
    <div className="rounded-xl border border-line-2 bg-surface-2/60 px-4 py-3">
      <p className="flex items-center gap-1.5 text-[12.5px] text-ink-muted">
        <Layers className="size-3.5 text-violet-300" />
        「{signName}」的详略
      </p>

      <form action={formAction} className="mt-2.5 flex flex-wrap gap-2">
        {available.map((key) => {
          const label = COMPLEXITY_LABELS[key];
          const on = key === active;
          return (
            <button
              key={key}
              type="submit"
              name="complexity"
              value={key}
              disabled={pending || on}
              title={label.hint}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-[12.5px] transition-colors",
                on
                  ? "border-violet-400/70 bg-violet-500/15 text-ink"
                  : "border-line-2 bg-canvas text-ink-muted hover:border-violet-400 hover:text-ink",
                "disabled:cursor-default",
              )}
            >
              {label.name}
            </button>
          );
        })}
      </form>

      <p className="mt-2 text-[11.5px] text-ink-dim">
        {COMPLEXITY_LABELS[active].hint}
        {pending && " · 正在切换…"}
      </p>

      {state?.ok === false && (
        <p role="status" aria-live="polite" className="mt-1.5 text-[12px] text-danger">
          {state.error}
        </p>
      )}
    </div>
  );
}
