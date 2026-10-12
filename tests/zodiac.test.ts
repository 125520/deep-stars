import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ZODIAC_SIGNS, signFromBirthday, type ZodiacPattern } from "../src/lib/zodiac.ts";

/**
 * 星图布局是「用户攒下来的东西」——打卡的成果最终就长在这份数据上。
 * 所以这里测的不是实现细节，而是几条一旦破坏就会让人肉眼看出问题的约束：
 * 数量、边距、简约档与完整档的包含关系、连线的合法性、以及生日区间不多不少。
 */

/** 黄道顺序在这里再写死一份：顺序错了必须报错，而不是跟着实现一起错。 */
const ZODIAC_ORDER = [
  "aries",
  "taurus",
  "gemini",
  "cancer",
  "leo",
  "virgo",
  "libra",
  "scorpio",
  "sagittarius",
  "capricorn",
  "aquarius",
  "pisces",
];

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const pad = (n: number) => String(n).padStart(2, "0");

/** 一年的 365 天（2 月按 28 天展开：星座只跟月日有关，闰日不改变归属） */
function everyDay(): string[] {
  const days: string[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const last = DAYS_IN_MONTH[month - 1] ?? 0;
    for (let day = 1; day <= last; day += 1) days.push(`${pad(month)}-${pad(day)}`);
  }
  return days;
}

/**
 * 把一个星座的闭区间展开成「覆盖了哪些天」。
 * 必须按环形走：摩羯座 12-22 ~ 01-19 跨年，按大小比较会得到空集，
 * 而空集恰好能让「无缝无重叠」的断言以错误的方式通过。
 */
function coveredDays(from: string, to: string): string[] {
  const all = everyDay();
  const start = all.indexOf(from);
  const end = all.indexOf(to);
  assert.ok(start >= 0 && end >= 0, `区间的月日不合法: ${from} ~ ${to}`);

  const days: string[] = [];
  for (let i = start; ; i = (i + 1) % all.length) {
    days.push(all[i]!);
    if (i === end) break;
  }
  return days;
}

/** 并查集数连通块：确认连线真的把图形连起来了，而不是画了一堆孤岛 */
function countComponents(pattern: ZodiacPattern): number {
  const parent = pattern.stars.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    for (;;) {
      const next = parent[root];
      if (next === undefined || next === root) break;
      root = next;
    }
    return root;
  };
  for (const [a, b] of pattern.links) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  }
  return new Set(pattern.stars.map((_, index) => find(index))).size;
}

const distance = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

describe("ZODIAC_SIGNS 骨架", () => {
  it("恰好 12 个星座，key 唯一且都是小写英文", () => {
    assert.equal(ZODIAC_SIGNS.length, 12);
    const keys = ZODIAC_SIGNS.map((sign) => sign.key);
    assert.equal(new Set(keys).size, 12, `key 有重复: ${keys.join(", ")}`);
    for (const key of keys) {
      assert.match(key, /^[a-z]+$/, `key 不是小写英文: ${key}`);
    }
  });

  it("按黄道顺序排列（白羊 → 双鱼），顺序不能被重排", () => {
    assert.deepEqual(
      ZODIAC_SIGNS.map((sign) => sign.key),
      ZODIAC_ORDER,
    );
  });

  it("中文名与英文名齐全", () => {
    for (const sign of ZODIAC_SIGNS) {
      assert.ok(sign.name.endsWith("座"), `${sign.key} 的中文名不像星座名: ${sign.name}`);
      assert.match(sign.nameEn, /^[A-Z][a-z]+$/, `${sign.key} 的英文名不对: ${sign.nameEn}`);
      assert.match(sign.from, /^\d{2}-\d{2}$/);
      assert.match(sign.to, /^\d{2}-\d{2}$/);
    }
  });
});

