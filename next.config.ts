import type { NextConfig } from "next";

import { checkEnv, formatEnvProblems } from "./src/lib/env-check.ts";

/**
 * 构建期环境变量自检
 * ══════════════════════════════════════════════════════════════════
 *
 * 放在这里而不是只放在 src/lib/auth.ts：`next build` 会**执行**这个文件，
 * 但只会**编译** auth.ts —— 实际验证过，把自检只放在 auth.ts 里，
 * 缺密钥时构建照样成功，问题要等到有人点登录才以 500 的形式暴露。
 *
 * 真实事故：线上部署后页面全部正常，唯独登录注册 500 且响应体为空；
 * 真正的原因（缺 BETTER_AUTH_SECRET）只在服务端日志里。这个自检把它
 * 提前成**部署失败** —— 部署失败一眼就能看见，静默坏掉不能。
 *
 * 生产环境才检查：本地起开发服务器不该被密钥拦住
 * （Better Auth 在非生产模式会自己兜底并打警告）。
 */
const envProblems = checkEnv(process.env, process.env.NODE_ENV === "production");
if (envProblems.fatal.length > 0) {
  throw new Error(formatEnvProblems(envProblems));
}
for (const item of envProblems.degraded) {
  console.warn(`[env] ${item.key}：${item.reason}`);
}

/**
 * 安全响应头
 * ══════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ 关于 CSP 回退：这里踩过一次坑，务必读完 ──────────────────
 *
 * **没写的指令会回退到 `default-src`。** 这不是可选项，是规范行为。
 *
 * 第一版只写了 `default-src 'self'` 而漏了 `style-src`，后果是
 * 行内 `style` 属性（React 的 `style={{...}}`、行内 CSS 变量）
 * **全部被静默拦截**：流星塌到原点、行星间距归零、星座连线高度为 0、
 * 进度条变平 —— 而页面不报任何错，只有视觉悄悄消失。
 *
 * 所以下面**每条指令都显式写全，绝不依赖回退**。
 * `src/lib/csp.ts` 里有一份按规范解析回退链的判断函数，
 * `tests/csp.test.ts` 用它断言"行内样式必须被放行" —— 这条断言能抓住本次事故。
 *
 * ── 为什么 style-src 需要 'unsafe-inline' ───────────────────────
 *
 * CSP 的 nonce 与 hash **只对 `<style>` 元素有效，对 `style` 属性无效**
 * （规范如此）。也就是说，只要用了 React 行内样式，就没有别的写法。
 *
 * 残余风险是 CSS 层面的数据外泄，而它需要先有一个 HTML 注入点。
 * 全仓已确认没有任何 `dangerouslySetInnerHTML` 或 `innerHTML` 赋值，
 * React 默认转义，也不渲染用户提供的 HTML —— 所以这个取舍成立。
 *
 * ── 为什么 script-src 也需要 'unsafe-inline' ────────────────────
 *
 * **不写它，整个应用没有客户端 JavaScript。** 这不是夸张：
 *
 *   Next 会在 HTML 里注入一个内联脚本设置 `self.__next_r`
 *   （`<script id="_R_">self.__next_r="…"</script>`）。
 *   `script-src 'self'` 会拦掉它，于是客户端运行时的 createDebugChannel
 *   抛 InvariantError，**水合中止** —— 页面照常显示（都是服务端渲染的），
 *   但所有依赖 JS 的东西静默失效：Canvas 星野不绘制、计时器不走、
 *   进度条不动。控制台只有一条语焉不详的 Next.js 内部异常。
 *
 * 这个非要用 nonce 才能两全。nonce 方案需要 middleware 逐请求生成并
 * 同时写请求头与响应头，且会让页面退出静态渲染 —— 属于独立的一次改造，
 * 不该混在修 bug 里做。在那之前，**诚实的做法是承认这一条没有实质防护作用**，
 * 而不是留着它并声称"已经上了 CSP"：
 *
 *   · style-src 与 script-src 都是 'unsafe-inline'，这两条形同虚设
 *   · 真正在起作用的是下面另外六条：frame-ancestors / object-src /
 *     base-uri / form-action / img-src / connect-src，
 *     它们挡住的是点击劫持、插件注入、base 劫持、表单外发与数据外带
 *
 * 若将来引入 nonce：
 *   1. 加 middleware 生成 nonce，写进请求头的 CSP
 *   2. 这里去掉 script-src 的 'unsafe-inline'，改为 'nonce-…'（由 middleware 注入）
 *   3. `tests/csp.test.ts` 里那条 assertsInlineScriptAllowed 需要同步改写
 */
