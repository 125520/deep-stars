/**
 * 限流（滑动窗口）
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯逻辑 + 可注入时钟，所以能被确定性地测试 —— 限流器是那种
 * "平时看不出问题、被打了才发现没生效"的东西，必须测。
 *
 * ── ⚠️ 关于存储的一条实话 ──────────────────────────────────────
 *
 * 这里用的是**进程内存**。在 Vercel 这类多实例的 Serverless 环境里，
 * 每个实例各记一份，所以真实上限大致是 `limit × 实例数`。
 *
 * 也就是说：**它挡得住脚本小子，挡不住有耐心的攻击者。**
 *
 * 之所以还是选它：
 *   · 认证接口的限流交给 Better Auth 自己的实现（见 src/lib/auth.ts），
 *     那才是暴力破解的真正入口
 *   · 这里保护的是导出这类**昂贵但不需要暴力**的接口，
 *     目的是防止一次误操作或一个脚本把数据库拖垮，而不是对抗定向攻击
 *
 * 要真正跨实例限流，得把 store 换成共享存储（Neon / Redis）。
 * 接口已经按这个方向设计：`check(key)` 与存储实现无关，
 * 换的时候只需要替换 hits 这个 Map。
 */

export type RateLimitResult = {
  ok: boolean;
  /** 本窗口内还剩几次 */
  remaining: number;
  /** 被拒时：还要等多少毫秒 */
  retryAfterMs: number;
};

export type RateLimiter = {
  check(key: string): RateLimitResult;
  /** 成功后主动清空（例如登录成功就不必再计之前的失败次数） */
  reset(key: string): void;
  /** 当前跟踪的 key 数量，用于排查内存增长 */
  size(): number;
};

export type RateLimiterOptions = {
  /** 窗口内允许的次数 */
  limit: number;
  /** 窗口长度（毫秒） */
  windowMs: number;
  /** 最多同时跟踪多少个 key。超过就淘汰最旧的那个。 */
  maxKeys?: number;
  /** 可注入时钟，便于测试 */
  now?: () => number;
};

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { limit, windowMs } = options;
  const maxKeys = options.maxKeys ?? 5000;
  const now = options.now ?? Date.now;

  /** key → 命中时间戳列表（升序） */
  const hits = new Map<string, number[]>();

  /**
   * 淘汰最旧的 key。
   *
   * 没有这一步的话，攻击者换着 IP 打就能让这个 Map 无限增长 ——
   * **限流器本身变成了内存耗尽的入口**，比不限流还糟。
   * Map 保持插入顺序，所以第一个键就是最久没被碰过的。
   */
  function evictIfNeeded() {
    while (hits.size > maxKeys) {
      const oldest = hits.keys().next();
      if (oldest.done) break;
      hits.delete(oldest.value);
    }
  }

  return {
    check(key: string): RateLimitResult {
      const at = now();
      const cutoff = at - windowMs;

      // 只保留窗口内的记录。这一步同时完成了"滑动"。
      const recent = (hits.get(key) ?? []).filter((time) => time > cutoff);

      if (recent.length >= limit) {
        // 最早的那次滑出窗口时就能再试
        const oldest = recent[0] ?? at;
        hits.set(key, recent);
        return {
          ok: false,
          remaining: 0,
          retryAfterMs: Math.max(0, oldest + windowMs - at),
        };
      }

      recent.push(at);
      // 重新 set 会让这个 key 变成"最近使用"，从而不会被优先淘汰
      hits.delete(key);
      hits.set(key, recent);
      evictIfNeeded();

      return { ok: true, remaining: limit - recent.length, retryAfterMs: 0 };
    },

    reset(key: string): void {
      hits.delete(key);
    },

    size(): number {
      return hits.size;
    },
  };
}

/**
 * 从请求头里取客户端标识。
 *
 * ⚠️ `x-forwarded-for` 是**可以被伪造的** —— 真正的可信来源只有
 * 反向代理自己写入的那个值。Vercel 会覆盖它，所以线上可信；
 * 但如果将来换了部署方式，这里必须重新确认。
 *
 * 取第一段（最靠近客户端的那个）。取不到就退回 "unknown"：
 * 所有拿不到 IP 的请求共用一个桶，宁可误伤也不能不限。
 */
export function clientKey(headers: Headers, scope: string): string {
  const forwarded = headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
  return `${scope}:${ip}`;
}

/** 把毫秒转成 Retry-After 头需要的秒数（向上取整，至少 1） */
export function retryAfterSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}
