/**
 * 头像的校验与规格
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯函数。头像存的是 **data URL**（见 schema 里 AvatarChange 的注释）——
 * 零对象存储，Vercel 的只读文件系统也不会出问题。
 *
 * 代价是它必须**足够小**：data URL 是 base64，体积约为原图的 1.37 倍，
 * 而它会跟着每一次查询用户的地方一起被读出来。一张 2MB 的照片变成
 * 2.7MB 的字符串塞进数据库行里，页面上每个显示头像的地方都会变慢 ——
 * 所以这里把上限卡得很死，并且**在浏览器端就压缩**（见 avatar-form.tsx）。
 */

/** 允许的 MIME。刻意不含 image/svg+xml —— SVG 可以内嵌脚本。 */
export const ALLOWED_MIME = ["image/webp", "image/png", "image/jpeg"] as const;

/** 服务端最终接受的最大字节数（指 data URL 字符串本身的长度） */
export const MAX_DATA_URL_LENGTH = 120_000;

/** 头像的边长（像素）。256 在高分屏的头像位置上已经足够。 */
export const AVATAR_SIZE = 256;

/** 保留多少条历史。超出的从最旧的开始删。 */
export const AVATAR_HISTORY_LIMIT = 5;

const DATA_URL_PATTERN = /^data:(image\/(?:webp|png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/;

export type AvatarCheck = { ok: true; mime: string } | { ok: false; error: string };

/**
 * 校验一个 data URL 是否可以存成头像。
 *
 * ⚠️ 这条校验**只在服务端做是有意义的**：客户端那套压缩再靠谱，
 * 请求也可以被伪造。所以两边都要跑同一个函数 —— 客户端跑是为了
 * 给用户即时反馈，服务端跑是因为**它才是真正说了算的那一边**。
 */
export function validateAvatarDataUrl(raw: string | null | undefined): AvatarCheck {
  const value = (raw ?? "").trim();

  if (!value) return { ok: false, error: "没有选择图片。" };

  if (!value.startsWith("data:")) {
    return { ok: false, error: "图片格式不对（期望 data URL）。" };
  }

  const match = DATA_URL_PATTERN.exec(value);
  if (!match) {
    /*
      正则一次性排除了三件事：非白名单的 MIME（含 SVG）、
      非 base64 的编码方式、以及夹带了非法字符的内容。
      分步判断会在某一步漏掉一个分支，一次匹配更难写错。
    */
    return { ok: false, error: "只支持 PNG / JPEG / WebP，且必须是 base64 编码的图片。" };
  }

  if (value.length > MAX_DATA_URL_LENGTH) {
    const kb = Math.round(value.length / 1024);
    const limit = Math.round(MAX_DATA_URL_LENGTH / 1024);
    return { ok: false, error: `图片太大了（${kb} KB，上限 ${limit} KB），请换一张或先裁剪。` };
  }

  return { ok: true, mime: match[1]! };
}

/**
 * 计算保存新头像后该保留哪些历史。
 *
 * 返回**需要删除的历史 id**，而不是"保留哪些" ——
 * 调用方的动作是删除，让它拿到自己要做的事比拿一份要留下的清单更直接。
 */
export function historyToPrune<T extends { id: string; createdAt: Date }>(
  history: readonly T[],
  limit: number = AVATAR_HISTORY_LIMIT,
): string[] {
  // 按时间倒序：最新的在前
  const sorted = [...history].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return sorted.slice(limit).map((item) => item.id);
}
