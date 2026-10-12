import { createHash } from "node:crypto";

/**
 * 导出文件格式
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯函数，不碰数据库。整个模块只解决两件事：
 *   **写出一个能被信任的格式**，以及 **判断读进来的东西能不能被信任**。
 *
 * ── 三条设计原则 ────────────────────────────────────────────────
 *
 * 1. **带格式标识与版本号。** 没有这两个字段，将来改了结构就无法区分
 *    "旧版本的文件"和"根本不是这个产品的文件"，只能笼统报一句解析失败。
 *
 * 2. **导出文件里不含 userId。** 导入时必须用**当前登录用户**的 id 重建归属。
 *    如果信任文件里的 userId，任何人手工改一行就能把数据写进别人的账号 ——
 *    这不是理论风险，而是导入功能最典型的漏洞。
 *
 * 3. **保留原始 id。** 星与星座之间是外键关系，重新生成 id 会让星全部脱锚，
 *    导入后得到一片没有归属的散点。保留 id 还带来一个好处：
 *    重复导入同一个文件是**幂等**的（见 filterNewRecords）。
 */

export const EXPORT_FORMAT = "deep-stars-export";
export const EXPORT_VERSION = 1;

/** 导出文件里包含的集合。顺序无关，但遍历时用它保证顺序稳定。 */
export const EXPORT_COLLECTIONS = [
  "constellations",
  "stars",
  "checkins",
  "plans",
  "planTasks",
  "todos",
  "studyRecords",
  "reviewCards",
] as const;

export type ExportCollection = (typeof EXPORT_COLLECTIONS)[number];

/** 每条记录都必须是对象，且至少有一个字符串 id —— 归属与关联全靠它 */
export type ExportRecord = { id: string } & Record<string, unknown>;

/**
 * 每个集合允许进出的字段。**导出与导入共用同一张白名单。**
 *
 * 两边必须一致，而且必须是白名单：
 *   · 导出时用黑名单（"取全表再删掉 userId"），将来 schema 加了敏感列，
 *     导出会自动带上，**没有人会收到提醒**
 *   · 导入时不做过滤，文件里随便什么字段都会被写进数据库 ——
 *     那等于把写库的字段选择权交给了一个用户提供的文件
 *
 * `userId` 一律不在其中：归属在导入时按**当前登录用户**重建。
 */
export const EXPORT_FIELDS: Record<ExportCollection, readonly string[]> = {
  constellations: ["id", "name", "description", "accent", "archived", "createdAt", "updatedAt"],
  stars: [
    "id",
    "constellationId",
    "checkinId",
    "magnitude",
    "x",
    "y",
    "prevStarId",
    "litAt",
    "createdAt",
  ],
  checkins: [
    "id",
    "planId",
    "content",
    "hours",
    "subject",
    "mood",
    "blocker",
    "checkinDate",
    "createdAt",
    "updatedAt",
  ],
  plans: [
    "id",
    "name",
    "description",
    "goal",
    "document",
    "startDate",
    "status",
    "createdAt",
    "updatedAt",
  ],
  planTasks: [
    "id",
    "planId",
    "title",
    "description",
    "dayNumber",
    "weekNumber",
    "category",
    "status",
    "priority",
    "completedAt",
    "createdAt",
    "updatedAt",
  ],
  todos: ["id", "title", "completed", "sortOrder", "createdAt", "updatedAt"],
  studyRecords: ["id", "date", "totalMinutes", "subject", "checkinId", "source", "createdAt"],
  reviewCards: [
    "id",
    "front",
    "back",
    "tags",
    "planId",
    "dueAt",
    "interval",
    "ease",
    "reps",
    "lapses",
    "createdAt",
    "updatedAt",
  ],
};

/**
 * 每个集合里**指向其他记录 id 的字段**。
 *
 * 导入时如果某个 id 已被别人占用、必须换一个新 id，那么指向它的记录
 * 也要一起改写 —— 漏掉一个就会得到外键约束错误，而报错只会说
 * "约束失败"，不会告诉你是哪个字段。
 */
