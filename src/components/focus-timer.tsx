"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Loader2, Maximize2, Minimize2, Pause, Play, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { recordFocus, type FocusState } from "@/lib/actions/focus";
import {
  createSession,
  formatDuration,
  isFinished,
  nowMs,
  pauseSession,
  progress,
  remainingMs,
  resumeSession,
} from "@/lib/focus";
import { getServerSnapshot, getSnapshot, setFocusSession, subscribe } from "@/lib/focus-store";
import { cn } from "@/lib/utils";

/**
 * 深空专注计时器
 * ══════════════════════════════════════════════════════════════════
 *
 * ── 三个必须守住的点 ────────────────────────────────────────────
 *
 * 1. **剩余时间由 nowMs() 推算，不用计数器累加。**
 *    定时器只负责触发重绘，它跑多慢都不影响结果 ——
 *    浏览器把后台标签页节流到每分钟一次也照样对。
 *    对这个功能尤其要紧：用户**本来就是要去干别的**。
 *
 * 2. **会话存在 localStorage，刷新不丢。**
 *    存的是时间戳而不是"还剩多少秒"，否则页面关着的那段时间会凭空消失。
 *    读取走 useSyncExternalStore（见 focus-store.ts），SSR 下自动给 null。
 *
 * 3. **走完自动记一笔，且只记一次。** 用 ref 守住，避免重渲染重复提交。
 */

const PRESETS = [
  { minutes: 25, label: "标准" },
  { minutes: 45, label: "长段" },
  { minutes: 60, label: "深潜" },
] as const;

/*
  useSyncExternalStore 需要三个稳定引用。
  定义在模块作用域而不是组件里：每次渲染新建函数会让 React 认为快照变了，
  换来无意义的重渲染。
*/
const subscribeNever = () => () => {};
const returnTrue = () => true;
const returnFalse = () => false;

