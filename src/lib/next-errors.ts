/**
 * Next.js 的控制流信号
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ **Next 用「抛异常」来传递控制流，不是用返回值。**
 *
 *   redirect()   → 抛 digest 以 `NEXT_REDIRECT` 开头的错误
 *   notFound()   → 抛 digest 为 `NEXT_NOT_FOUND` 的错误
 *   动态渲染检测 → 抛 digest 为 `DYNAMIC_SERVER_USAGE` 的错误
 *
 * 于是 **`try/catch` 会成为陷阱**：一个本意是"读会话失败就当作未登录"的
 * 宽容写法，会顺手把这些信号一起吞掉 —— 重定向静默失效、
 * notFound 变成正常渲染、静态优化被破坏，而且**都不会报错**。
 *
 * 这个是生产构建时实测发现的：`/login` 与 `/register` 在构建阶段
 * 打印出「读取会话失败，按未登录处理：Dynamic server usage」——
 * 框架在用它传递信号，却被当成了故障。
 *
 * ── 用法 ────────────────────────────────────────────────────────
 *
 *   try { ... } catch (error) {
 *     if (isFrameworkSignal(error)) throw error;   // 先放行框架信号
 *     // 再处理自己关心的错误
 *   }
 */

/**
 * 是不是框架用来传递控制流的信号。
 *
 * 判据是 `digest`：
 *   · `DYNAMIC_SERVER_USAGE` —— 动态渲染检测
 *   · 以 `NEXT_` 开头 —— NEXT_REDIRECT / NEXT_NOT_FOUND /
 *     NEXT_HTTP_ERROR_FALLBACK 等，后面可能还跟着分号分隔的参数
 *
 * 用 digest 而不是 instanceof：这些错误类没有稳定的公开导出路径，
 * 而且 digest 是**跨越 server/client 边界**唯一被保留的字段。
 */
export function isFrameworkSignal(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest !== "string") return false;

  return digest === "DYNAMIC_SERVER_USAGE" || digest.startsWith("NEXT_");
}

/**
 * 在 catch 里决定该不该继续处理这个错误。
 *
 * 纯粹为了可读性：`if (shouldHandle(error))` 比
 * `if (!isFrameworkSignal(error))` 少一层否定，读起来不容易搞反。
 */
export function shouldHandle(error: unknown): boolean {
  return !isFrameworkSignal(error);
}