describe("星点数量与结构", () => {
  it("simple 是 5~7 枚，full 是 9~14 枚", () => {
    for (const sign of ZODIAC_SIGNS) {
      assert.ok(
        sign.simple.stars.length >= 5 && sign.simple.stars.length <= 7,
        `${sign.key} 的 simple 有 ${sign.simple.stars.length} 枚，应在 5~7`,
      );
      assert.ok(
        sign.full.stars.length >= 9 && sign.full.stars.length <= 14,
        `${sign.key} 的 full 有 ${sign.full.stars.length} 枚，应在 9~14`,
      );
      assert.ok(
        sign.full.stars.length > sign.simple.stars.length,
        `${sign.key} 的 full 并不比 simple 详细`,
      );
    }
  });

  it("simple 的每颗星都能在 full 里找到同坐标的那颗（简约是完整的子集）", () => {
    for (const sign of ZODIAC_SIGNS) {
      const used = new Set<number>();
      for (const star of sign.simple.stars) {
        const index = sign.full.stars.findIndex(
          (full, i) =>
            !used.has(i) &&
            distance(full.x, full.y, star.x, star.y) < 1e-9 &&
            full.magnitude === star.magnitude &&
            full.name === star.name,
        );
        assert.ok(
          index >= 0,
          `${sign.key}: simple 的「${star.name ?? "无名星"}」在 full 里没有同坐标的星 —— 升档时星点会挪位`,
        );
        used.add(index);
      }
    }
  });

  it("每颗星都有中文名，星等落在 0..1，且每个星座都有一颗说得上亮的星", () => {
    for (const sign of ZODIAC_SIGNS) {
      for (const pattern of [sign.simple, sign.full]) {
        for (const star of pattern.stars) {
          assert.ok(
            typeof star.name === "string" && star.name.length > 0,
            `${sign.key} 有星点没填中文名（坐标 ${star.x}, ${star.y}）`,
          );
          assert.ok(
            star.magnitude > 0 && star.magnitude <= 1,
            `${sign.key} 的「${star.name}」星等越界: ${star.magnitude}`,
          );
        }
      }
      const brightest = Math.max(...sign.full.stars.map((star) => star.magnitude));
      assert.ok(brightest >= 0.5, `${sign.key} 整座星座都太暗了（最亮 ${brightest}）`);
    }
  });
});

describe("坐标与留边", () => {
  it("所有 x/y 落在 0..1 的归一化坐标系内", () => {
    for (const sign of ZODIAC_SIGNS) {
      for (const pattern of [sign.simple, sign.full]) {
        for (const star of pattern.stars) {
          assert.ok(
            star.x >= 0 && star.x <= 1 && star.y >= 0 && star.y <= 1,
            `${sign.key} 坐标越界: (${star.x}, ${star.y})`,
          );
        }
      }
    }
  });

  it("所有 x/y 落在 0.08..0.92 —— 图形居中且不贴边", () => {
    for (const sign of ZODIAC_SIGNS) {
      for (const pattern of [sign.simple, sign.full]) {
        for (const star of pattern.stars) {
          assert.ok(
            star.x >= 0.08 && star.x <= 0.92,
            `${sign.key} 的 x 贴边了: ${star.x}（「${star.name}」）`,
          );
          assert.ok(
            star.y >= 0.08 && star.y <= 0.92,
            `${sign.key} 的 y 贴边了: ${star.y}（「${star.name}」）`,
          );
        }
      }
    }
  });

  it("没有缩成一小团：每个星座至少撑满画布的一条轴", () => {
    for (const sign of ZODIAC_SIGNS) {
      const xs = sign.full.stars.map((star) => star.x);
      const ys = sign.full.stars.map((star) => star.y);
      const spanX = Math.max(...xs) - Math.min(...xs);
      const spanY = Math.max(...ys) - Math.min(...ys);
      assert.ok(
        Math.max(spanX, spanY) >= 0.8,
        `${sign.key} 的图形太小了: ${spanX.toFixed(2)} x ${spanY.toFixed(2)}`,
      );
    }
  });

  it("同一星座内没有两颗星重合（昴宿星团可以靠得很近，但不该叠在一起）", () => {
    for (const sign of ZODIAC_SIGNS) {
      const { stars } = sign.full;
      for (let i = 0; i < stars.length; i += 1) {
        for (let j = i + 1; j < stars.length; j += 1) {
          const a = stars[i]!;
          const b = stars[j]!;
          const gap = distance(a.x, a.y, b.x, b.y);
          assert.ok(
            gap > 0.005,
            `${sign.key} 的「${a.name}」与「${b.name}」几乎重叠: ${gap.toFixed(4)}`,
          );
        }
      }
    }
  });
});

