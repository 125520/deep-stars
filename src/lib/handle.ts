/**
 * 公开主页的用户名（handle）
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯函数。这个模块存在的意义是**把校验规则收在一处**：
 * 它同时被"设置页保存"和"公开页查库"两条路径依赖，
 * 分开写迟早会出现"存得进去、查不出来"的 handle。
 */

/** 长度下限。2 个字符太容易被撞、也不像个名字。 */
const MIN_LENGTH = 3;
/** 上限 24：够长，又不至于在 URL 里难看 */
const MAX_LENGTH = 24;

/**
 * 保留名单。
 *
 * ⚠️ **必须覆盖真实存在的路由。** 公开页在 `/u/<handle>`，
 * 而 handle 只占一段路径，所以 app 下的顶层路由名本身不会撞车；
 * 但下面这些仍然要挡：
 *   · `u` 让 `/u/u` 这种地址显得莫名其妙
 *   · `api` / `_next` / `icons` 是给系统用的前缀
 *   · 常见运营词（admin、help…）挡掉，避免将来做活动页时冲突
 *
 * 这份名单和 app 目录是**手动同步**的关系 —— 新增顶层路由时
 * 如果那个名字也该被挡，记得回来加一条。
 */
export const RESERVED_HANDLES: readonly string[] = [
  "u",
  "api",
  "admin",
  "root",
  "system",
  "login",
  "logout",
  "register",
  "signup",
  "signin",
  "settings",
  "dashboard",
  "plans",
  "focus",
  "todos",
  "stats",
  "offline",
  "about",
  "help",
  "support",
  "terms",
  "privacy",
  "new",
  "edit",
  "me",
  "my",
  "null",
  "undefined",
  "true",
  "false",
  "static",
  "public",
  "assets",
  "icons",
  "favicon",
  "_next",
  "manifest",
  "robots",
  "sitemap",
];

/** 允许的字符：小写字母、数字、连字符、下划线 */
const ALLOWED = /^[a-z0-9_-]+$/;

/**
 * 归一化：去空格、转小写。
 *
 * 转小写是必须的：URL 路径在部分环节会大小写不敏感，
 * 如果允许存 `Alice`，`/u/alice` 和 `/u/Alice` 就会有两种行为，
 * 而数据库的唯一约束是**大小写敏感**的 —— 于是 `Alice` 和 `alice`
 * 能同时存在，指向两个不同的主页。
 */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

export type HandleCheck =
  | { ok: true; handle: string }
  | { ok: false; error: string };

export function validateHandle(raw: string): HandleCheck {
  const handle = normalizeHandle(raw ?? "");

  if (!handle) return { ok: false, error: "请先设一个用户名。" };

  /*
    ⚠️ **字符集检查必须排在长度检查之前。**
    反过来会出现这样的体验：用户输入「星野」，得到"至少 3 个字符"，
    于是老老实实再加一个字，**这时才被告知中文根本不允许** ——
    白改一次。先报不可用的字符，提示才是可操作的。
  */
  if (!ALLOWED.test(handle)) {
    return { ok: false, error: "只能用英文小写字母、数字、连字符和下划线。" };
  }

  if (handle.length < MIN_LENGTH) {
    return { ok: false, error: `用户名至少 ${MIN_LENGTH} 个字符。` };
  }
  if (handle.length > MAX_LENGTH) {
    return { ok: false, error: `用户名最多 ${MAX_LENGTH} 个字符。` };
  }
  // 允许内部有连字符，但首尾不行：`-name` 与 `name-` 在地址里像是缺了一段
  if (handle.startsWith("-") || handle.endsWith("-")) {
    return { ok: false, error: "用户名不能以连字符开头或结尾。" };
  }
  if (handle.startsWith("_") || handle.endsWith("_")) {
    return { ok: false, error: "用户名不能以下划线开头或结尾。" };
  }
  if (RESERVED_HANDLES.includes(handle)) {
    return { ok: false, error: "这个用户名被系统保留了，换一个吧。" };
  }

  return { ok: true, handle };
}

/** 公开主页的路径。集中在一处，免得各处手拼字符串拼错。 */
export function profilePath(handle: string): string {
  return `/u/${handle}`;
}