export default function FocusTimer() {
  // 会话来自外部存储：服务端渲染时是 null，水合后自动切到真实值
  const session = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const [now, setNow] = React.useState(nowMs);
  const [state, formAction, pending] = React.useActionState<FocusState, FormData>(
    recordFocus,
    null,
  );
  const recordedRef = React.useRef(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  /*
    沉浸模式。做成计时器自己的一个展示态，而不是独立页面 ——
    计时状态就在这个组件里，另起一个页面就得把它提升到全局或复制一份。
  */
  const [immersive, setImmersive] = React.useState(false);

  /*
    "现在是不是在客户端"。
    不能写成 `useState(false)` + `useEffect(() => setMounted(true))` ——
    那是在 effect 里同步 setState，会触发级联渲染，React 的规则会拦下来。
    useSyncExternalStore 天然带 SSR 分支：服务端走 getServerSnapshot（false），
    客户端走 getSnapshot（true）。同一个机制在 lib/focus-store.ts 里也用了。
  */
  const mounted = React.useSyncExternalStore(subscribeNever, returnTrue, returnFalse);

  // 定时器只触发重绘。setState 发生在回调里，不在 effect 体内 ——
  // 时间永远在渲染时从 nowMs() 现取，不靠 tick 累加
  React.useEffect(() => {
    if (!session || session.runningSince === null) return;
    const id = window.setInterval(() => setNow(nowMs()), 500);
    return () => window.clearInterval(id);
  }, [session]);

  const finished = session !== null && isFinished(session, now);
  const remaining = session ? remainingMs(session, now) : 25 * 60_000;
  const ratio = session ? progress(session, now) : 0;
  const running = session !== null && session.runningSince !== null;

  // ── 走完自动记一笔 ──
  React.useEffect(() => {
    if (!finished || !session || recordedRef.current) return;
    recordedRef.current = true;
    chime();

    const form = formRef.current;
    if (!form) return;
    const field = form.elements.namedItem("minutes");
    if (field instanceof HTMLInputElement) {
      field.value = String(Math.round(session.durationMs / 60_000));
    }
    form.requestSubmit();
  }, [finished, session]);

  function start(minutes: number) {
    recordedRef.current = false;
    setFocusSession(createSession(minutes * 60_000, nowMs()));
    setNow(nowMs());
  }

  function reset() {
    recordedRef.current = false;
    setFocusSession(null);
  }

  function toggleRun() {
    if (!session) return;
    const at = nowMs();
    setFocusSession(running ? pauseSession(session, at) : resumeSession(session, at));
    setNow(at);
  }

  /**
   * 进入 / 退出沉浸模式。
   *
   * 除了盖一层全屏遮罩，还会请求浏览器的真全屏 —— 后者把地址栏与系统任务栏
   * 也一并隐藏，才是"无干扰"。但它需要用户手势、在 iframe 里或被策略禁止时会被拒，
   * 所以**失败不影响遮罩生效**，只是少一层沉浸。
   */
  const fullscreenActiveRef = React.useRef(false);

  function toggleImmersive(next: boolean) {
    setImmersive(next);

    if (next) {
      const request = document.documentElement.requestFullscreen?.();
      // 只有真正进入全屏才记下来 —— 见下面 fullscreenchange 的处理
      if (request) {
        void request.then(
          () => {
            fullscreenActiveRef.current = true;
          },
          () => {
            fullscreenActiveRef.current = false;
          },
        );
      }
    } else {
      fullscreenActiveRef.current = false;
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    }
  }

  // Esc 退出；F 切换。用键盘的人不该被迫去找那个按钮
  React.useEffect(() => {
    if (!immersive) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "f" || event.key === "F") {
        toggleImmersive(false);
      }
    };
    window.addEventListener("keydown", onKey);

    /*
      ⚠️ 只有**我们确实进入过全屏**时，才把 fullscreenchange 当作"用户按了 F11 退出"。

      第一版没有这个条件，于是：请求全屏被拒（headless / iframe / 策略禁止）时，
      浏览器照样会发一次 fullscreenchange，而那一刻 fullscreenElement 是 null ——
      监听器据此判定"用户退出了全屏"，把刚打开的遮罩立刻收掉。
      表现是**点「沉浸」闪一下就回到普通页面**，而且只在全屏不可用时出现。

      这个 bug 是靠截图发现的：同一时刻的 DOM 测量显示遮罩存在且铺满，
      但截出来的图里没有它 —— 因为它在那之后才被撤销。
    */
    const onFullscreenChange = () => {
      if (fullscreenActiveRef.current && !document.fullscreenElement) {
        fullscreenActiveRef.current = false;
        setImmersive(false);
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [immersive]);

  /*
    沉浸层的内容。
    用 portal 挂到 body，而不是就地渲染一个 fixed 元素 ——
    祖先只要有 transform / filter / backdrop-filter，fixed 就会相对它定位
    （观测窗面板正好用了 backdrop-filter），遮罩会缩在面板里而不是铺满屏幕。
  */
  const immersiveLayer =
    immersive && mounted
      ? createPortal(
          <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-10 bg-canvas">
            <p className="text-[13px] tracking-[0.2em] text-ink-dim">
              {running ? "专注中" : session ? "已暂停" : "准备开始"}
            </p>

            <span className="font-mono text-[clamp(64px,14vw,140px)] leading-none font-semibold tracking-tight text-ink tabular-nums">
              {formatDuration(remaining)}
            </span>

            <p className="max-w-md px-6 text-center text-[13px] leading-relaxed text-ink-dim text-pretty">
              把这段时间交给一件事。切去别的标签页也不会走慢 ——
              剩余时间按真实时间推算。
            </p>

            <div className="flex items-center gap-2">
              {session && !finished && (
                <Button onClick={toggleRun} variant="onDeep">
                  {running ? <Pause className="size-4" /> : <Play className="size-4" />}
                  {running ? "暂停" : "继续"}
                </Button>
              )}
              <Button variant="ghost" onClick={() => toggleImmersive(false)}>
                <Minimize2 className="size-4" />
                退出（Esc）
              </Button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="flex flex-col items-center gap-7">
      {immersiveLayer}
      <Dial ratio={ratio} finished={finished}>
        <span
          className={cn(
            "font-mono text-[44px] leading-none font-semibold tracking-tight tabular-nums",
            finished ? "text-violet-300" : "text-ink",
          )}
        >
          {formatDuration(remaining)}
        </span>
        <span className="mt-2 text-[12px] text-ink-dim">
          {!session ? "选一段时长开始" : finished ? "这一段完成了" : running ? "专注中" : "已暂停"}
        </span>
      </Dial>

      <div className="flex flex-wrap justify-center gap-2">
        {!session ? (
          PRESETS.map((p) => (
            <Button key={p.minutes} variant="outline" onClick={() => start(p.minutes)}>
              {p.minutes} 分钟 · {p.label}
            </Button>
          ))
        ) : (
          <>
            {!finished && (
              <Button onClick={toggleRun}>
                {running ? <Pause className="size-4" /> : <Play className="size-4" />}
                {running ? "暂停" : "继续"}
              </Button>
            )}
            <Button variant="outline" onClick={reset}>
              <RotateCcw className="size-4" />
              重置
            </Button>
          </>
        )}

        {/* 沉浸模式：任何状态下都能进，暂停时进去也不打断 */}
        <Button variant="ghost" onClick={() => toggleImmersive(true)}>
          <Maximize2 className="size-4" />
          沉浸
        </Button>
      </div>

      {/* 记录表单：完成时由上面的 effect 自动提交，正常操作看不到它 */}
      <form ref={formRef} action={formAction} className="hidden">
        <input type="hidden" name="minutes" defaultValue="25" />
      </form>

      <p role="status" aria-live="polite" className="min-h-[18px] text-[12.5px]">
        {pending && (
          <span className="text-ink-muted">
            <Loader2 className="mr-1 inline size-3.5 animate-spin align-[-2px]" />
            正在记录…
          </span>
        )}
        {state?.ok === true && (
          <span className="text-violet-300">已记录 {state.minutes} 分钟专注。</span>
        )}
        {state?.ok === false && <span className="text-danger">{state.error}</span>}
      </p>
    </div>
  );
}

/** 进度环 */
function Dial({
  ratio,
  finished,
  children,
}: {
  ratio: number;
  finished: boolean;
  children: React.ReactNode;
}) {
  const R = 92;
  const C = 2 * Math.PI * R;

  return (
    <div className="relative grid size-[220px] place-items-center">
      <svg viewBox="0 0 220 220" className="absolute inset-0 -rotate-90" aria-hidden="true">
        {/*
          底轨不能用 --color-line：那个色是给页面底色配的，
          压在观测窗的深底上几乎看不见 —— 而进度环是这个页面的视觉主体，
          没有底轨就只剩一个孤零零的数字，"走了多少"完全读不出来。
          换成带紫的半透明白，在深底上有对比，又不会抢进度弧。
        */}
        <circle
          cx="110"
          cy="110"
          r={R}
          fill="none"
          stroke="rgba(196, 181, 255, 0.16)"
          strokeWidth="3"
        />
        <circle
          cx="110"
          cy="110"
          r={R}
          fill="none"
          stroke={finished ? "var(--color-violet-300)" : "var(--color-violet-500)"}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - ratio)}
          style={{ transition: "stroke-dashoffset 0.5s linear" }}
        />
      </svg>
      <div className="relative flex flex-col items-center">{children}</div>
    </div>
  );
}

/**
 * 完成提示音。
 *
 * 用 Web Audio 现场合成两个音，不引入任何音频文件 ——
 * 为了一声"叮"带一个 mp3 不划算。
 * AudioContext 在部分浏览器里要求先有用户手势，所以整体包在 try 里：
 * 播不出声只是少一个提示，绝不能让计时器因此崩掉。
 */
function chime() {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const at = ctx.currentTime;
    for (const [index, freq] of [880, 1320].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const startAt = at + index * 0.16;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + 0.55);
    }
    window.setTimeout(() => void ctx.close(), 1500);
  } catch {
    // 播放失败无关紧要
  }
}