const securityHeaders = [
  // 防 MIME 嗅探：没有它，一个被当成图片上传的 HTML 可能被浏览器当页面执行
  { key: "X-Content-Type-Options", value: "nosniff" },
  // 防点击劫持。CSP 的 frame-ancestors 更通用，两个都发以覆盖老浏览器
  { key: "X-Frame-Options", value: "DENY" },
  /*
    来源信息：跨站时只带 origin，同站带完整路径。
    默认值（strict-origin-when-cross-origin）在多数浏览器上已经是这个，
    显式写出来是因为**不能依赖浏览器的默认值**：它变过，也会因版本而异。
    星图与打卡地址属于个人信息，不该出现在第三方站点的 Referer 里。
  */
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 这些能力一个都用不上，直接全关 —— 万一将来被注入脚本，也拿不到摄像头
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Content-Security-Policy",
    value: buildCsp(process.env.NODE_ENV !== "production"),
  },
];

/**
 * 组装 CSP。
 *
 * 开发与生产只差一处：`'unsafe-eval'`。
 * React 的开发模式要靠 eval 重建调用栈（控制台会提示
 * "eval() is not supported ... React requires eval() in development mode"），
 * 生产环境不需要，也**绝不该开** —— eval 是最容易被利用的一类执行面。
 *
 * 抽成函数而不是拼在数组里，是为了让"开发与生产的差异"只有一处，
 * 不会出现两个分支各自漂移。
 */
function buildCsp(isDev: boolean): string {
  return [
    "default-src 'self'",
    // ⚠️ 必须写。漏掉它 = 行内样式全灭（见文件头的说明）
    "style-src 'self' 'unsafe-inline'",
    // ⚠️ 必须带 'unsafe-inline'。没有它 = 没有客户端 JS（详见文件头）
    isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'",
    // 头像存的是 data URL（见 schema 注释），所以 img-src 必须放行 data:
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * HSTS 只在生产环境发。
 *
 * 开发环境是 http://localhost，一旦浏览器记下 HSTS，
 * **之后一段时间内连 http://localhost 都会被强制升级到 https 并失败** ——
 * 这个后果会持续到 max-age 过期，且清起来很麻烦。
 */
const hstsHeader = {
  key: "Strict-Transport-Security",
  value: "max-age=63072000; includeSubDomains; preload",
};

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * 允许的开发来源。
   *
   * Next 16 默认阻止跨源的 dev 资源请求（/_next/*），这是防 DNS rebinding 的
   * 安全默认值。但它有个很隐蔽的后果：如果开发时用 127.0.0.1 访问、而 Next 认为
   * 自己跑在 localhost，**客户端 JS 包会被整个拒绝加载，页面永不 hydration**。
   * 症状极具误导性 —— 服务端渲染的 HTML 与 CSS 一切正常，只有依赖 useEffect
   * 的东西（Canvas、交互）静默失效，看起来就像「组件没渲染」。
   *
   * 本地开发两种写法都列上，截图/自动化工具用 127.0.0.1 时不会踩坑。
   */
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  // 关掉开发模式的悬浮指示器：它会出现在每张自动化截图的左下角，污染验收图
  devIndicators: false,

  // 深星：图标与工具库按需引入，控制首屏体积
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns"],
  },

  async headers() {
    const headers =
      process.env.NODE_ENV === "production"
        ? [...securityHeaders, hstsHeader]
        : securityHeaders;

    /*
      对所有路径生效，包含 /api 与 /sw.js。
      Service Worker 能正常注册：它的脚本是同源的，命中 default-src 'self'。
    */
    return [{ source: "/:path*", headers }];
  },

  typescript: {
    /**
     * 逃生舱，**默认关闭**。
     *
     * `next build` 会 spawn 一个子进程跑 `tsc` 做类型检查。在禁止 piped stdio 的
     * 受限环境里这一步会以 `spawn EPERM` 失败，导致整个构建中断——尽管打包本身
     * 早就成功了。设 DEEP_STARS_SKIP_BUILD_TYPECHECK=1 可跳过它，用于在这种环境
     * 里验证打包 / 路由 / 静态生成是否正常。
     *
     * 常规构建（本地默认、Vercel）不设这个变量，类型检查照常执行；
     * 此外 `pnpm check` 里的 `tsc --noEmit` 是独立的一道闸，不依赖这里。
     */
    ignoreBuildErrors: process.env.DEEP_STARS_SKIP_BUILD_TYPECHECK === "1",
  },
};

export default nextConfig;
