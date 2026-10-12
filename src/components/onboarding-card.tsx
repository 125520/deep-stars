"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { usePlanTemplate, type OnboardingState } from "@/lib/actions/onboarding";
import { ONBOARDING_STEPS } from "@/lib/onboarding";

/**
 * 新手引导
 * ══════════════════════════════════════════════════════════════════
 *
 * 只在"星图空着、也没有任何计划"时显示（判据见 lib/onboarding.ts）。
 * 用户一旦留下痕迹，它自己就消失了 —— 不需要一个 `onboarded` 字段，
 * 也不需要"关闭引导"的按钮。
 *
 * 除了介绍三步，还提供**从模板开始**：那三个模板本来就已经种进库里
 * （`pnpm db:seed`），但此前没有任何入口能用到它们。
 */

export type TemplateOption = {
  id: string;
  name: string;
  description: string | null;
  /** 模板文档里能解析出多少条任务，显示给用户看 */
  taskCount: number;
};

export default function OnboardingCard({ templates }: { templates: TemplateOption[] }) {
  const [state, formAction, pending] = React.useActionState<OnboardingState, FormData>(
    usePlanTemplate,
    null,
  );
  const [chosen, setChosen] = React.useState<string | null>(null);

  return (
    <Card className="px-6 py-6">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-violet-500/15 ring-1 ring-violet-400/25">
          <Sparkles className="size-4 text-violet-300" strokeWidth={2} />
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">
            从这里开始
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted text-pretty">
            三个入口，按你现在的状态挑一个。不用都做 ——
            <strong className="font-medium text-ink-muted">写下一句话就算开始了</strong>。
          </p>

          <ol className="mt-5 flex flex-col gap-2.5">
            {ONBOARDING_STEPS.map((step, index) => (
              <li key={step.href}>
                <Link
                  href={step.href}
                  className="group flex items-start gap-3 rounded-xl border border-line/70 px-4 py-3 transition-colors hover:border-violet-400/45 hover:bg-surface/40"
                >
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-surface-3 text-[11px] text-ink-muted tabular-nums">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[13.5px] text-ink">
                      {step.title}
                      <ArrowRight className="size-3.5 text-ink-dim transition-transform group-hover:translate-x-0.5" />
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-dim">
                      {step.body}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>

          {templates.length > 0 && (
            <div className="mt-6 border-t border-line pt-5">
              <p className="text-[12.5px] text-ink-muted">
                或者，直接从一个现成的计划模板开始：
              </p>

              <form action={formAction} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="templateId" value={chosen ?? ""} />

                <div className="flex flex-wrap gap-2">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => setChosen(template.id)}
                      className={
                        chosen === template.id
                          ? "rounded-xl border border-violet-400 bg-violet-500/12 px-3.5 py-2 text-left text-[12.5px] text-ink transition-colors"
                          : "rounded-xl border border-line-2 px-3.5 py-2 text-left text-[12.5px] text-ink-muted transition-colors hover:border-violet-400/50 hover:text-ink"
                      }
                    >
                      <span className="block">{template.name}</span>
                      <span className="mt-0.5 block text-[11px] text-ink-dim">
                        {template.taskCount > 0
                          ? `含 ${template.taskCount} 项任务`
                          : "空模板，自己加任务"}
                      </span>
                    </button>
                  ))}
                </div>

                {/*
                  选中之后才知道要建哪个，所以按钮在未选中时禁用而不是隐藏 ——
                  隐藏会让整块区域在选中时跳一下。
                */}
                <div className="mt-1 flex items-center gap-3">
                  <Button type="submit" size="sm" disabled={!chosen || pending}>
                    {pending && <Loader2 className="size-3.5 animate-spin" />}
                    用这个模板建计划
                  </Button>
                  {state?.ok === false && (
                    <span className="text-[12.5px] text-danger">{state.error}</span>
                  )}
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