describe("连线", () => {
  it("下标都在 stars 范围内，且没有自环", () => {
    for (const sign of ZODIAC_SIGNS) {
      for (const pattern of [sign.simple, sign.full]) {
        for (const [a, b] of pattern.links) {
          for (const index of [a, b]) {
            assert.ok(Number.isInteger(index), `${sign.key} 的连线下标不是整数: ${index}`);
            assert.ok(
              index >= 0 && index < pattern.stars.length,
              `${sign.key} 的连线下标越界: ${index}（共 ${pattern.stars.length} 枚星）`,
            );
          }
          assert.notEqual(a, b, `${sign.key} 出现了自环: ${a}-${b}`);
        }
      }
    }
  });

  it("没有重复连线（同一条边画两遍就是重复劳动）", () => {
    for (const sign of ZODIAC_SIGNS) {
      for (const pattern of [sign.simple, sign.full]) {
        const seen = new Set<string>();
        for (const [a, b] of pattern.links) {
          const key = [a, b].sort((x, y) => x - y).join("-");
          assert.ok(!seen.has(key), `${sign.key} 的连线 ${key} 重复了`);
          seen.add(key);
        }
      }
    }
  });

  it("没有孤零零悬空的星：每颗星至少连着一条线", () => {
    for (const sign of ZODIAC_SIGNS) {
      for (const pattern of [sign.simple, sign.full]) {
        const touched = new Set<number>();
        for (const [a, b] of pattern.links) {
          touched.add(a);
          touched.add(b);
        }
        assert.equal(
          touched.size,
          pattern.stars.length,
          `${sign.key} 有星点没连线（${pattern === sign.simple ? "simple" : "full"}）`,
        );
      }
    }
  });

  it("连线把图形连成一体：只有金牛座的昴宿星团是有意独立的一小簇", () => {
    for (const sign of ZODIAC_SIGNS) {
      const expected = sign.key === "taurus" ? 2 : 1;
      assert.equal(
        countComponents(sign.full),
        expected,
        `${sign.key} 的 full 断成了 ${countComponents(sign.full)} 块`,
      );
      assert.equal(
        countComponents(sign.simple),
        1,
        `${sign.key} 的 simple 断成了 ${countComponents(sign.simple)} 块`,
      );
    }
  });

  it("点亮顺序沿轮廓走：相邻两次点亮的星不会跳到星座另一头", () => {
    for (const sign of ZODIAC_SIGNS) {
      for (const pattern of [sign.simple, sign.full]) {
        for (let i = 0; i + 1 < pattern.stars.length; i += 1) {
          const a = pattern.stars[i]!;
          const b = pattern.stars[i + 1]!;
          const jump = distance(a.x, a.y, b.x, b.y);
          // 分叉图形（双子、室女、双鱼）一笔画不完，顺序里必然有一次跳跃。
          // 阈值取 0.55：实测最大 0.51，而随机重排会轻松超过 0.8。
          assert.ok(
            jump <= 0.55,
            `${sign.key} 第 ${i} → ${i + 1} 枚之间跳得太远: ${jump.toFixed(3)}`,
          );
        }
      }
    }
  });
});

