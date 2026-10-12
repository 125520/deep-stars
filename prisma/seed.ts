/**
 * 种子数据
 * ══════════════════════════════════════════════════════════════════
 * 只写「全站共用的内容」—— 公告与模板。
 * 不种用户：账号必须走真实的注册流程，否则密码哈希逻辑会出现两份实现，
 * 早晚不一致。管理员的创建方式见 README 的「首个管理员」一节。
 *
 * 运行：pnpm db:seed
 * 幂等：按唯一字段 upsert，重复执行不会产生重复数据。
 */

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

import { databaseProviderFromUrl } from "../src/lib/db-provider.ts";
import { PrismaClient } from "./generated/client.ts";

// Node 不会自动读 .env；显式加载，缺失时静默跳过（CI 里通常直接注入环境变量）
try {
  process.loadEnvFile(".env");
} catch {
  /* 没有 .env 文件也没关系 */
}

const url = process.env.DATABASE_URL ?? "file:./dev.db";

/*
  ⚠️ 适配器必须跟着连接串走，**不能写死 SQLite**。

  第一版写死了 PrismaBetterSqlite3，本地跑得好好的 —— 但线上是 Neon 的
  PostgreSQL，`pnpm db:seed` 会直接失败。而"给线上种一份模板"恰恰是
  部署流程里的一步，这个错误会卡在最后一步才发现。

  判断与 src/lib/prisma.ts 共用同一个函数（纯模块，能被 Node 直接加载）。
*/
const adapter =
  databaseProviderFromUrl(url) === "postgresql"
    ? new PrismaPg({ connectionString: url })
    : new PrismaBetterSqlite3({ url });

const prisma = new PrismaClient({ adapter });

const PLAN_TEMPLATES = [
  {
    name: "考研冲刺 · 90 天",
    description: "把 90 天拆成三个阶段：打基础、强化、冲刺。每天的任务量按递减的容错率设计。",
    goal: "在 90 天内完成四科的系统复习并进入模考状态",
    document: `# 考研冲刺 · 90 天

## 目标
四科系统复习完毕，模考进入稳定区间。

## 阶段安排
- 第 1–35 天：基础轮。每科过一遍教材，建立笔记框架。
- 第 36–70 天：强化轮。真题分块训练，整理错题。
- 第 71–90 天：冲刺轮。整卷模考，只补薄弱点。

## 每日节奏
- 上午：数学（最需要清醒的时段）
- 下午：专业课
- 晚上：英语 + 政治
- 睡前 20 分钟：复习当天的间隔重复卡片

## 任务安排
- [ ] 数学：过完高数上册并整理笔记
- [ ] 数学：过完高数下册并整理笔记
- [ ] 数学：线性代数一轮
- [ ] 数学：概率论一轮
- [ ] 英语：核心词汇第一轮
- [ ] 英语：近十年阅读真题精做
- [ ] 政治：马原精讲
- [ ] 政治：毛中特精讲
- [ ] 专业课：教材一轮
- [ ] 专业课：真题分章训练
- [ ] 全科：第一次整卷模考
- [ ] 全科：第二次整卷模考
`,
  },
  {
    name: "期末两周突击",
    description: "两周内把一门课从零推到能过考试。核心是真题驱动的定向复习。",
    goal: "两周内掌握考点并通过期末考试",
    document: `# 期末两周突击

## 策略
不追求学完，只追求覆盖考点。先做一套真题定位，再按分值密度复习。

## 第一周
- 做一套往年真题，标出不会的题对应的章节
- 按分值从高到低补章节，每章配 10 道题验证

## 第二周
- 第二套真题，检查补漏效果
- 只攻仍然错的章节
- 考前三天开始间隔重复，把公式与定义过三遍

## 任务安排
- [ ] 做第一套真题并定位薄弱章节
- [ ] 按分值密度补前三个高频章节
- [ ] 每个高频章节配 10 道题验证
- [ ] 做第二套真题
- [ ] 攻克剩余错题
- [ ] 公式与定义进入间隔重复
- [ ] 考前模拟一次限时作答
`,
  },
  {
    name: "编程语言自学 · 项目驱动",
    description: "用做一个真实项目的方式学一门语言，避免「教程看完了什么也写不出」。",
    goal: "用四周时间独立完成一个可运行的小项目",
    document: `# 编程语言自学 · 项目驱动

## 原则
不做纯教程练习。每一个知识点都必须立刻用在项目里。

## 四周安排
- 第 1 周：语言基础 + 把项目骨架跑起来（哪怕功能是空的）
- 第 2 周：核心功能第一条链路打通
- 第 3 周：补边界情况、错误处理、测试
- 第 4 周：重构 + 写 README + 部署

## 每天
- 30 分钟读文档或源码（不刷视频教程）
- 90 分钟写代码
- 10 分钟记录今天卡在哪

## 任务安排
- [ ] 选定项目题目并写清验收标准
- [ ] 搭好项目骨架，能跑起来
- [ ] 打通第一条核心链路
- [ ] 补齐输入校验与错误处理
- [ ] 写第一组测试
- [ ] 重构一次，消除重复
- [ ] 写 README 并部署
`,
  },
];

