"use server";

import { revalidatePath } from "next/cache";

import type { Prisma } from "@db/client";
import {
  EXPORT_COLLECTIONS,
  EXPORT_FIELDS,
  IMPORT_ORDER,
  derivedIdFor,
  parseExport,
  pickFields,
  remapIds,
  summarize,
  type ExportCollection,
  type ExportRecord,
} from "@/lib/export-format";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

/**
 * 导入数据
 * ══════════════════════════════════════════════════════════════════
 *
 * ── 三条安全纪律 ────────────────────────────────────────────────
 *
 * 1. **归属按当前登录用户重建，绝不读文件里的 userId。**
 *    信任文件里的 userId 意味着任何人手工改一行就能把数据写进别人的账号。
 *    这也是导出文件里根本不写 userId 的原因 —— 让错误无从发生。
 *
 * 2. **字段按白名单过滤**（与导出共用 EXPORT_FIELDS）。
 *    不过滤的话，文件里随便什么字段都会被写进数据库，
 *    等于把"写哪些列"的决定权交给了一个用户提供的文件。
 *
 * 3. **id 已存在就整条跳过，不做覆盖。**
 *    于是导入**永远不可能改写已有数据** —— 包括别人的数据。
 *    顺带得到一个好性质：重复导入同一个文件是幂等的。
 *
 * ── 导入是追加，不是还原 ────────────────────────────────────────
 * 这一版只做合并（把文件里的记录补进来），不删除任何现有内容。
 * "清空后还原"是破坏性操作，需要单独的确认流程，留到以后再评估。
 */

export type ImportState =
  | { ok: true; created: number; summary: string }
  | { ok: false; error: string }
  | null;

/** 20 MB。几年的学习记录远小于这个数，超过基本是选错了文件。 */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * 查这些 id 里哪些已经存在。
 *
 * `userId` 传 null 表示**查全局**，传具体用户表示**只查他自己的**。
 * 两种查询对应两件不同的事，缺一不可：
 *   · 全局 → 主键是否已被占用（被占用了就得换一个新 id）
 *   · 本人 → 我是不是已经有这条记录（有了就跳过，这才是导入的幂等性）
 */
async function findExistingIds(
  collection: ExportCollection,
  ids: readonly string[],
  userId: string | null,
): Promise<string[]> {
  if (ids.length === 0) return [];

  const id = { in: [...ids] };
  const select = { id: true } as const;
  const filter = userId === null ? { id } : { id, userId };

  switch (collection) {
    case "constellations":
      return (await prisma.constellation.findMany({ where: filter, select })).map((r) => r.id);
    case "plans":
      return (await prisma.plan.findMany({ where: filter, select })).map((r) => r.id);
    case "checkins":
      return (await prisma.checkin.findMany({ where: filter, select })).map((r) => r.id);
    case "stars":
      return (await prisma.star.findMany({ where: filter, select })).map((r) => r.id);
    case "planTasks":
      return (await prisma.planTask.findMany({ where: filter, select })).map((r) => r.id);
    case "todos":
      return (await prisma.todo.findMany({ where: filter, select })).map((r) => r.id);
    case "studyRecords":
      return (await prisma.studyRecord.findMany({ where: filter, select })).map((r) => r.id);
    case "reviewCards":
      return (await prisma.reviewCard.findMany({ where: filter, select })).map((r) => r.id);
  }
}

