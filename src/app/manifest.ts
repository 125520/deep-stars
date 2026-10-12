import type { MetadataRoute } from "next";

/**
 * PWA 清单
 * ══════════════════════════════════════════════════════════════════
 *
 * 用 app/manifest.ts 而不是手写 public/manifest.webmanifest：
 * 前者有类型，字段拼错在 tsc 阶段就会报错；后者只会在浏览器里静默失效 ——
 * 而 PWA 清单失效的表现是"装到桌面后像个网页书签"，
 * 不打开开发者工具根本看不出来。
 */

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Deep Stars · 深星",
    short_name: "深星",
    description: "把每一次专注，点成一枚星。星座打卡、专注计时、星图计划与复习卡。",
    // 装到桌面后直接进观测台；未登录会被守卫送回登录页
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    // 与 globals.css 的 --color-canvas 一致：启动画面与状态栏不能是白的
    background_color: "#050412",
    theme_color: "#050412",
    orientation: "portrait-primary",
    lang: "zh-CN",
    dir: "ltr",
    categories: ["productivity", "education"],

    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // maskable 单独一份：Android 会把图标裁成圆形/水滴形，
      // 内容必须收在中心安全区内，直接复用 any 版本会被切掉星角
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],

    // 长按图标的快捷入口。这三个是最常用的动作。
    shortcuts: [
      { name: "点亮今天的星", url: "/dashboard", description: "写一条打卡" },
      { name: "开始专注", url: "/focus", description: "开一段番茄钟" },
      { name: "待办", url: "/todos", description: "看看还差什么" },
    ],
  };
}
