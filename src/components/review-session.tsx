"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { gradeCard } from "@/lib/actions/review";
import { GRADES, describeInterval, gradeLabel, schedule, type Grade } from "@/lib/srs";
import { cn } from "@/lib/utils";

/**
 * 复习会话
 * ══════════════════════════════════════════════════════════════════
 *
 * ── 一个关键设计：按钮上直接写出"按下去会怎样" ──────────────────
 *
 * 四个按钮各自显示这次评分**算出来的下次间隔**（1 天后 / 6 天后 / …），
 * 而不是只写"有点难 / 记得 / 很简单"。
 * 间隔重复对大多数人是陌生的：不告诉他后果，他就只会一直点最左边那个，
 * 而那会让整套调度退化成一个普通的重读列表。
 *
 * 间隔是用**与服务端完全同一份 schedule()** 算的（都在 lib/srs.ts），
 * 所以按钮上的预览与真实落库的结果不会不一致。
 *
 * ── 队列只在挂载时取一次 ────────────────────────────────────────
 * 每次评分服务端都会 revalidate，重新渲染时 cards 是新的。
 * 如果直接用 props 当队列，评完一张整个会话就会重置回第一张。
 * 所以用 useState 的惰性初始值把初始快照固定下来。
 */

export type DueCard = {
  id: string;
  front: string;
  back: string;
  tags: string | null;
  ease: number;
  interval: number;
  reps: number;
  lapses: number;
};

type Preview = { value: Grade; days: number; learning: boolean };

export default function ReviewSession({ cards }: { cards: DueCard[] }) {
  // 惰性初始值 = 挂载时快照一次，之后的 revalidate 不会打断会话
  const [queue] = React.useState<DueCard[]>(() => cards);
  const [index, setIndex] = React.useState(0);
  const [revealed, setRevealed] = React.useState(false);
  const [previews, setPreviews] = React.useState<Preview[]>([]);
  const [counts, setCounts] = React.useState<Record<string, number>>({});
  const [busy, setBusy] = React.useState(false);
  const router = useRouter();

  const card = queue[index];
  const done = index >= queue.length;

  /**
   * 翻面时一次算好四档的后果。
   *
   * 放在事件处理里而不是渲染体里，原因有两个：
   *   · 渲染期调 `new Date()` 是不纯的，同一个 props 可能渲染出不同结果
   *   · 四档各算一次就够，没必要在每次重渲染时重复算
   */
  function reveal() {
    // 这个判断是给类型收窄用的：调用点在下方的早返回之后，但函数定义在之前，
    // TypeScript 无法把早返回的收窄结果带进来
    if (!card) return;

    const now = new Date();
    setPreviews(
      GRADES.map((value) => {
        const next = schedule(card, value, now);
        return { value, days: next.interval, learning: next.state === "learning" };
      }),
    );
    setRevealed(true);
  }

  async function grade(value: Grade) {
    if (!card || busy) return;
    setBusy(true);
    try {
      await gradeCard(card.id, value);
      setCounts((prev) => ({ ...prev, [value]: (prev[value] ?? 0) + 1 }));
      setRevealed(false);
      setIndex((i) => i + 1);
    } finally {
      setBusy(false);
    }
  }

  // 全部评完之后刷新一次，把新的到期时间取回来
  React.useEffect(() => {
    if (done && queue.length > 0) router.refresh();
  }, [done, queue.length, router]);

  if (queue.length === 0) {
    return (
      <p className="py-10 text-center text-[13px] text-ink-muted">
        现在没有到期的卡片。
      </p>
    );
  }

  /*
    `!card` 与 `done` 是等价的（done 就是 index 越界），但必须一起写：
    TypeScript 无法从 `index >= queue.length` 推出 `queue[index]` 一定有值，
    而下面的 JSX 处处要用 card。这样写之后收窄才成立。
  */
  if (done || !card) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-violet-500/15 ring-1 ring-violet-400/30">
          <Check className="size-6 text-violet-300" strokeWidth={2.5} />
        </span>
        <h3 className="mt-5 text-[18px] font-semibold tracking-tight text-ink">
          这一轮复习完了
        </h3>
        <p className="mt-3 text-[13px] text-ink-muted">
          共 {queue.length} 张 ·{" "}
          {GRADES.filter((g) => (counts[g] ?? 0) > 0)
            .map((g) => `${gradeLabel(g)} ${counts[g]}`)
            .join(" · ")}
        </p>
        <Button className="mt-7" onClick={() => router.refresh()}>
          看看下一批
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-violet-500 transition-[width] duration-300"
            style={{ width: `${(index / queue.length) * 100}%` }}
          />
        </div>
        <span className="shrink-0 text-[11.5px] text-ink-dim tabular-nums">
          {index + 1} / {queue.length}
        </span>
      </div>

      {/* 卡片本体。min-h 让翻面前后高度不跳，视线不会丢位置 */}
      <div className="flex min-h-[220px] flex-col justify-center rounded-2xl border border-line bg-surface-2/60 px-7 py-9 text-center">
        <p className="text-[17px] leading-relaxed text-ink text-pretty">{card.front}</p>

        {revealed && (
          <>
            <div className="my-6 h-px bg-line" />
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-ink-muted text-pretty">
              {card.back}
            </p>
          </>
        )}
      </div>

      {card.tags && (
        <div className="flex flex-wrap justify-center gap-1.5">
          {card.tags.split(",").map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-surface-3 px-2 py-0.5 text-[11px] text-ink-dim"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {!revealed ? (
        <Button size="lg" onClick={reveal} className="w-full">
          显示答案
        </Button>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {previews.map(({ value, days, learning }) => (
            <button
              key={value}
              type="button"
              disabled={busy}
              onClick={() => void grade(value)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3.5 transition-all duration-200",
                "hover:-translate-y-0.5 disabled:opacity-50",
                value === "again" && "border-danger/40 hover:border-danger hover:bg-danger/10",
                value === "hard" && "border-line-2 hover:border-amber-400/60 hover:bg-amber-400/8",
                value === "good" && "border-line-2 hover:border-violet-400 hover:bg-violet-500/10",
                value === "easy" && "border-line-2 hover:border-emerald-400/60 hover:bg-emerald-400/8",
              )}
            >
              <span className="text-[12.5px] text-ink">{gradeLabel(value)}</span>
              <span className="text-[11px] text-ink-dim tabular-nums">
                {busy ? <Loader2 className="size-3 animate-spin" /> : learning ? "稍后重来" : describeInterval(days)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