export async function importData(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const session = await requireSession();
  if (!session) return { ok: false, error: "登录状态已过期，请重新登录。" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "请先选择一个导出文件。" };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `文件太大了（上限 ${MAX_BYTES / 1024 / 1024} MB）。` };
  }

  const parsed = parseExport(await file.text());
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const userId = session.user.id;
  const data = parsed.payload.data;

  /** 按白名单挑字段，并丢掉没有合法 id 的记录 */
  const picked = (collection: ExportCollection): ExportRecord[] =>
    pickFields(
      data[collection] as unknown as Record<string, unknown>[],
      EXPORT_FIELDS[collection],
    ).filter((record): record is ExportRecord => typeof record.id === "string" && record.id.length > 0);

  /*
    ── 三步：查全局占用 → 查我已有的 → 给别人的 id 换新的 ──────────

    ⚠️ 为什么必须查两次。

    第一版只查了全局，于是导入一份**别人的**导出文件时，里面所有 id 都
    已经存在于对方名下，整份文件被判定为"已存在"、一条都不导入，
    用户只看到"导入 0 条"。

    改成只查本人之后，那些记录不再被跳过 —— 但真的去插入时撞上了
    全局主键（`Unique constraint failed on the fields: (id)`），导入直接 500。
    两个极端都不对：**跳过和插入都不是正确答案，换 id 才是**。
  */
  const incoming = Object.fromEntries(
    EXPORT_COLLECTIONS.map((collection) => [collection, picked(collection)]),
  ) as Record<ExportCollection, ExportRecord[]>;

  /** 我已有的 id —— 这些整条跳过，保证重复导入同一个文件是幂等的 */
  const mine = new Set<string>();
  /** 库里已存在的 id（含我自己的）—— 非我所有的要换新 id */
  const taken = new Set<string>();

  for (const collection of EXPORT_COLLECTIONS) {
    const ids = incoming[collection].map((record) => record.id);
    if (ids.length === 0) continue;

    const [globalIds, myIds] = await Promise.all([
      findExistingIds(collection, ids, null),
      findExistingIds(collection, ids, userId),
    ]);
    for (const id of globalIds) taken.add(id);
    for (const id of myIds) mine.add(id);
  }

  const remap = new Map<string, string>();
  for (const id of taken) {
    // 确定性推导而不是随机 —— 否则同一个文件导两次会得到两份副本
    if (!mine.has(id)) remap.set(id, derivedIdFor(userId, id));
  }

  /** 归属在这里重建 —— 文件里的 userId 从头到尾没被读过 */
  const attach = <T>(records: readonly T[]): T[] =>
    records.map((record) => ({ ...record, userId })) as unknown as T[];

  /** 先改写 id 与引用，再重建归属 */
  /** 我已有的整条跳过 —— 这就是"重复导入同一个文件是幂等的" */
  const fresh = (collection: ExportCollection): ExportRecord[] =>
    incoming[collection].filter((record) => !mine.has(record.id));

  const ready = <T extends Record<string, unknown>>(
    records: readonly T[],
    collection: ExportCollection,
  ): T[] => attach(remapIds(records, collection, remap));

  const constellationsToWrite = ready(fresh("constellations"), "constellations");
  const plansToWrite = ready(fresh("plans"), "plans");
  const checkinsToWrite = ready(fresh("checkins"), "checkins");
  const starsToWrite = ready(fresh("stars"), "stars");
  const planTasksToWrite = ready(fresh("planTasks"), "planTasks");
  const todosToWrite = ready(fresh("todos"), "todos");
  const studyRecordsToWrite = ready(fresh("studyRecords"), "studyRecords");
  const reviewCardsToWrite = ready(fresh("reviewCards"), "reviewCards");

  /*
    按 IMPORT_ORDER 排列，后面按同一个顺序写入与计数。
    顺序**不能随意调换**：外键指向决定了先后（星指向星座与打卡、
    计划任务指向计划……），错了会得到外键约束错误，
    而报错只会说"约束失败"，不会告诉你该先插哪张表。
  */
  const byCollection: Record<ExportCollection, readonly Record<string, unknown>[]> = {
    constellations: constellationsToWrite,
    plans: plansToWrite,
    checkins: checkinsToWrite,
    stars: starsToWrite,
    planTasks: planTasksToWrite,
    todos: todosToWrite,
    studyRecords: studyRecordsToWrite,
    reviewCards: reviewCardsToWrite,
  };
  const written = IMPORT_ORDER.map((collection) => byCollection[collection]);

  let created = 0;

  /*
    放进一个事务：中途失败整体回滚。
    否则用户会拿到一个"导了一半"的账号，而且没有任何办法判断哪些进来了。
    （上面的查询在事务之外，理论上存在极小的竞态窗口；
    真撞上时主键冲突会让整个事务回滚，不会留下半份数据。）
  */
  await prisma.$transaction(async (tx) => {
    if (constellationsToWrite.length) {
      await tx.constellation.createMany({
        data: constellationsToWrite as unknown as Prisma.ConstellationCreateManyInput[],
      });
    }
    if (plansToWrite.length) {
      await tx.plan.createMany({
        data: plansToWrite as unknown as Prisma.PlanCreateManyInput[],
      });
    }
    if (checkinsToWrite.length) {
      await tx.checkin.createMany({
        data: checkinsToWrite as unknown as Prisma.CheckinCreateManyInput[],
      });
    }
    if (starsToWrite.length) {
      await tx.star.createMany({
        data: starsToWrite as unknown as Prisma.StarCreateManyInput[],
      });
    }
    if (planTasksToWrite.length) {
      await tx.planTask.createMany({
        data: planTasksToWrite as unknown as Prisma.PlanTaskCreateManyInput[],
      });
    }
    if (todosToWrite.length) {
      await tx.todo.createMany({
        data: todosToWrite as unknown as Prisma.TodoCreateManyInput[],
      });
    }
    if (studyRecordsToWrite.length) {
      await tx.studyRecord.createMany({
        data: studyRecordsToWrite as unknown as Prisma.StudyRecordCreateManyInput[],
      });
    }
    if (reviewCardsToWrite.length) {
      await tx.reviewCard.createMany({
        data: reviewCardsToWrite as unknown as Prisma.ReviewCardCreateManyInput[],
      });
    }

    /*
      记录总数 = 各集合长度之和。
      ⚠️ 不是 written.length —— 那是**集合的个数**（8），
      写成它会让 created 恒为 8，于是"一条都没导入"时也报"新导入"，
      消息自相矛盾。
    */
    created = written.reduce((sum, records) => sum + records.length, 0);
  });

  revalidatePath("/dashboard");
  revalidatePath("/stats");
  revalidatePath("/plans");
  revalidatePath("/todos");
  revalidatePath("/focus");

  const counts = Object.fromEntries(written.map((records, index) => [
    IMPORT_ORDER[index],
    records.length,
  ]));

  return {
    ok: true,
    created,
    summary:
      created > 0 ? `新导入 ${summarize(counts)}` : "文件里的记录已经全部存在，没有新增。",
  };
}
