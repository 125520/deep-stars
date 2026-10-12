import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ZODIAC_SIGNS } from "../src/lib/zodiac.ts";
import {
  COMPLEXITY_LABELS,
  ORNATE_TARGET,
  ornatePattern,
  patternFor,
} from "../src/lib/zodiac-ornate.ts";

describe("ornatePattern() 沿轮廓采样出复杂档", () => {
  it("**12 个星座都补到 30 枚上下** —— 这是这一档存在的理由：轮廓足够密才看得出图案", () => {
    for (const sign of ZODIAC_SIGNS) {
      const ornate = ornatePattern(sign);
      assert.ok(
        ornate.stars.length >= 26 && ornate.stars.length <= 34,
        `${sign.name} 的复杂档有 ${ornate.stars.length} 枚，超出 26~34`,
      );
    }
  });

  it("**完整档的每一颗星都在复杂档里，且坐标逐位相同** —— 否则升档时已点亮的星会挪位", () => {
    for (const sign of ZODIAC_SIGNS) {
      const ornate = ornatePattern(sign);
      for (const star of sign.full.stars) {
        const found = ornate.stars.some(
          (o) => Math.abs(o.x - star.x) < 1e-9 && Math.abs(o.y - star.y) < 1e-9,
        );
        assert.ok(found, `${sign.name} 完整档的某颗星在复杂档里找不到同坐标的点`);
      }
    }
  });

  it("新点的星等是暗档，不与原有亮星抢眼", () => {
    for (const sign of ZODIAC_SIGNS) {
      const ornate = ornatePattern(sign);
      const extras = ornate.stars.filter(
        (o) => !sign.full.stars.some((f) => Math.abs(f.x - o.x) < 1e-9 && Math.abs(f.y - o.y) < 1e-9),
      );
      assert.ok(extras.length > 0, `${sign.name} 没有新增点`);
      for (const e of extras) {
        assert.ok(e.magnitude >= 0.1 && e.magnitude <= 0.4, `新增点星等 ${e.magnitude} 不在暗档`);
        assert.equal(e.name, undefined, "采样点不该有星名 —— 它不是真实恒星");
      }
    }
  });

  it("**点亮顺序最大跳距远小于完整档** —— 这是「点亮过程中看得清图案」的关键", () => {
    for (const sign of ZODIAC_SIGNS) {
      const jump = (p: { stars: readonly { x: number; y: number }[] }) => {
        let m = 0;
        for (let i = 1; i < p.stars.length; i += 1) {
          m = Math.max(m, Math.hypot(p.stars[i]!.x - p.stars[i - 1]!.x, p.stars[i]!.y - p.stars[i - 1]!.y));
        }
        return m;
      };
      const ornateJump = jump(ornatePattern(sign));
      assert.ok(ornateJump < 0.25, `${sign.name} 复杂档跳距 ${ornateJump.toFixed(3)} 太大，点亮会跳着走`);
      assert.ok(
        ornateJump < jump(sign.full),
        `${sign.name} 复杂档的跳距没有比完整档更小`,
      );
    }
  });

  it("所有坐标落在 0..1", () => {
    for (const sign of ZODIAC_SIGNS) {
      for (const s of ornatePattern(sign).stars) {
        assert.ok(s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1, `${sign.name} 有坐标越界`);
      }
    }
  });

  it("连线下标合法且无自环", () => {
    for (const sign of ZODIAC_SIGNS) {
      const o = ornatePattern(sign);
      for (const [a, b] of o.links) {
        assert.ok(a >= 0 && a < o.stars.length, `${sign.name} 连线下标越界`);
        assert.ok(b >= 0 && b < o.stars.length, `${sign.name} 连线下标越界`);
        assert.notEqual(a, b, `${sign.name} 有自环连线`);
      }
    }
  });

  it("结果是确定的 —— 同样的输入每次得到同样的图", () => {
    const a = ornatePattern(ZODIAC_SIGNS[0]!);
    const b = ornatePattern(ZODIAC_SIGNS[0]!);
    assert.deepEqual(a, b);
  });

  it("目标点数可调", () => {
    const coarse = ornatePattern(ZODIAC_SIGNS[0]!, 16);
    assert.ok(coarse.stars.length >= 16 && coarse.stars.length < 26);
  });

  it("目标点数小于完整档时，退化为完整档本身而不是裁掉星", () => {
    const sign = ZODIAC_SIGNS[0]!;
    const tiny = ornatePattern(sign, 2);
    assert.equal(tiny.stars.length, sign.full.stars.length);
  });

  it("默认目标就是导出的常量", () => {
    assert.equal(ornatePattern(ZODIAC_SIGNS[0]!).stars.length, ORNATE_TARGET);
  });
});

describe("patternFor() 按档位取布局", () => {
  const sign = ZODIAC_SIGNS[0]!;

  it("三档各自正确", () => {
    assert.equal(patternFor(sign, "simple").stars.length, sign.simple.stars.length);
    assert.equal(patternFor(sign, "full").stars.length, sign.full.stars.length);
    assert.equal(patternFor(sign, "ornate").stars.length, ORNATE_TARGET);
  });

  it("**无法识别的值回退到完整档，不抛错** —— 数据库里可能存着旧的或空的值", () => {
    for (const bad of ["", "xxx", null, undefined, "ORNATE", "繁复"]) {
      assert.equal(
        patternFor(sign, bad as string | null | undefined).stars.length,
        sign.full.stars.length,
        `「${String(bad)}」应当回退到完整档`,
      );
    }
  });
});

describe("COMPLEXITY_LABELS", () => {
  it("三档都有中文名与一句说明", () => {
    for (const key of ["simple", "full", "ornate"] as const) {
      assert.ok(COMPLEXITY_LABELS[key].name.length > 0);
      assert.ok(COMPLEXITY_LABELS[key].hint.length > 0);
    }
  });
});
