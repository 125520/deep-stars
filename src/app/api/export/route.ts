import { NextResponse } from "next/server";

import { toLocalDayKey } from "@/lib/constellation";
import {
  EXPORT_FIELDS,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  countRecords,
  pickFields,
  serializeExport,
  type ExportCollection,
  type ExportPayload,
  type ExportRecord,
} from "@/lib/export-format";
import { prisma } from "@/lib/prisma";
import { clientKey, createRateLimiter, retryAfterSeconds } from "@/lib/rate-limit";
import { requireSession } from "@/lib/session";

/**
 * 导出全部数据
 * ══════════════════════════════════════════════════════════════════
 *
 * ── 三条必须守住的线 ────────────────────────────────────────────
 *
 * 1. **字段用白名单，不用黑名单**（见 export-format.ts 的 EXPORT_FIELDS）。
 *    逐字段列出要导出的内容，而不是"取全表再删掉 userId"。
 *    黑名单的问题在于：将来 schema 加了敏感字段（比如新的凭据列），
 *    导出会自动把它带上，而**没有人会收到提醒**。
 *    白名单的默认行为是"不导出"，加字段只会导致漏导出，不会导致泄露。
 *
 * 2. **绝不导出凭据。**
 *    Account（密码哈希）、Session（会话令牌）、UserApiKey（即使用户自己
 *    加密过的 AI Key）一律不进导出文件。前两个是显然的；
 *    第三个容易被忽略 —— 导出文件是要发给用户、可能落在网盘里的，
 *    把加密后的密钥一起给出去没有任何正当理由。
 *
 * 3. **限流。** 这是全站最昂贵的接口：一次要读八张表。
 *    它不需要被暴力破解，但一次误点或一个循环脚本就足以把数据库拖垮。
 */

/**
 * 每 IP 每分钟 6 次。
 * 正常用户一天导一两次就算多了，6 次留足了重试余地；
 * 而它把"脚本狂刷"从无限次压到 6 次/分钟。
 *
 * ⚠️ 存储是进程内存，多实例部署下实际上限是 6 × 实例数 ——
 * 详见 src/lib/rate-limit.ts 里的说明。这里的目标是防误用与拖库，不是对抗定向攻击。
 */
const exportLimiter = createRateLimiter({ limit: 6, windowMs: 60_000 });

export async function GET(request: Request) {
  /*
    限流放在鉴权之前：未登录的请求同样花掉配额。
    否则匿名刷这个接口不花钱，限流等于只挡住了已经登录的人。

    代价是**同一个出口 IP 后面的人共享配额**（公司/学校 NAT）。
    6 次/分钟对正常使用非常宽裕，所以这个代价可以接受；
    真要精细到"按用户限"，得先有会话再限 —— 而那时匿名请求又不受限了，
    两者只能选一个。
  */
  const limit = exportLimiter.check(clientKey(request.headers, "export"));
  if (!limit.ok) {
    return NextResponse.json(
      { error: "导出太频繁了，过一会儿再试。" },
      {
        status: 429,
        headers: {
          // Retry-After 是标准头，客户端与 CDN 都认；不返回的话对方只能瞎猜
          "Retry-After": String(retryAfterSeconds(limit.retryAfterMs)),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "未登录。" }, { status: 401 });
  }

  const userId = session.user.id;

  const [constellations, stars, checkins, plans, planTasks, todos, studyRecords, reviewCards] =
    await Promise.all([
      prisma.constellation.findMany({ where: { userId } }),
      prisma.star.findMany({ where: { userId } }),
      prisma.checkin.findMany({ where: { userId } }),
      prisma.plan.findMany({ where: { userId } }),
      prisma.planTask.findMany({ where: { userId } }),
      prisma.todo.findMany({ where: { userId } }),
      prisma.studyRecord.findMany({ where: { userId } }),
      prisma.reviewCard.findMany({ where: { userId } }),
    ]);

  const data = {
    constellations: pickFields(constellations, EXPORT_FIELDS.constellations),
    stars: pickFields(stars, EXPORT_FIELDS.stars),
    checkins: pickFields(checkins, EXPORT_FIELDS.checkins),
    plans: pickFields(plans, EXPORT_FIELDS.plans),
    planTasks: pickFields(planTasks, EXPORT_FIELDS.planTasks),
    todos: pickFields(todos, EXPORT_FIELDS.todos),
    studyRecords: pickFields(studyRecords, EXPORT_FIELDS.studyRecords),
    reviewCards: pickFields(reviewCards, EXPORT_FIELDS.reviewCards),
  } as Record<ExportCollection, ExportRecord[]>;

  // 走一遍 countRecords 而不是自己数，保证与解析端用的是同一套口径。
  // 显式标注 ExportPayload：否则 format 会被推断成 string，与字面量类型对不上。
  const payload: ExportPayload = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    counts: countRecords(data),
    data,
  };

  const filename = `deep-stars-${toLocalDayKey(new Date())}.json`;

  return new NextResponse(serializeExport(payload), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // filename* 用 UTF-8 编码，中文文件名在部分浏览器上才不会变成乱码；
      // 同时保留 ASCII 的 filename 作为回退
      "Content-Disposition": `attachment; filename="deep-stars-export.json"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      // 导出的是个人数据，任何中间层都不该缓存
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
