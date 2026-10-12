/**
 * 造一批贴近真实用户的演示账号
 * ══════════════════════════════════════════════════════════════════
 *
 * 运行：
 *   pnpm db:seed:demo                    # 本地：造 220 个
 *   node scripts/seed-demo-users.ts --count 50
 *   node scripts/seed-demo-users.ts --reset   # 先删掉之前造的演示账号
 *
 * ⚠️ **要种到线上（Postgres）必须用 `pnpm db:seed:demo`，不能直接跑这个文件。**
 *
 * 原因：Prisma 会把 `activeProvider` **烤进生成的客户端**。本地生成的是 SQLite 版，
 * 拿 Postgres 连接串直接跑会抛
 * `The Driver Adapter '@prisma/adapter-pg' is not compatible with the provider 'sqlite'` —
 * 这句话与「你连错库了」毫无关系，却会让人往那个方向查（我自己就查过两次）。
 * `db:seed:demo` 里封装了正确顺序：渲染 schema 变体 → 按连接串生成客户端 → 播种。
 * 跑完记得在**新终端**里跑一次 `pnpm db:generate` 还原本地客户端。
 *
 * ── 为什么不手写密码哈希 ────────────────────────────────────────
 *
 * 这个仓库对「同一套逻辑两份实现」有过明确判断（见 prisma/seed.ts 的注释：
 * 账号必须走真实注册流程，否则密码哈希早晚会不一致）。
 * 但 220 个账号逐个走 Better Auth 的 HTTP 接口既慢又依赖服务在跑。
 * 折中：**调用 Better Auth 自己的 hashPassword**，格式与真实注册完全一致，
 * 只是省掉了网络往返。数据库结构也从真实注册出来的行反推，不靠猜。
 *
 * ── 昵称与内容 ──────────────────────────────────────────────────
 *
 * 全部是构造出来的，邮箱统一用 example.com（RFC 2606 保留域，永远不属于任何真人）。
 * 学习内容取自常见科目与真实的学习行为描述，不是随机字符 ——
 * 演示数据一旦看起来像机器人，就失去了"演示"的意义。
 */

import { hashPassword } from "better-auth/crypto";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  constellationProgress,
  pickComplexity,
  slotPosition,
  starMagnitude,
} from "../src/lib/constellation.ts";
import { databaseProviderFromUrl } from "../src/lib/db-provider.ts";
import { signFromBirthday, ZODIAC_SIGNS } from "../src/lib/zodiac.ts";
import { PrismaClient } from "../prisma/generated/client.ts";

try {
  process.loadEnvFile(".env");
} catch {
  /* 没有 .env 也能跑：环境变量可能已经由外部注入 */
}

const url = process.env.DATABASE_URL ?? "file:./dev.db";
const provider = databaseProviderFromUrl(url);
const adapter =
  provider === "postgresql"
    ? new PrismaPg({ connectionString: url })
    : new PrismaBetterSqlite3({ url });
const prisma = new PrismaClient({ adapter });

const args = process.argv.slice(2);
const COUNT = Number(args[args.indexOf("--count") + 1]) || 220;
const RESET = args.includes("--reset");

/** 所有演示账号共用的密码。报告里会写明。 */
const DEMO_PASSWORD = "DeepStars2026!";
const DEMO_EMAIL_DOMAIN = "demo.deepstars.example.com";

// ── 确定性随机 ────────────────────────────────────────────────────
// 用固定种子：同一条命令跑两次得到同一批数据，便于复现与比对。
let seed = 20261013;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;
const between = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));

// ── 人名 ─────────────────────────────────────────────────────────
const SURNAMES = "王李张刘陈杨黄赵吴周徐孙马朱胡林郭何高罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤".split("");
const GIVEN = "伟芳娜秀英敏静丽强磊军洋勇艳杰娟涛明超秀霞平刚桂英建华文博宇轩浩然子涵欣怡梓萱雨泽思远嘉怡雅婷俊杰晨曦若曦一鸣思睿语嫣新宇梦琪嘉豪诗涵博文子墨皓轩沐宸可欣佳怡".split("");
const name = () => `${pick(SURNAMES)}${pick(GIVEN)}${rnd() > 0.6 ? pick(GIVEN) : ""}`;

