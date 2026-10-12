/**
 * Service Worker
 * ══════════════════════════════════════════════════════════════════
 *
 * 手写而不是接 next-pwa / serwist：那些插件要挂进构建流程，
 * 而本项目的构建产物是 Next 16 + Turbopack 生成的哈希文件名，
 * 插件一旦跟不上版本就会**静默降级**（SW 装上了但什么都没缓存）。
 * 这里用运行期策略，不依赖构建产物清单。
 *
 * ── 三条策略 ────────────────────────────────────────────────────
 *
 * 1. **静态产物：cache-first。** /_next/static 下的文件名带内容哈希，
 *    内容变了 URL 就变，所以可以永久缓存。
 *
 * 2. **页面导航：network-first。** 页面是**带个人数据**的服务端渲染结果，
 *    cache-first 会让用户看到过期内容。网络失败时才回落到缓存，
 *    再失败才给离线页。
 *
 * 3. **接口一律不碰。** 以 /api 开头的请求绝不进缓存 ——
 *    那是最直接的隐私泄露面。
 *
 * ── 关于缓存个人页面这件事 ──────────────────────────────────────
 * 缓存页面确实会在同一台设备上留下数据痕迹。之所以接受：
 *   · 离线可用的价值主要就在这里（否则"离线"只剩一个空壳）
 *   · 退出登录时会**清空全部缓存**（见 src/lib/pwa.ts），
 *     所以换了人用这台设备，上一个用户的痕迹会被抹掉
 * 这是一个明确的取舍，不是一个疏忽。
 */

const VERSION = "v1";
const STATIC_CACHE = `deep-stars-static-${VERSION}`;
const PAGE_CACHE = `deep-stars-pages-${VERSION}`;
const OFFLINE_URL = "/offline";

/*
  开发模式：注册时带 ?mode=dev。
  开发下 /_next/ 的产物**不是**内容哈希命名，cache-first 会一直吐旧代码，
  HMR 直接失效且现象诡异（改了代码没反应）。所以开发模式只跳过静态产物缓存，
  页面与离线页照常工作 —— 这样 SW 本身在开发下也能被真实地验证。
*/
const DEV_MODE = new URL(self.location.href).searchParams.get("mode") === "dev";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PAGE_CACHE);

      /*
        预缓存离线页。
        
        ⚠️ **不能直接用 cache.add()。** 它对非 2xx 响应会 reject，
        于是整个 install 事件失败、SW 永远停在 installing 状态 ——
        连"缓存静态资源"这类毫不相关的能力也一起没了，
        而且现象是"SW 装了但什么都不工作"，极难定位。
        （这不是假想：离线页曾因一个服务端报错返回 500，
         表现正是如此。）
        
        所以取不到就跳过：SW 照常工作，只是少了离线兜底。
      */
      try {
        const response = await fetch(new Request(OFFLINE_URL, { cache: "reload" }));
        if (response.ok) {
          await cache.put(OFFLINE_URL, response);
        } else {
          console.warn("[sw] 离线页返回 " + response.status + "，跳过预缓存");
        }
      } catch (error) {
        console.warn("[sw] 预缓存离线页失败：", error);
      }

      // 新版 SW 立即接管，不等所有标签页关闭
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 清掉旧版本缓存。键名里带版本号就是为了这一步能做到精确清理。
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("deep-stars-") && !key.endsWith(VERSION))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // 非 GET 一律放行：打卡、导入这些写操作必须走网络
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // 只处理同源。第三方（将来可能的 AI 接口）不归这里管。
  if (url.origin !== self.location.origin) return;

  // /api 一律不碰，交给网络。缓存接口响应 = 缓存别人的会话数据。
  if (url.pathname.startsWith("/api/")) return;

  // 带 Range 的请求（音视频）不缓存，免得处理 partial content
  if (request.headers.has("range")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    if (DEV_MODE) return; // 开发下交给网络，保证 HMR 正常
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  try {
    const response = await fetch(request);
    // 只缓存成功且是 basic 类型的响应：opaque 响应无法判断内容是否有效
    if (response.ok && response.type === "basic") {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    // 静态产物取不到又没有缓存，只能把错误抛回去让页面自己处理
    throw error;
  }
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGE_CACHE);

  try {
    const response = await fetch(request);
    /*
      只缓存"看起来是完整页面"的响应。
      被重定向到登录页的响应也在这里 —— 那是正常的、该被缓存的页面。
      但 5xx 不该进缓存：把一次服务端故障固化下来，用户之后每次都会看到它。
    */
    if (response.ok && response.type === "basic") {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // 网络断了：优先给这个地址上次成功的结果
    const cached = await cache.match(request);
    if (cached) return cached;

    // 没来过这个地址：给离线页，而不是浏览器的恐龙
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;

    return new Response("离线，且没有可用的缓存。", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
