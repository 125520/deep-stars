import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createSession,
  elapsedMs,
  formatDuration,
  isFinished,
  parseSession,
  pauseSession,
  progress,
  remainingMs,
  resumeSession,
  serializeSession,
} from "../src/lib/focus.ts";

const MIN = 60_000;
/** 固定的"现在"，避免测试依赖真实时间 */
const T0 = 1_772_000_000_000;

describe("专注计时", () => {
  it("剩余时间随时间递减，且由时间戳推算而非累加", () => {
    const s = createSession(25 * MIN, T0);
    assert.equal(remainingMs(s, T0), 25 * MIN);
    assert.equal(remainingMs(s, T0 + 60_000), 24 * MIN);
  });

  it("**模拟后台标签页节流**：跳过大段时间后仍然算对", () => {
    // 这正是这个功能的主场景：用户切走去干别的，定时器被浏览器压到每分钟一次。
    // 靠 setInterval 累加的实现会在这里显示成"才走了 2 分钟"。
    const s = createSession(25 * MIN, T0);
    const afterTabReturn = T0 + 20 * MIN; // 一次 tick 都没跑，直接越过 20 分钟
    assert.equal(elapsedMs(s, afterTabReturn), 20 * MIN);
    assert.equal(remainingMs(s, afterTabReturn), 5 * MIN);
  });

  it("暂停后剩余时间冻结，继续后从暂停处接着走", () => {
    let s = createSession(25 * MIN, T0);
    s = pauseSession(s, T0 + 5 * MIN);
    assert.equal(remainingMs(s, T0 + 5 * MIN), 20 * MIN);
    // 暂停期间过了很久，剩余不变
    assert.equal(remainingMs(s, T0 + 90 * MIN), 20 * MIN);

    s = resumeSession(s, T0 + 90 * MIN);
    assert.equal(remainingMs(s, T0 + 92 * MIN), 18 * MIN);
  });

  it("重复暂停不会把时间重复计入", () => {
    let s = createSession(25 * MIN, T0);
    s = pauseSession(s, T0 + 5 * MIN);
    const once = s.accumulatedMs;
    s = pauseSession(s, T0 + 50 * MIN); // 再按一次
    assert.equal(s.accumulatedMs, once);
  });

  it("走完之后剩余恒为 0，不会变成负数", () => {
    const s = createSession(25 * MIN, T0);
    assert.equal(remainingMs(s, T0 + 60 * MIN), 0);
    assert.equal(remainingMs(s, T0 + 600 * MIN), 0);
    assert.ok(isFinished(s, T0 + 25 * MIN));
  });

  it("已经走完的段不能'继续'—— 否则看起来像卡死", () => {
    let s = createSession(25 * MIN, T0);
    s = pauseSession(s, T0 + 25 * MIN);
    const resumed = resumeSession(s, T0 + 30 * MIN);
    assert.equal(resumed.runningSince, null, "已完成的段不应重新开始运行");
  });

  it("系统时间被回拨时不产生负数或 NaN", () => {
    const s = createSession(25 * MIN, T0);
    // NTP 校准把 now 拉到了开始之前
    assert.equal(elapsedMs(s, T0 - 60_000), 0);
    assert.equal(remainingMs(s, T0 - 60_000), 25 * MIN);
    assert.ok(Number.isFinite(progress(s, T0 - 60_000)));
  });

  it("进度在 0..1 之间", () => {
    const s = createSession(10 * MIN, T0);
    assert.equal(progress(s, T0), 0);
    assert.equal(progress(s, T0 + 5 * MIN), 0.5);
    assert.equal(progress(s, T0 + 60 * MIN), 1);
  });

  it("非法的目标时长回退到 25 分钟", () => {
    assert.equal(createSession(Number.NaN, T0).durationMs, 25 * MIN);
    assert.equal(createSession(0, T0).durationMs, 25 * MIN);
    assert.equal(createSession(-5, T0).durationMs, 25 * MIN);
  });

  it("超过 8 小时的目标被夹住", () => {
    assert.equal(createSession(100 * 60 * MIN, T0).durationMs, 8 * 60 * MIN);
  });
});

describe("formatDuration()", () => {
  it("一小时以内是 mm:ss", () => {
    assert.equal(formatDuration(0), "00:00");
    assert.equal(formatDuration(65_000), "01:05");
    assert.equal(formatDuration(25 * MIN), "25:00");
  });

  it("超过一小时带上小时位", () => {
    assert.equal(formatDuration(60 * MIN), "1:00:00");
    assert.equal(formatDuration(95 * MIN), "1:35:00");
  });

  it("负数与 NaN 都不产生乱码", () => {
    assert.equal(formatDuration(-5000), "00:00");
    assert.equal(formatDuration(Number.NaN), "00:00");
  });
});

describe("会话的序列化与反序列化", () => {
  it("往返之后完全一致", () => {
    const s = createSession(25 * MIN, T0);
    assert.deepEqual(parseSession(serializeSession(s)), s);
  });

  it("暂停态（runningSince 为 null）也能往返", () => {
    const s = pauseSession(createSession(25 * MIN, T0), T0 + MIN);
    assert.deepEqual(parseSession(serializeSession(s)), s);
  });

  it("**localStorage 里的东西一律不可信**：坏数据一律返回 null", () => {
    const bad = [
      null,
      "",
      "不是 JSON",
      "{}",
      '{"durationMs":"25"}',
      '{"durationMs":-1,"accumulatedMs":0,"runningSince":null}',
      '{"durationMs":99999999999,"accumulatedMs":0,"runningSince":null}',
      '{"durationMs":1000,"accumulatedMs":-5,"runningSince":null}',
      '{"durationMs":1000,"accumulatedMs":0,"runningSince":"now"}',
      '{"durationMs":1000,"accumulatedMs":0,"runningSince":NaN}',
      "[1,2,3]",
    ];
    for (const raw of bad) {
      assert.equal(parseSession(raw), null, `应当拒绝: ${raw}`);
    }
  });
});
