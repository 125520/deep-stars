"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";

import { startConstellation, type StartConstellationState } from "@/lib/actions/constellation";
import { ZODIAC_SIGNS } from "@/lib/zodiac";
import { cn } from "@/lib/utils";

/**
 * 换一个星座继续点亮
 * ══════════════════════════════════════════════════════════════════
 *
 * 两条状态，长得完全不一样：
 *
 *   · **没画满** → 只显示一句进度。换星座是一种奖励，不该在还没走完的
 *     时候摆在眼前勾着人 —— 那个位置应该是"还差几枚"，而不是"去看看别的"。
 *   · **画满了** → 展开全部 12 个星座让用户挑，**包括他自己的那一个**。
 *     重新点亮一遍自己的星座是有意义的动作：同一个形状，第二次填满它的时候，
 *     中间那段时间是你自己过的。
 *
 * 用 useActionState 接 Server Action，理由与打卡表单一致：
 * 不必手写 pending / error / 重置这套状态机。
 */
export default function ConstellationPicker({
  currentName,
  currentSign,
  lit,
  total,
  complete,
}: {
  currentName: string;
  currentSign: string | null;
  lit: number;
  total: number;
  complete: boolean;
}) {
  const [state, formAction, pending] = React.useActionState<StartConstellationState, FormData>(
    startConstellation,
    null,
  );
  const [open, setOpen] = React.useState(false);

  if (total === 0) return null;

  if (!complete) {
    const remaining = total - lit;
    return (
      <div className="rounded-xl border border-line-2 bg-surface-2/60 px-4 py-3">
        <p className="text-[12.5px] text-ink-muted">
          <Sparkles className="mr-1 inline size-3.5 align-[-2px] text-violet-300" />
          「{currentName}」还差 <span className="font-semibold text-ink">{remaining}</span> 枚星画满。
          画满之后可以换一个星座继续。
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-violet-500/30 bg-violet-500/8 px-4 py-4">
      <p className="text-[13px] text-ink">
        <Sparkles className="mr-1.5 inline size-4 align-[-3px] text-violet-300" />
        「{currentName}」已经画满了 —— 挑下一个吧。
      </p>

      {state?.ok === false && (
        <p role="status" aria-live="polite" className="mt-2 text-[12.5px] text-danger">
          {state.error}
        </p>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 inline-flex items-center gap-1 rounded-lg bg-violet-500 px-3.5 py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-violet-400"
        >
          选择下一个星座 →
        </button>
      ) : (
        <form action={formAction} className="mt-3">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {ZODIAC_SIGNS.map((sign) => (
              <button
                key={sign.key}
                type="submit"
                name="sign"
                value={sign.key}
                disabled={pending}
                className={cn(
                  "rounded-lg border px-2 py-2.5 text-[12.5px] transition-colors",
                  "border-line-2 bg-canvas text-ink hover:border-violet-400 hover:bg-violet-500/10",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  // 当前这个标记一下 —— 它既是可以重选的目标，也是"你刚画完的"
                  sign.key === currentSign && "border-violet-400/60 bg-violet-500/12",
                )}
              >
                <span className="block">{sign.name}</span>
                <span className="mt-0.5 block text-[10.5px] text-ink-dim">
                  {sign.simple.stars.length}–{sign.full.stars.length} 枚
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-3 text-[12px] text-ink-dim underline decoration-dotted hover:text-ink-muted"
          >
            先不换
          </button>
        </form>
      )}
    </div>
  );
}
