import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clientKey, createRateLimiter, retryAfterSeconds } from "../src/lib/rate-limit.ts";

/** 可控时钟：测试里时间不前进，除非显式推进 */
function fakeClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

describe("createRateLimiter() 的基本行为", () => {
  it("窗口内允许到上限为止", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: clock.now });

    for (let i = 0; i < 3; i += 1) {
      const result = limiter.check("a");
      assert.equal(result.ok, true, `第 ${i + 1} 次应当放行`);
    }
    assert.equal(limiter.check("a").ok, false, "第 4 次应当被拒");
  });

  it("remaining 从 limit-1 递减到 0", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: clock.now });
    assert.equal(limiter.check("a").remaining, 2);
    assert.equal(limiter.check("a").remaining, 1);
    assert.equal(limiter.check("a").remaining, 0);
    assert.equal(limiter.check("a").remaining, 0, "被拒时也是 0");
  });

  it("不同 key 互不影响", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now });
    assert.equal(limiter.check("a").ok, true);
    assert.equal(limiter.check("a").ok, false);
    assert.equal(limiter.check("b").ok, true, "另一个 key 不该受影响");
  });
});

describe("窗口滑动", () => {
  it("**窗口滑过之后重新放行**", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: clock.now });

    limiter.check("a");
    limiter.check("a");
    assert.equal(limiter.check("a").ok, false);

    clock.advance(1001);
    assert.equal(limiter.check("a").ok, true, "窗口滑过后应当放行");
  });

  it("**是滑动窗口，不是固定窗口** —— 不会在整点被清空后又立刻用满", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: clock.now });

    limiter.check("a"); // t=0
    clock.advance(900);
    limiter.check("a"); // t=900
    clock.advance(200); // t=1100：第一次已滑出，第二次还在
    assert.equal(limiter.check("a").ok, true, "第一次已过期，应当放行");
    assert.equal(limiter.check("a").ok, false, "第二次仍在窗口内，应当拒绝");
  });

  it("retryAfterMs 指向最早那次滑出窗口的时刻", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: clock.now });
    limiter.check("a");
    clock.advance(20_000);

    const result = limiter.check("a");
    assert.equal(result.ok, false);
    assert.equal(result.retryAfterMs, 40_000, "还差 40 秒");
  });
});

describe("reset()", () => {
  it("清空某个 key 的计数", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now });
    limiter.check("a");
    assert.equal(limiter.check("a").ok, false);

    limiter.reset("a");
    assert.equal(limiter.check("a").ok, true, "reset 之后应当放行");
  });

  it("只清指定的 key", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: clock.now });
    limiter.check("a");
    limiter.check("b");
    limiter.reset("a");
    assert.equal(limiter.check("a").ok, true);
    assert.equal(limiter.check("b").ok, false, "b 不该被清掉");
  });
});

describe("内存边界", () => {
  it("**key 数量有上限** —— 否则限流器本身会成为内存耗尽的入口", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000, maxKeys: 10, now: clock.now });

    for (let i = 0; i < 100; i += 1) limiter.check(`key-${i}`);
    assert.ok(limiter.size() <= 10, `key 数量越界: ${limiter.size()}`);
  });

  it("淘汰的是最旧的 key，最近用过的留下来", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000, maxKeys: 2, now: clock.now });

    limiter.check("old");
    limiter.check("fresh");
    // 再碰一次 fresh，让它变成"最近使用"
    limiter.check("fresh");
    limiter.check("newer"); // 触发淘汰，最旧的 old 应当被踢掉

    // old 被淘汰后再来一次是全新的计数（remaining 回到 4 而不是被拒）
    assert.equal(limiter.check("old").remaining, 4);
  });

  it("过期的记录会被清理，不会无限堆积", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ limit: 100, windowMs: 1000, now: clock.now });
    limiter.check("a");
    clock.advance(5000);
    // 窗口滑过后，之前的记录都失效，remaining 回到满值
    assert.equal(limiter.check("a").remaining, 99);
  });
});

describe("clientKey()", () => {
  const make = (init: Record<string, string>) => new Headers(init);

  it("取 x-forwarded-for 的第一段（最靠近客户端的那个）", () => {
    const headers = make({ "x-forwarded-for": "203.0.113.5, 70.41.3.18, 150.172.238.178" });
    assert.equal(clientKey(headers, "export"), "export:203.0.113.5");
  });

  it("没有 x-forwarded-for 时退回 x-real-ip", () => {
    assert.equal(clientKey(make({ "x-real-ip": "198.51.100.7" }), "export"), "export:198.51.100.7");
  });

  it("两个都没有时归到同一个桶 —— **宁可误伤也不能不限**", () => {
    assert.equal(clientKey(make({}), "export"), "export:unknown");
  });

  it("不同 scope 相互隔离（同一 IP 在两个接口各有一份配额）", () => {
    const headers = make({ "x-forwarded-for": "203.0.113.5" });
    assert.notEqual(clientKey(headers, "export"), clientKey(headers, "import"));
  });

  it("空白的 x-forwarded-for 不会产生空 key", () => {
    assert.equal(clientKey(make({ "x-forwarded-for": "  " }), "s"), "s:unknown");
  });
});

describe("retryAfterSeconds()", () => {
  it("向上取整，至少 1 秒", () => {
    assert.equal(retryAfterSeconds(0), 1);
    assert.equal(retryAfterSeconds(1), 1);
    assert.equal(retryAfterSeconds(1001), 2);
    assert.equal(retryAfterSeconds(60_000), 60);
  });
});