export const EXPORT_REFERENCES: Record<ExportCollection, readonly string[]> = {
  constellations: [],
  plans: [],
  todos: [],
  stars: ["constellationId", "checkinId", "prevStarId"],
  checkins: ["planId"],
  planTasks: ["planId"],
  studyRecords: ["checkinId"],
  reviewCards: ["planId"],
};

/**
 * 为一个"被占用的" id 推导出属于自己的新 id。
 *
 * ── 为什么必须是确定性的，不能用随机 id ──────────────────────────
 *
 * 用 `randomUUID()` 时实测踩到：同一份别人的导出文件连导两次，
 * 第二次又生成了一批新 id、"我是否已有这条记录"自然匹配不上，
 * 于是**又导入了一份副本** —— 幂等性没了。
 *
 * 而"重复导入同一个文件不产生重复"是这个功能明确承诺的性质
 * （不幂等的话，用户手滑点两次就会得到两份数据，且没有任何提示）。
 *
 * 所以新 id 由 **（我的 userId，原 id）** 唯一决定：
 *   · 同一个文件、同一个账号 → 每次算出同一个 id → 第二次被判定为"已存在"而跳过
 *   · 不同账号导入同一个文件   → 各自算出不同的 id → 两份互不冲突的副本
 *
 * ⚠️ 不是密码学用途，但**必须避免碰撞**：用 sha256 而不是手写的简单哈希。
 * 输出成带连字符的 32 位十六进制，与 cuid 形态上不冲突（cuid 没有连字符）。
 */
export function derivedIdFor(userId: string, originalId: string): string {
  const hash = createHash("sha256").update(`${userId}\u0000${originalId}`).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join("-");
}

/**
 * 按 remap 改写记录自身的 id 与它引用的 id。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────
 *
 * id 是**全局主键**。导入一份别人的导出文件时，文件里的 id 已经存在于
 * 对方名下 —— 直接插入会撞主键（500），而按"已存在就跳过"处理又等于
 * 一条都导不进来、用户只看到"导入 0 条"。
 *
 * 正确的语义是分开处理：
 *   · id 是**我自己的** → 跳过（这才是"导入"的幂等性）
 *   · id 是**别人的**   → 换一个新 id 导进来，并改写所有指向它的引用
 *
 * remap 里没有的 id 原样保留；值为 null/undefined 的引用字段不动。
 */
export function remapIds<T extends Record<string, unknown>>(
  records: readonly T[],
  collection: ExportCollection,
  remap: ReadonlyMap<string, string>,
): T[] {
  if (remap.size === 0) return [...records];

  const references = EXPORT_REFERENCES[collection];

  return records.map((record) => {
    const next: Record<string, unknown> = { ...record };

    const ownId = record.id;
    if (typeof ownId === "string" && remap.has(ownId)) {
      next.id = remap.get(ownId);
    }

    for (const field of references) {
      const value = record[field];
      if (typeof value === "string" && remap.has(value)) {
        next[field] = remap.get(value);
      }
    }

    return next as T;
  });
}

/**
 * 按白名单挑字段。
 *
 * 注意过滤后**可能没有 id** —— 调用方传入的记录来自用户文件，
 * 不能假定它有 id。所以这里只负责挑，形状校验交给 isExportRecord。
 */
export function pickFields(
  rows: readonly Record<string, unknown>[],
  fields: readonly string[],
): ExportRecord[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in row) out[field] = row[field];
    }
    return out as ExportRecord;
  });
}

/**
 * 导入时的写入顺序。**不能随意调换。**
 *
 * 外键指向决定了先后：星指向星座与打卡，计划任务指向计划，
 * 专注记录与复习卡分别指向打卡与计划。
 * 顺序错了会得到外键约束错误 —— 而且报错信息只会说"约束失败"，
 * 不会告诉你该先插哪张表。
 */
export const IMPORT_ORDER: readonly ExportCollection[] = [
  "constellations",
  "plans",
  "checkins",
  "stars",
  "planTasks",
  "todos",
  "studyRecords",
  "reviewCards",
];

export type ExportPayload = {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  counts: Record<string, number>;
  data: Record<ExportCollection, ExportRecord[]>;
};

export type ParseResult =
  | { ok: true; payload: ExportPayload }
  | { ok: false; error: string };

