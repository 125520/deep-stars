/**
 * 专注计时领域逻辑
 * ══════════════════════════════════════════════════════════════════
 *
 * 全是纯函数，`now` 一律作为参数传入 —— 计时逻辑最容易写错的地方
 * 恰恰是"时间从哪来"，把它变成显式参数就能被直接测试。
 *
 * ── 一条必须守住的规则 ──────────────────────────────────────────
 *
 * **剩余时间由「墙上时钟的时间戳」推算，绝不能靠 setInterval 累加。**
 *
 * 浏览器会对后台标签页做节流（Chrome 里不活跃的标签页定时器会被压到
 * 每分钟一次甚至更低）。用计数器累加的话，用户切去写文档、二十分钟后回来，
 * 会发现番茄钟只走了两三分钟 —— 而这恰恰是这个功能最主要的使用场景：
 * **它本来就是给"去干别的"准备的。**
 */

export type FocusSession = {
  /** 本段的目标时长（毫秒） */
  durationMs: number;
  /** 之前已经累计的专注时长（毫秒）。暂停时把运行中的部分并进来。 */
  accumulatedMs: number;
  /** 本次运行的起点（epoch ms）。**暂停时为 null** —— 这就是暂停的表示方式。 */
  runningSince: number | null;
};

/** 单段时长上限：8 小时。超过必然是数据损坏，不是真有人在计。 */
const MAX_DURATION_MS = 8 * 60 * 60 * 1000;

/**
 * 当前时刻（epoch ms）。
 *
 * 存在的意义是**把"时间从哪来"收成一个点**：整个计时器只有这里读系统时钟，
 * 将来要注入假时钟做端到端测试、或者换成服务端时间，都只改这一处。
 *
 * （顺带也满足了 React 19 的 react-hooks/purity 规则 —— 它不允许在组件
 * 渲染路径上直接出现 Date.now()。包一层不是绕过规则，而是把不纯的边界
 * 画清楚：这个函数是组件里唯一允许不纯的地方。）
 */
export function nowMs(): number {
  return Date.now();
}

export function createSession(durationMs: number, now: number): FocusSession {
  return {
    durationMs: clampDuration(durationMs),
    accumulatedMs: 0,
    runningSince: now,
  };
}

function clampDuration(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 25 * 60 * 1000;
  return Math.min(value, MAX_DURATION_MS);
}

/**
 * 已经专注了多久。
 *
 * `Math.max(0, now - runningSince)` 不是多余的：系统时间被校准时
 * （NTP 回拨、用户手动改表）now 可能小于 runningSince，
 * 不兜底就会得到负数，界面上显示成 "-1:-30" 这种鬼东西。
 */
export function elapsedMs(session: FocusSession, now: number): number {
  const running =
    session.runningSince === null ? 0 : Math.max(0, now - session.runningSince);
  return session.accumulatedMs + running;
}

export function remainingMs(session: FocusSession, now: number): number {
  return Math.max(0, session.durationMs - elapsedMs(session, now));
}

export function isFinished(session: FocusSession, now: number): boolean {
  return remainingMs(session, now) === 0;
}

/** 进度 0..1，用于画进度弧 */
export function progress(session: FocusSession, now: number): number {
  if (session.durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, elapsedMs(session, now) / session.durationMs));
}

export function pauseSession(session: FocusSession, now: number): FocusSession {
  // 已经在暂停态就原样返回，避免重复暂停把时间重复计入
  if (session.runningSince === null) return session;
  return {
    ...session,
    accumulatedMs: elapsedMs(session, now),
    runningSince: null,
  };
}

/**
 * 继续。
 * 已经走完的段不能"继续"—— 那会让 accumulated 超过 duration，
 * 剩余时间恒为 0，看上去像卡死。
 */
export function resumeSession(session: FocusSession, now: number): FocusSession {
  if (session.runningSince !== null) return session;
  if (session.accumulatedMs >= session.durationMs) return session;
  return { ...session, runningSince: now };
}

/** 毫秒 → mm:ss。超过一小时显示 h:mm:ss。 */
export function formatDuration(ms: number): string {
  /*
    ⚠️ 必须先判有限性再夹取。
    `Math.max(0, NaN)` 的结果是 **NaN** —— 夹取对 NaN 完全无效，
    直接算下去会渲染出 "NaN:NaN" 这种东西。
    （这个 bug 是测试抓到的，不是看出来的。）
  */
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const total = Math.round(safe / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * 序列化 / 反序列化用于 localStorage。
 *
 * **localStorage 里的东西一律不可信**：可能是上个版本写的、可能被用户
 * 手改过、也可能是别的站点污染。所以 parse 做完整字段校验，
 * 任何一项不对就当作没有会话（返回 null），而不是构造一个半坏的会话
 * 让计时器算出 NaN。
 */
export function serializeSession(session: FocusSession): string {
  return JSON.stringify(session);
}

export function parseSession(raw: string | null): FocusSession | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;

  const candidate = value as Record<string, unknown>;
  const { durationMs, accumulatedMs, runningSince } = candidate;

  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }
  if (durationMs > MAX_DURATION_MS) return null;
  if (typeof accumulatedMs !== "number" || !Number.isFinite(accumulatedMs) || accumulatedMs < 0) {
    return null;
  }
  if (runningSince !== null && (typeof runningSince !== "number" || !Number.isFinite(runningSince))) {
    return null;
  }

  return { durationMs, accumulatedMs, runningSince };
}
