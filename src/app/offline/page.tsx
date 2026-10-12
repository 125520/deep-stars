import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";

import { Starfield } from "@/components/starfield";
import { buttonVariants } from "@/components/ui/button-variants";
import { Viewport } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "离线",
  // 这一页不该被搜索引擎收录 —— 它对任何人都没有信息量
  robots: { index: false, follow: false },
};

/**
 * 离线兜底页
 *
 * 由 Service Worker 预缓存，网络不通时作为导航的最后一站。
 * 刻意做成**不依赖任何数据**的静态页：这张页面必须在
 * "什么都取不到"的前提下仍然能渲染出来，所以它不读会话、不查库。
 */
export default function OfflinePage() {
  return (
    <main className="grid flex-1 place-items-center px-5 py-16">
      <div className="w-full max-w-md">
        <Viewport className="relative px-8 py-12">
          <Starfield className="absolute inset-0" />
          <div className="relative flex flex-col items-center text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/20">
              <WifiOff className="size-5 text-white/90" strokeWidth={2} />
            </span>

            <h1 className="mt-6 text-[20px] leading-[1.25] font-semibold tracking-tight text-ink">
              现在连不上
            </h1>
            <p className="ds-on-deep-muted mt-3 text-[13px] leading-relaxed text-pretty">
              网络好像断了。已经看过的页面还能翻，
              <br />
              但新的打卡与专注记录要等联网之后才能保存。
            </p>

            <Link
              href="/dashboard"
              className={cn(buttonVariants({ variant: "onDeep", size: "sm" }), "mt-7")}
            >
              重试
            </Link>
          </div>
        </Viewport>
      </div>
    </main>
  );
}