describe("生日区间", () => {
  it("12 段刚好铺满一年：每一天恰好属于一个星座，不重不漏", () => {
    const owner = new Map<string, string>();
    for (const sign of ZODIAC_SIGNS) {
      for (const day of coveredDays(sign.from, sign.to)) {
        const previous = owner.get(day);
        assert.equal(
          previous,
          undefined,
          `${day} 同时被 ${previous} 与 ${sign.key} 覆盖（区间重叠）`,
        );
        owner.set(day, sign.key);
      }
    }

    const all = everyDay();
    assert.equal(owner.size, all.length, `只覆盖了 ${owner.size} 天，应为 ${all.length} 天`);
    for (const day of all) {
      assert.ok(owner.has(day), `${day} 没有任何星座覆盖（区间有缝隙）`);
    }
  });

  it("每个区间的首尾两天都算自己（闭区间）", () => {
    const edges: Array<[string, string]> = [
      ["03-21", "aries"],
      ["04-19", "aries"],
      ["04-20", "taurus"],
      ["05-20", "taurus"],
      ["05-21", "gemini"],
      ["06-21", "gemini"],
      ["06-22", "cancer"],
      ["07-22", "cancer"],
      ["07-23", "leo"],
      ["08-22", "leo"],
      ["08-23", "virgo"],
      ["09-22", "virgo"],
      ["09-23", "libra"],
      ["10-23", "libra"],
      ["10-24", "scorpio"],
      ["11-22", "scorpio"],
      ["11-23", "sagittarius"],
      ["12-21", "sagittarius"],
      ["12-22", "capricorn"],
      ["01-19", "capricorn"],
      ["01-20", "aquarius"],
      ["02-18", "aquarius"],
      ["02-19", "pisces"],
      ["03-20", "pisces"],
    ];
    for (const [day, key] of edges) {
      assert.equal(signFromBirthday(day)?.key, key, `${day} 应该算 ${key}`);
    }
  });

  it("摩羯座跨年：12-22 到 01-19 全都在区间内，两端之外不属于它", () => {
    assert.equal(signFromBirthday("12-22")?.key, "capricorn");
    assert.equal(signFromBirthday("12-31")?.key, "capricorn");
    assert.equal(signFromBirthday("01-01")?.key, "capricorn");
    assert.equal(signFromBirthday("01-19")?.key, "capricorn");
    assert.equal(signFromBirthday("12-21")?.key, "sagittarius");
    assert.equal(signFromBirthday("01-20")?.key, "aquarius");
  });
});

describe("signFromBirthday()", () => {
  const samples: Array<[string, string]> = [
    ["03-25", "aries"],
    ["04-25", "taurus"],
    ["06-01", "gemini"],
    ["07-01", "cancer"],
    ["08-01", "leo"],
    ["09-01", "virgo"],
    ["10-01", "libra"],
    ["11-01", "scorpio"],
    ["12-01", "sagittarius"],
    ["01-01", "capricorn"],
    ["02-01", "aquarius"],
    ["03-01", "pisces"],
  ];

  it("每个星座各取一个代表日期都能认对", () => {
    for (const [day, key] of samples) {
      assert.equal(signFromBirthday(day)?.key, key, `${day} 应该是 ${key}`);
    }
  });

  it("YYYY-MM-DD 与 MM-DD 两种写法结果一致", () => {
    for (const [day, key] of samples) {
      assert.equal(signFromBirthday(`1990-${day}`)?.key, key, `1990-${day} 应该是 ${key}`);
      assert.equal(signFromBirthday(`2000-${day}`)?.key, key, `2000-${day} 应该是 ${key}`);
      assert.equal(signFromBirthday(day)?.key, key);
    }
    assert.equal(signFromBirthday("1990-03-25")?.key, signFromBirthday("03-25")?.key);
  });

  it("返回的是 ZODIAC_SIGNS 里的那一份，不是临时拼的对象", () => {
    const aries = ZODIAC_SIGNS.find((sign) => sign.key === "aries");
    assert.equal(signFromBirthday("03-25"), aries);
  });

  it("首尾空白不影响解析", () => {
    assert.equal(signFromBirthday(" 03-25 ")?.key, "aries");
    assert.equal(signFromBirthday("\t1990-03-25\n")?.key, "aries");
  });

  it("空串、乱码、日期越界都返回 null，而不是抛错或猜一个默认星座", () => {
    const invalid = [
      "",
      "   ",
      "不是日期",
      "1990/03/25",
      "25-03",
      "3-25",
      "1990-3-25",
      "1990-03-25-01",
      "03-25 加一句话",
      "13-01",
      "00-15",
      "03-00",
      "03-32",
      "04-31",
      "02-30",
      "1990-13-01",
      "1990-00-10",
      "1990-03-00",
      "1990-03-32",
      "1990-04-31",
      "abcdefgh",
      "03-2a",
    ];
    for (const value of invalid) {
      assert.equal(signFromBirthday(value), null, `「${value}」应该解析失败`);
    }
  });

  it("闰日 02-29 是有效生日，落在双鱼座", () => {
    // 星座只跟月日有关，不需要为了判断闰年把年份拖进来
    assert.equal(signFromBirthday("2000-02-29")?.key, "pisces");
    assert.equal(signFromBirthday("02-29")?.key, "pisces");
  });
});
