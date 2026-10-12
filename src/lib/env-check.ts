/**
 * 环境变量自检
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯函数，输入是一份环境变量，输出是「致命的」与「该警告的」两组名字。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────
 *
 * 缺 `BETTER_AUTH_SECRET` 时 Better Auth 会在生产模式拒绝工作 —— 这个行为本身
 * 是对的（悄悄用一个内置密钥上线比崩溃危险得多）。但它呈现出来的样子是：
 *
 *   · 页面全部正常打开（因为 readSession 会把异常吞掉、当成"未登录"）
 *   · 只有登录和注册返回 500，而且响应体是空的（生产模式不暴露错误详情）
 *   · 真正的原因只在服务端日志里，而点页面的人看不到
 *
 * 于是故障现象是「网站能打开，但一登录就 500」，与真正的原因毫无关系 ——
 * 这是最贵的一类问题。所以在**构建或启动时**就把缺失项喊出来：
 * 让部署直接失败，比让用户面对一个看起来正常、实则不可登录的站点好得多。
 *
 * ── 分两档，不是一个开关 ────────────────────────────────────────
 *
 * 「致命」= 应用根本不可用，应当拒绝启动。
 * 「警告」= 某个功能会坏，但站点能用 —— 这类不值得拦住部署，
 *          但必须在日志里说清楚，免得几天后才发现某个功能一直没生效。
 */

/** 应用不可用：缺了它，登录注册全线失败 */
const FATAL_KEYS = ["BETTER_AUTH_SECRET"] as const;

/** 功能受限：站点能用，但某一块会静默不工作 */
const DEGRADED_KEYS = ["DEEP_STARS_SECRET", "DEEP_STARS_ADMIN_EMAIL"] as const;

/** 每个键的一句话说明，直接进错误信息 —— 让人不用去翻代码 */
const EXPLAIN: Record<string, string> = {
  BETTER_AUTH_SECRET:
    "会话签名密钥。缺失时 Better Auth 在生产模式拒绝工作，表现为「页面能开、一登录就 500」。生成：openssl rand -base64 32",
  DEEP_STARS_SECRET:
    "用户自带 AI 密钥的加密密钥（AES-256-GCM，至少 16 字符）。缺失时「设置 → AI 密钥」会保存失败。生成：openssl rand -hex 32",
  DEEP_STARS_ADMIN_EMAIL:
    "引导管理员邮箱。缺失时没有任何账号能进入 /admin，而第一个管理员没法由后台自己产生。",
};

export type EnvCheckInput = Record<string, string | undefined>;

export type EnvCheckResult = {
  /** 缺了它应用不可用 */
  fatal: { key: string; reason: string }[];
  /** 站点能用，但对应功能会坏 */
  degraded: { key: string; reason: string }[];
};

/**
 * 检查一份环境变量。
 *
 * `isProduction` 由调用方传入而不是在这里读 `process.env.NODE_ENV` ——
 * 这样这个函数是纯的，能被直接测试；也避免"测试环境里忘了设 NODE_ENV
 * 于是自检不生效"这种自欺欺人的情况。
 */
export function checkEnv(env: EnvCheckInput, isProduction: boolean): EnvCheckResult {
  const fatal: EnvCheckResult["fatal"] = [];
  const degraded: EnvCheckResult["degraded"] = [];

  // 空字符串与只有空白都算没设 —— 环境变量面板里很容易留下这种值
  const missing = (key: string) => (env[key] ?? "").trim().length === 0;

  // 数据库连接串两端都必需：没有它连开发服务器都起不来
  if (missing("DATABASE_URL")) {
    fatal.push({
      key: "DATABASE_URL",
      reason: "数据库连接串。本地 file:./dev.db，线上填 Neon 的 postgresql://…",
    });
  }

  /*
    以下只在生产环境检查。
    本地起开发服务器或跑测试时不该被密钥拦住 —— Better Auth 在非生产模式
    会自己兜底并打警告，够用了。
    （第一版把致命项的循环写在了这个分支外面，于是本地缺密钥也会被拦，
     与"开发环境只检查数据库"的注释自相矛盾。是测试把它逮住的。）
  */
  if (!isProduction) return { fatal, degraded };

  for (const key of FATAL_KEYS) {
    if (missing(key)) fatal.push({ key, reason: EXPLAIN[key] ?? "" });
  }

  for (const key of DEGRADED_KEYS) {
    if (missing(key)) degraded.push({ key, reason: EXPLAIN[key] ?? "" });
  }

  // DEEP_STARS_SECRET 太短同样会导致加密失败，提前说
  const secret = (env.DEEP_STARS_SECRET ?? "").trim();
  if (secret.length > 0 && secret.length < 16) {
    degraded.push({
      key: "DEEP_STARS_SECRET",
      reason: `太短了（当前 ${secret.length} 字符，至少 16）—— 保存 AI 密钥时会失败`,
    });
  }

  return { fatal, degraded };
}

/** 把检查结果拼成一段能直接读的错误信息 */
export function formatEnvProblems(result: EnvCheckResult): string {
  const lines = ["环境变量不完整：", ""];
  for (const item of result.fatal) {
    lines.push(`  ✗ ${item.key}（必需）`);
    if (item.reason) lines.push(`      ${item.reason}`);
  }
  lines.push("", "在部署平台的环境变量面板里补上，然后重新部署。");
  return lines.join("\n");
}
