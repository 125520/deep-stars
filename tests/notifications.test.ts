import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countUnread,
  hasNotificationForDay,
  planNotifications,
} from "../src/lib/notifications.ts";

const NOW = new Date(2026, 9, 7, 21, 0); // 2026-10-07 21:00 本地
const coach = { title: "今天还没记录", body: "一句话就能接上。", actionUrl: "/dashboard" };

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

describe("hasNotificationForDay()", () => {
  it("今天已有同类型 → 判定为已存在", () => {
    assert.equal(
      hasNotificationForDay([{ type: "coach", createdAt: at(2026, 10, 7, 9) }], "coach", NOW),
      true,
    );
  });

  it("昨天有、今天没有 → 不算重复", () => {
    assert.equal(
      hasNotificationForDay([{ type: "coach", createdAt: at(2026, 10, 6) }], "coach", NOW),
      false,
    );
  });

  it("**跨天但不足 24 小时也算不同天** —— 按本地日期比，不是按时间差", () => {
    // 昨晚 23:00 收到过，今晚 21:00 应当可以再收到一条
    assert.equal(
      hasNotificationForDay([{ type: "coach", createdAt: at(2026, 10, 6, 23) }], "coach", NOW),
      false,
    );
  });

  it("类型不同不算重复", () => {
    assert.equal(
      hasNotificationForDay([{ type: "review", createdAt: at(2026, 10, 7) }], "coach", NOW),
      false,
    );
  });

  it("空列表不重复", () => {
    assert.equal(hasNotificationForDay([], "coach", NOW), false);
  });
});

describe("planNotifications()", () => {
  it("没有教练建议、复习也没积压 → 什么都不发", () => {
    const planned = planNotifications({ now: NOW, existing: [], coach: null, reviewDue: 3 });
    assert.deepEqual(planned, []);
  });

  it("有教练建议就发一条", () => {
    const planned = planNotifications({ now: NOW, existing: [], coach, reviewDue: 0 });
    assert.equal(planned.length, 1);
    assert.equal(planned[0]?.type, "coach");
    assert.equal(planned[0]?.title, coach.title);
  });

  it("**同一天重复调用不会重复发** —— 生成时机是「打开页面时顺带检查」", () => {
    const existing = [{ type: "coach", createdAt: at(2026, 10, 7, 9) }];
    const planned = planNotifications({ now: NOW, existing, coach, reviewDue: 0 });
    assert.deepEqual(planned, []);
  });

  it("复习积压的阈值高于仪表盘卡片（20 vs 10）—— 通知是主动打断", () => {
    const below = planNotifications({ now: NOW, existing: [], coach: null, reviewDue: 19 });
    assert.deepEqual(below, [], "19 张不该主动打断");
    const above = planNotifications({ now: NOW, existing: [], coach: null, reviewDue: 20 });
    assert.equal(above.length, 1);
    assert.equal(above[0]?.type, "review");
  });

  it("教练建议与复习积压可以同时产生（类型不同，各自去重）", () => {
    const planned = planNotifications({ now: NOW, existing: [], coach, reviewDue: 25 });
    assert.equal(planned.length, 2);
    assert.deepEqual(
      planned.map((p) => p.type).sort(),
      ["coach", "review"],
    );
  });

  it("每条都有可点的去处", () => {
    const planned = planNotifications({ now: NOW, existing: [], coach, reviewDue: 30 });
    for (const item of planned) {
      assert.ok(item.actionUrl?.startsWith("/"), `${item.type} 缺站内路径`);
    }
  });

  it("阈值可覆盖（便于将来按用户调整）", () => {
    const planned = planNotifications({
      now: NOW,
      existing: [],
      coach: null,
      reviewDue: 5,
      reviewThreshold: 5,
    });
    assert.equal(planned.length, 1);
  });
});

describe("countUnread()", () => {
  it("只数未读", () => {
    assert.equal(countUnread([{ read: true }, { read: false }, { read: false }]), 2);
  });

  it("空列表为 0", () => {
    assert.equal(countUnread([]), 0);
  });

  it("全读为 0", () => {
    assert.equal(countUnread([{ read: true }, { read: true }]), 0);
  });
});
