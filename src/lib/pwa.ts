/**
 * PWA 辅助
 * ══════════════════════════════════════════════════════════════════
 *
 * 只在浏览器里调用。两件事：注册 Service Worker、退出登录时清缓存。
 */

const SW_URL = "/sw.js";
/** 与 public/sw.js 里的前缀保持一致 —— 清缓存按这个前缀来 */
const CACHE_PREFIX = "deep-stars-";

export function registerServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  /*
    开发模式带上 ?mode=dev。
    开发下 /_next/ 的产物不是内容哈希命名，cache-first 会一直吐旧代码 ——
    表现为"改了代码页面没反应"，而且很难联想到是 SW 干的。
    SW 本身照常注册，所以离线页与页面缓存仍可在开发下验证。
  */
  const url = process.env.NODE_ENV === "production" ? SW_URL : `${SW_URL}?mode=dev`;

  void navigator.serviceWorker.register(url, { scope: "/" }).catch((error: unknown) => {
    // 注册失败不影响正常使用，只少了离线能力，所以不往上抛
    console.warn("[pwa] Service Worker 注册失败：", error);
  });
}

/**
 * 清空本应用写入的所有缓存。
 *
 * **退出登录时必须调用。** 页面缓存里是上一次会话渲染出来的个人数据，
 * 共用设备上如果不清理，下一个用户按后退键就可能翻到上一个人的页面。
 * 这是"缓存个人页面"这个取舍能成立的前提。
 *
 * 直接在当前页面操作 caches，而不是给 SW 发消息：
 * 页面上下文本来就能访问 CacheStorage，少一条消息往返，
 * 而且在 SW 尚未接管页面时（首次访问）同样有效。
 */
export async function clearAppCaches(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) return;

  try {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => caches.delete(key)),
    );
  } catch (error) {
    // 清理失败不该阻断退出登录 —— 用户点了退出就必须退出
    console.warn("[pwa] 清理缓存失败：", error);
  }
}
