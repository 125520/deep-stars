/**
 * 站点地址归一化
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯函数。解决一个很具体的问题：**环境变量给过来的地址可能没有协议头。**
 *
 * Render 注入的 `RENDER_EXTERNAL_HOSTNAME` 是 `xxx.onrender.com` ——
 * 只有主机名，没有 `https://`。而 Better Auth 的 `trustedOrigins`
 * 拿它去和请求的 `Origin`（`https://xxx.onrender.com`）比对，
 * 字符串不相等就直接按 CSRF 拒绝 —— **表现是"登录按钮点了没反应"**，
 * 而报错发生在库内部，从页面上什么线索都看不到。
 *
 * 所以在这里补齐协议头，让部署时不必手动回填地址、也不必重新部署一次。
 *
 * ── 为什么 localhost 是特例 ─────────────────────────────────────
 *
 * 裸写 `localhost:3210` 时补成 `https://` 是错的 —— 本地开发跑的是 http，
 * 补错了会让来源校验失败，而且同样是"登录没反应"这种没有线索的故障。
 * 只有这一种情况要补 `http://`，所以单独列出来。
 */

/** 本地开发的主机名。这些补 http://，其余补 https:// */
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;
const HAS_SCHEME = /^https?:\/\//i;

/**
 * 把一段可能是"裸主机名"的地址补成完整 URL。
 *
 * 返回 `undefined` 表示没配置 —— 调用方据此决定要不要登记为可信来源，
 * 而不是塞一个空字符串进去（空串会被当成一个"来源"，反而更难排查）。
 */
export function normalizeSiteUrl(raw: string | null | undefined): string | undefined {
  // 结尾斜杠去掉：`https://a.com/` 与 `https://a.com` 必须是同一个来源，
  // 否则两台机器上的同一个部署会因为写法不同而一台能登录一台不能
  const value = (raw ?? "").trim().replace(/\/+$/, "");

  if (!value) return undefined;
  if (HAS_SCHEME.test(value)) return value;

  return LOCAL_HOST.test(value) ? `http://${value}` : `https://${value}`;
}

/**
 * 从若干个候选里取第一个能用的地址。
 *
 * 顺序即优先级：显式配置优先于平台注入的。
 * 单独写成一个函数而不是在 auth.ts 里写 `??` 链，是为了能被测试覆盖 ——
 * 这条链一旦写错，故障表现是"线上登录没反应"，最难查的那一类。
 */
export function pickSiteUrl(...candidates: (string | null | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    const normalized = normalizeSiteUrl(candidate);
    if (normalized) return normalized;
  }
  return undefined;
}