/** 单条记录的形状检查。只看 id：其余字段由各表写入时各自兜底，不在这里穷举。 */
function isExportRecord(value: unknown): value is ExportRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" && id.length > 0;
}

export function serializeExport(payload: ExportPayload): string {
  // 缩进 2 空格：导出文件是给人看的，用户有权打开确认里面有什么
  return JSON.stringify(payload, null, 2);
}

/**
 * 解析并校验一个导出文件。
 *
 * 每一类失败都给**能指导下一步动作**的话，而不是笼统的"解析失败"：
 * 用户面对的是一个自己挑选的文件，他需要知道是选错了文件、
 * 文件损坏了、还是版本太新。
 */
export function parseExport(raw: string): ParseResult {
  if (!raw || !raw.trim()) {
    return { ok: false, error: "文件是空的。" };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: "文件不是有效的 JSON，可能已损坏或不是导出文件。" };
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "文件内容不是一个对象。" };
  }

  const envelope = value as Record<string, unknown>;

  if (envelope.format !== EXPORT_FORMAT) {
    return { ok: false, error: "这不是 Deep Stars 的导出文件。" };
  }

  const version = envelope.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: "文件缺少有效的版本号。" };
  }
  if (version > EXPORT_VERSION) {
    return {
      ok: false,
      error: `文件来自更新的版本（v${version}），当前最高支持 v${EXPORT_VERSION}。请先升级。`,
    };
  }

  const data = envelope.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, error: "文件缺少 data 字段。" };
  }

  const source = data as Record<string, unknown>;
  const normalized = {} as Record<ExportCollection, ExportRecord[]>;

  for (const collection of EXPORT_COLLECTIONS) {
    const list = source[collection];
    // 缺一个集合不算错误：旧版本可能没有它，用户也可能手工删掉了某一段。
    // 当作空数组，让能导入的部分先导进来。
    if (list === undefined || list === null) {
      normalized[collection] = [];
      continue;
    }
    if (!Array.isArray(list)) {
      return { ok: false, error: `data.${collection} 不是数组。` };
    }
    const invalid = list.findIndex((item) => !isExportRecord(item));
    if (invalid >= 0) {
      return {
        ok: false,
        error: `data.${collection} 第 ${invalid + 1} 条记录缺少有效的 id。`,
      };
    }
    normalized[collection] = list as ExportRecord[];
  }

  return {
    ok: true,
    payload: {
      format: EXPORT_FORMAT,
      version,
      exportedAt: typeof envelope.exportedAt === "string" ? envelope.exportedAt : "",
      counts: countRecords(normalized),
      data: normalized,
    },
  };
}

export function countRecords(
  data: Record<ExportCollection, readonly ExportRecord[]>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const collection of EXPORT_COLLECTIONS) {
    counts[collection] = data[collection].length;
  }
  return counts;
}

/**
 * 挑出数据库里还没有的记录。
 *
 * 这是"重复导入同一个文件是幂等的"得以成立的地方：
 * 已经存在的 id 直接跳过，不会产生第二份副本。
 *
 * 同时**过滤掉文件内部自身的重复 id** —— 手工拼出来的文件里可能有，
 * 而带重复 id 的批量插入会整批失败，让用户看到一句和业务无关的数据库错误。
 */
export function filterNewRecords(
  incoming: readonly ExportRecord[],
  existingIds: ReadonlySet<string>,
): ExportRecord[] {
  const seen = new Set<string>();
  const fresh: ExportRecord[] = [];

  for (const record of incoming) {
    if (!isExportRecord(record)) continue;
    if (existingIds.has(record.id)) continue;
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    fresh.push(record);
  }

  return fresh;
}

/** 给界面用的一句话摘要 */
export function summarize(counts: Record<string, number>): string {
  const LABELS: Record<string, string> = {
    constellations: "星座",
    stars: "星",
    checkins: "打卡",
    plans: "计划",
    planTasks: "计划任务",
    todos: "待办",
    studyRecords: "专注记录",
    reviewCards: "复习卡",
  };

  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => `${n} 条${LABELS[key] ?? key}`);

  return parts.length > 0 ? parts.join(" · ") : "没有任何记录";
}