const PINYIN = "abcdefghijklmnopqrstuvwxyz".split("");
const handleFor = (i: number) => {
  let s = "";
  for (let k = 0; k < 7; k += 1) s += pick(PINYIN);
  return `${s}${i}`;
};

// ── 学习内容 ─────────────────────────────────────────────────────
const SUBJECTS = [
  "高等数学", "线性代数", "概率论", "英语阅读", "英语听力", "考研政治", "数据结构",
  "算法", "操作系统", "计算机网络", "数据库", "机器学习", "深度学习", "Python",
  "TypeScript", "Rust", "Go", "日语", "雅思", "托福", "专业课", "论文写作",
  "经济学", "会计", "法考", "教资", "公务员", "素描", "钢琴", "健身",
] as const;

const NOTES: Record<string, readonly string[]> = {
  基础: [
    "看了两节网课，把例题重做了一遍",
    "背了 40 个单词，早上和睡前各一遍",
    "把这一章的公式推导自己写了一遍",
    "刷了一组选择题，错的三道记进错题本",
    "读完了这一节，做了课后题",
    "整理了上一章的笔记，补了两处漏掉的推导",
    "把昨天错的题重做，这次全对",
    "听了半小时听力，跟读了两遍",
    "看论文，把方法部分读懂了",
    "复习昨天的内容，又忘了一点，巩固了一下",
  ],
  深入: [
    "啃了一个下午的难点，终于想通了那个反例",
    "把这个算法的三种实现都写了一遍，比较了复杂度",
    "自己写了个小项目练手，踩了几个坑",
    "推导了公式的完整过程，比书上多了一步说明",
    "做了两套真题，卡在第三部分",
    "把这一章的知识点画成了思维导图",
    "和同学讨论了两个小时，把疑惑点问清楚了",
    "debug 到半夜，问题出在一个边界条件上",
    "把之前的笔记重读一遍，发现了两个理解错误",
    "尝试不看答案独立完成，做出来了",
  ],
  挣扎: [
    "状态不太好，只看了二十分钟",
    "有点走神，效率不高，但还是坐下来看了",
    "这章太难了，看了两遍还是没完全懂",
    "今天事情多，只打了个卡",
    "硬着头皮看完了一节，明天再看一遍",
    "中途被打断好几次，勉强推进了一点",
    "很困，做了几道题就撑不住了",
    "卡在一个地方很久，最后跳过去了",
  ],
};

// ── 习惯原型 ─────────────────────────────────────────────────────
type Archetype = {
  key: string;
  weight: number;
  /** 每周大概打卡几天 */
  perWeek: number;
  /** 单次时长区间（小时） */
  hours: [number, number];
  /** 注册后大概活跃多少天 */
  lifespan: number;
  /** 内容偏向 */
  tone: keyof typeof NOTES;
};

const ARCHETYPES: readonly Archetype[] = [
  // 每天不落，连续几百天。这种人真实存在，而且是产品最好的样本。
  { key: "全勤", weight: 6, perWeek: 7, hours: [1.5, 5], lifespan: 500, tone: "深入" },
  // 一周四五次，偶尔断一天又接上
  { key: "稳定", weight: 22, perWeek: 4.5, hours: [1, 3.5], lifespan: 320, tone: "基础" },
  // 一周两三次，正常上班上学的节奏
  { key: "普通", weight: 32, perWeek: 2.8, hours: [0.5, 2.5], lifespan: 220, tone: "基础" },
  // 一阵一阵：连打两周，然后消失一个月
  { key: "波动", weight: 20, perWeek: 2.2, hours: [0.5, 3], lifespan: 260, tone: "挣扎" },
  // 三天打鱼两天晒网
  { key: "三天打鱼", weight: 14, perWeek: 1.2, hours: [0.5, 1.5], lifespan: 90, tone: "挣扎" },
  // 注册了，打了一两次就再没来过
  { key: "注册即弃", weight: 6, perWeek: 0.4, hours: [0.5, 1], lifespan: 12, tone: "挣扎" },
];

function pickArchetype(): Archetype {
  const total = ARCHETYPES.reduce((s, a) => s + a.weight, 0);
  let r = rnd() * total;
  for (const a of ARCHETYPES) {
    r -= a.weight;
    if (r <= 0) return a;
  }
  return ARCHETYPES[2]!;
}

