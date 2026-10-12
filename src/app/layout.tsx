import type { Metadata, Viewport } from "next";

import { CelestialBackdrop } from "@/components/celestial-backdrop";
import CspProbe from "@/components/csp-probe";
import PwaRegister from "@/components/pwa-register";

import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3210";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Deep Stars · 深星",
    template: "%s · Deep Stars",
  },
  description:
    "把每一次专注，点成一枚星。星座打卡、星图计划、深空专注、AI 观测员与知识星云 —— 你的学习轨迹落在一张星图上。",
  applicationName: "Deep Stars",
  keywords: ["学习打卡", "专注计时", "番茄钟", "学习计划", "间隔重复", "AI 学习助手", "知识库"],
  authors: [{ name: "Deep Stars" }],
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: siteUrl,
    siteName: "Deep Stars · 深星",
    title: "Deep Stars · 深星",
    description: "把每一次专注，点成一枚星。",
  },
  twitter: {
    card: "summary_large_image",
    title: "Deep Stars · 深星",
    description: "把每一次专注，点成一枚星。",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  /*
    这三个值必须跟着主题走。
    全站改成深空底之后，这里如果还留着 #ffffff / light，
    移动端的状态栏、地址栏与滚动回弹区会是一片白，
    和页面的深靛底撞在一起 —— 而且只在真机上看得见，桌面调试发现不了。
    用 --color-canvas 的实值，与 globals.css 的令牌保持一致。
  */
  themeColor: "#050412",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-dvh bg-canvas text-ink">
        {/* 深空背景：坐标纸 + 行星 + 流星。全站铺一层，各区块共用同一片夜空 */}
        <CelestialBackdrop className="z-0" />
        {/* Service Worker 注册。放这里而不是某个页面：它的 scope 是 / */}
        <PwaRegister />
        {/* 行内样式探针：CSP 若拦掉行内样式，开发时会在控制台大声报错 */}
        <CspProbe />
        <div className="relative z-10 flex min-h-dvh flex-col">{children}</div>
      </body>
    </html>
  );
}
