"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, LogOut, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";
import { clearAppCaches } from "@/lib/pwa";
import { cn } from "@/lib/utils";

/**
 * 应用内导航
 * ══════════════════════════════════════════════════════════════════
 *
 * 客户端组件的唯一理由是 `usePathname` —— 高亮当前页必须知道路由。
 * 用户信息由服务端布局传进来，避免为了拿个名字多跑一次会话查询。
 */

const NAV = [
  { href: "/dashboard", label: "观测台" },
  { href: "/plans", label: "计划" },
  { href: "/review", label: "复习" },
  { href: "/focus", label: "专注" },
  { href: "/todos", label: "待办" },
  { href: "/stats", label: "统计" },
  { href: "/settings", label: "设置" },
] as const;

/** 只有管理员看得到。**这只是隐藏入口，不是权限控制** —— 页面本身会再判一次。 */
const ADMIN_ITEM = { href: "/admin", label: "管理" } as const;

export default function AppNav({
  userName,
  isAdmin = false,
  unread = 0,
}: {
  userName: string;
  isAdmin?: boolean;
  unread?: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [leaving, setLeaving] = React.useState(false);

  const items = isAdmin ? [...NAV, ADMIN_ITEM] : NAV;

  async function handleSignOut() {
    setLeaving(true);
    await signOut();
    /*
      **退出后必须清缓存。**
      Service Worker 缓存了带个人数据的页面（这是离线可用的代价），
      共用设备上不清理，下一个用户按后退键就可能翻到上一个人的页面。
      放在 signOut 之后、跳转之前：跳转一旦发生，这个页面上下文就没了。
    */
    await clearAppCaches();
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-50 border-b border-line/60 bg-canvas/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-5 sm:gap-6">
        <Link href="/dashboard" className="ds-pop flex shrink-0 items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-[9px] bg-violet-600">
            <Sparkles className="size-3.5 text-white" strokeWidth={2.2} />
          </span>
          {/* 窄屏只留图标：品牌名占掉的位置应当让给导航本身 */}
          <span className="hidden text-[14px] font-semibold tracking-tight text-ink sm:inline">
            Deep <span className="text-violet-400">Stars</span>
          </span>
        </Link>

        {/*
          ⚠️ **手机端这里必须能横向滚动，不能让子项收缩。**

          实测（390px 宽）：没有 overflow-x-auto 时，flex 子项被压到只剩
          一个字符宽 —— 「观测台」「计划」「复习」全部变成**竖排单字**，
          而且总宽仍然超出视口被切掉，整页还能被横向拖动 206px。
          换句话说，手机用户打开应用看到的是一个坏掉的导航。

          加 min-w-0 是必须的：flex 子项默认 min-width: auto，
          不加的话它会拒绝收缩到内容宽度以下，overflow-x-auto 也就不会生效。
        */}
        <nav className="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // whitespace-nowrap：没有它，挤不下时中文会逐字换行
                  "shrink-0 rounded-lg px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors",
                  active
                    ? "bg-violet-500/15 font-medium text-violet-200"
                    : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <span className="hidden shrink-0 text-[13px] text-ink-muted sm:block">{userName}</span>

        <Link
          href="/notifications"
          aria-label={unread > 0 ? `通知，${unread} 条未读` : "通知"}
          className={cn(
            "relative grid size-8 shrink-0 place-items-center rounded-lg transition-colors",
            pathname === "/notifications"
              ? "bg-violet-500/15 text-violet-200"
              : "text-ink-muted hover:bg-surface-2 hover:text-ink",
          )}
        >
          <Bell className="size-4" strokeWidth={2} />
          {/* 未读小红点。数字超过 9 就只显示 9+，免得把导航撑开 */}
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-violet-600 px-1 text-[9.5px] leading-none font-medium text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Link>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          disabled={leaving}
          className="shrink-0"
        >
          <LogOut className="size-3.5" strokeWidth={2} />
          <span className="hidden sm:inline">{leaving ? "退出中…" : "退出"}</span>
        </Button>
      </div>
    </header>
  );
}