/** 生日：月份按月均分布，日按当月天数 */
function randomBirthday(): string {
  const month = between(1, 12);
  const daysInMonth = new Date(2000, month, 0).getDate();
  const day = between(1, daysInMonth);
  const year = between(1988, 2006);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const DAY_MS = 86_400_000;

async function main(): Promise<void> {
  console.log(`\n演示账号种子 · 目标 ${COUNT} 个 · 数据库 ${provider}\n${"─".repeat(60)}`);

  if (RESET) {
    const gone = await prisma.user.deleteMany({ where: { email: { endsWith: DEMO_EMAIL_DOMAIN } } });
    console.log(`  已清理旧的演示账号：${gone.count} 个（级联删除其记录）`);
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const now = Date.now();

  let users = 0;
  let checkins = 0;
  let stars = 0;
  let completed = 0;
  const bySign = new Map<string, number>();
  const byArchetype = new Map<string, number>();

  for (let i = 1; i <= COUNT; i += 1) {
    const archetype = pickArchetype();
    const birthday = randomBirthday();
    const sign = signFromBirthday(birthday);
    if (!sign) continue;

    bySign.set(sign.key, (bySign.get(sign.key) ?? 0) + 1);
    byArchetype.set(archetype.key, (byArchetype.get(archetype.key) ?? 0) + 1);

    // 注册时间铺在过去两年里，并且要求"注册至今"够装下他的活跃期
    const maxAgo = Math.max(30, Math.min(730, archetype.lifespan + 60));
    const registeredDaysAgo = between(Math.min(20, archetype.lifespan), maxAgo);
    const createdAt = new Date(now - registeredDaysAgo * DAY_MS);

    const email = `demo${String(i).padStart(3, "0")}@${DEMO_EMAIL_DOMAIN}`;
    const handle = handleFor(i);
    const user = await prisma.user.create({
      data: {
        id: `demo${String(i).padStart(3, "0")}${Math.floor(rnd() * 1e6).toString(36)}`,
        name: name(),
        email,
        emailVerified: rnd() > 0.3,
        createdAt,
        updatedAt: new Date(now - between(0, registeredDaysAgo) * DAY_MS),
        birthday,
        handle,
        // 一小部分人开了公开页，符合真实比例
        isPublic: rnd() < 0.18,
        bio: rnd() < 0.25 ? pick(["在读研一", "转行学编程", "备考中", "下班后学点东西", "大四，准备考研"]) : null,
      },
      select: { id: true },
    });
    users += 1;

    await prisma.account.create({
      data: {
        id: `acc${user.id}`,
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: passwordHash,
        createdAt,
        updatedAt: createdAt,
      },
    });

    /*
      ── 造打卡记录 ──
      不是"每天按概率掷骰子"——那样波动型看起来会是均匀稀疏，
      而真实的波动是**成块**的：连着来两周，然后整月不见人。
      所以按"活跃期 / 停摆期"交替推进。
    */
    const activeDays = Math.min(archetype.lifespan, registeredDaysAgo);
    const days: number[] = [];
    let cursor = 0;
    while (cursor < activeDays) {
      const onLength =
        archetype.key === "波动" ? between(7, 21) : archetype.key === "三天打鱼" ? between(2, 5) : between(10, 40);
      const offLength =
        archetype.key === "波动" ? between(20, 45) : archetype.key === "三天打鱼" ? between(8, 20) : between(0, 4);

      for (let d = 0; d < onLength && cursor < activeDays; d += 1, cursor += 1) {
        // 活跃期内也不是天天来：按原型的目标频率抽
        if (rnd() < archetype.perWeek / 7) days.push(cursor);
      }
      cursor += offLength;
    }
    days.sort((a, b) => b - a); // 从近到远

    // ── 星座：按生日对应的模板，简约还是完整由习惯决定 ──
    const complexity = pickComplexity({
      activePlans: archetype.key === "全勤" || archetype.key === "稳定" ? 3 : 1,
      totalTasks: archetype.key === "全勤" ? 24 : archetype.key === "稳定" ? 14 : 6,
      // 演示数据不建计划，horizon 传 0；真实调用方同样如此，因为 Plan 没有结束日期
      longestPlanDays: 0,
    });
    const pattern = complexity === "simple" ? sign.simple : sign.full;

    const constellation = await prisma.constellation.create({
      data: {
        userId: user.id,
        name: sign.name,
        sign: sign.key,
        complexity,
        createdAt,
        updatedAt: createdAt,
      },
      select: { id: true },
    });

    let prevStarId: string | null = null;
    let lit = 0;
    const litDays = new Set<string>();

    for (const daysAgo of days) {
      const when = new Date(now - daysAgo * DAY_MS);
      when.setHours(between(7, 23), between(0, 59), 0, 0);
      const dayKey = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`;
      if (litDays.has(dayKey)) continue; // 一天一枚星
      litDays.add(dayKey);

      const hours = Math.round((archetype.hours[0] + rnd() * (archetype.hours[1] - archetype.hours[0])) * 2) / 2;
      const mood = archetype.tone === "挣扎" ? pick(["1", "2", "2", "3"]) : pick(["3", "4", "4", "5"]);
      const subject = pick(SUBJECTS);

      const checkin = await prisma.checkin.create({
        data: {
          userId: user.id,
          content: pick(NOTES[archetype.tone]!),
          hours,
          mood,
          subject,
          checkinDate: new Date(when.getFullYear(), when.getMonth(), when.getDate()),
          createdAt: when,
        },
        select: { id: true },
      });
      checkins += 1;

      // 星点数超过模板就不再落位（真实逻辑同样如此，见 slotPosition）
      const { x, y } = slotPosition(pattern, lit);
      const star: { id: string } = await prisma.star.create({
        data: {
          userId: user.id,
          constellationId: constellation.id,
          checkinId: checkin.id,
          magnitude: starMagnitude(hours, mood),
          x,
          y,
          prevStarId,
          litAt: new Date(when.getFullYear(), when.getMonth(), when.getDate()),
          createdAt: when,
        },
        select: { id: true },
      });
      prevStarId = star.id;
      lit += 1;
      stars += 1;
    }

    // 画满了就算完成；一小部分人完成后又开了一个新星座
    const progress = constellationProgress(pattern, lit);
    if (progress.complete) {
      completed += 1;
      const lastDay = days.length ? days[0]! : 0;
      await prisma.constellation.update({
        where: { id: constellation.id },
        data: { completedAt: new Date(now - lastDay * DAY_MS) },
      });

      if (rnd() < 0.4) {
        const next = ZODIAC_SIGNS[Math.floor(rnd() * ZODIAC_SIGNS.length)]!;
        const nextPattern = complexity === "simple" ? next.simple : next.full;
        const nextConstellation = await prisma.constellation.create({
          data: {
            userId: user.id,
            name: next.name,
            sign: next.key,
            complexity,
            createdAt: new Date(now - between(1, Math.max(2, lastDay)) * DAY_MS),
          },
          select: { id: true },
        });
        // 新星座上也点几枚，让它不是空的
        const extra = between(1, Math.max(1, nextPattern.stars.length - 1));
        for (let k = 0; k < extra; k += 1) {
          const when = new Date(now - between(0, Math.max(1, lastDay - 1)) * DAY_MS);
          when.setHours(between(7, 23), between(0, 59), 0, 0);
          const { x, y } = slotPosition(nextPattern, k);
          await prisma.star.create({
            data: {
              userId: user.id,
              constellationId: nextConstellation.id,
              magnitude: starMagnitude(between(1, 4), "4"),
              x,
              y,
              litAt: new Date(when.getFullYear(), when.getMonth(), when.getDate()),
              createdAt: when,
            },
          });
          stars += 1;
        }
      }
    }
  }

  console.log(`  账号      ${users}`);
  console.log(`  打卡      ${checkins}`);
  console.log(`  星点      ${stars}`);
  console.log(`  画满星座  ${completed}`);
  console.log(`\n  星座分布  ${[...bySign.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${ZODIAC_SIGNS.find((s) => s.key === k)?.name ?? k}${v}`).join(" · ")}`);
  console.log(`  习惯分布  ${[...byArchetype.entries()].map(([k, v]) => `${k}${v}`).join(" · ")}`);
  console.log(`\n  登录密码  ${DEMO_PASSWORD}`);
  console.log(`  邮箱格式  demo001@${DEMO_EMAIL_DOMAIN} … demo${String(COUNT).padStart(3, "0")}@${DEMO_EMAIL_DOMAIN}\n`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error("种子失败：", error);
    await prisma.$disconnect();
    process.exit(1);
  });