const DOC_TEMPLATES = [
  {
    title: "读书笔记",
    content: `# 《书名》

## 一句话总结
（读完再回来写）

## 核心论点
1.
2.
3.

## 让我改变想法的三点
-

## 可以立刻用上的
-

## 摘录
> 
`,
  },
  {
    title: "错题复盘",
    content: `# 错题复盘 · 日期

## 题目
（抄题干或贴截图位置）

## 我当时的思路
（写下来才能发现错在哪一步）

## 正确思路
（重点写「我为什么没想到」）

## 同类题的特征
（下次见到什么信号要警觉）

## 是否加入间隔重复
- [ ] 是
`,
  },
  {
    title: "周复盘",
    content: `# 第 N 周复盘

## 数据
- 专注时长：
- 完成任务：
- 中断的天数：

## 做得好的
-

## 卡住的地方
-

## 下周只改一件事
（只写一件。写多了等于没改）
`,
  },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.warn("⚠ 未检测到 DATABASE_URL，使用默认 SQLite 路径 file:./prisma/dev.db");
  }

  // ── 公告 ──
  const existingAnnouncement = await prisma.announcement.findFirst({
    where: { title: "欢迎来到 Deep Stars" },
  });
  if (!existingAnnouncement) {
    await prisma.announcement.create({
      data: {
        title: "欢迎来到 Deep Stars",
        body: `## 从今晚点亮第一枚星

这里是你的星图。每天完成一次打卡，就会点亮一枚星；坚持得越久，星座连得越完整。

**三个建议：**

1. 先去「星图计划」建一个计划 —— 没有目标的打卡很快会变成负担。
2. 番茄钟结束时会自动写入学习记录，不用手动补。
3. 把今天学到的东西做成一两张复习卡，比多刷一小时题有用。

有任何问题，去实时频道问就好。`,
        published: true,
        popup: true,
      },
    });
    console.log("✓ 公告：欢迎来到 Deep Stars");
  } else {
    console.log("· 公告已存在，跳过");
  }

  // ── 计划模板 ──
  for (const t of PLAN_TEMPLATES) {
    const found = await prisma.planTemplate.findFirst({ where: { name: t.name } });
    if (found) {
      console.log(`· 计划模板已存在：${t.name}`);
      continue;
    }
    await prisma.planTemplate.create({ data: t });
    console.log(`✓ 计划模板：${t.name}`);
  }

  // ── 文档模板 ──
  for (const t of DOC_TEMPLATES) {
    const found = await prisma.documentTemplate.findFirst({ where: { title: t.title } });
    if (found) {
      console.log(`· 文档模板已存在：${t.title}`);
      continue;
    }
    await prisma.documentTemplate.create({ data: t });
    console.log(`✓ 文档模板：${t.title}`);
  }

  const counts = {
    公告: await prisma.announcement.count(),
    计划模板: await prisma.planTemplate.count(),
    文档模板: await prisma.documentTemplate.count(),
  };
  console.log("\n当前数据：", counts);
}

main()
  .catch((e) => {
    console.error("种子数据写入失败：", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
