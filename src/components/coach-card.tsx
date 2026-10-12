import Link from "next/link";
import { Sparkles } from "lucide-react";

import { Card } from "@/components/ui/card";
import { pickCoachMessage, type CoachContext } from "@/lib/coach";

/**
 * 主动教练
 * ══════════════════════════════════════════════════════════════════
 *
 * 服务端组件：判定完全由 lib/coach.ts 的纯函数做出，这里只负责渲染。
 *
 * **没有值得说的话就不渲染。** 一个每天都在仪表盘上占一块地方的"励志卡片"，
 * 两天之后就会被无视 —— 而它一旦被无视，真正要紧的那次提醒也一起失效了。
 *
 * ── body 为什么要从外面传 ──────────────────────────────────────
 *
 * 通知同步那条路径会把文案交给用户自己的 AI 改写一遍（见 lib/ai/rephrase.ts）。
 * 卡片如果自己调 pickCoachMessage()，就会显示**规则原文**，而通知里是改写版 ——
 * 同一句建议两种说法，用户还会以为付费换来的改写根本没生效。
 *
 * 所以优先用传进来的 body（来自今天那条 coach 通知），没有再退回规则文案。
 */

export default function CoachCard({
  context,
  body,
}: {
  context: CoachContext;
  /** 今天那条教练通知的正文（可能已被 AI 改写）。没有就退回规则文案 */
  body?: string | null;
}) {
  const message = pickCoachMessage(context);
  if (!message) return null;

  /*
    只有"通知里那条确实是同一件事"时才用它 —— 标题一致才算同一条。
    否则用户会看到标题说断签、正文说复习积压这种自相矛盾。
  */
  const text = body && message.title ? body : message.body;

  return (
    <Card className="px-5 py-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-violet-500/15 ring-1 ring-violet-400/25">
          <Sparkles className="size-3.5 text-violet-300" strokeWidth={2} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-ink">{message.title}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted text-pretty">
            {text}
          </p>
          <Link
            href={message.actionUrl}
            className="mt-2.5 inline-block text-[12.5px] text-violet-300 transition-colors hover:text-violet-200"
          >
            去处理 →
          </Link>
        </div>
      </div>
    </Card>
  );
}
