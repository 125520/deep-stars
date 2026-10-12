import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Bell, CheckCheck, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { deleteNotification, markAllRead, markRead } from "@/lib/actions/notifications";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "通知",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** 一次显示多少条。通知是"看完就走"的东西，不需要无限翻。 */
const PAGE_SIZE = 50;

/** 类型 → 中文标签。用 schema 里 `Notification.type` 的取值。 */
const TYPE_LABELS: Record<string, string> = {
  coach: "建议",
  review: "复习",
  report: "周报",
  reminder: "提醒",
  system: "系统",
};

export default async function NotificationsPage() {
  const session = await requireSession();
  if (!session) redirect("/login");

  const items = await prisma.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE,
    select: {
      id: true,
      type: true,
      title: true,
      // schema 里的列名是 content（领域层叫 body，见 notifications-server.ts 的映射）
      content: true,
      read: true,
      actionUrl: true,
      createdAt: true,
    },
  });

  const unread = items.filter((item) => !item.read).length;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <Badge tone="violet">
            <Bell className="size-3" />
            通知
          </Badge>
          <h1 className="mt-4 text-[26px] leading-[1.2] font-semibold tracking-[-0.015em] text-ink">
            需要你知道的事
          </h1>
          <p className="mt-3 max-w-lg text-[14px] text-ink-muted text-pretty">
            同一种提醒每天最多一条 —— 一个天天响的通知，两天后就会被无视，
            而它一旦被无视，真正要紧的那次也一起失效了。
          </p>
        </div>

        {unread > 0 && (
          <form action={markAllRead} className="shrink-0 pb-1">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-dim transition-colors hover:text-ink"
            >
              <CheckCheck className="size-3.5" />
              全部已读（{unread}）
            </button>
          </form>
        )}
      </header>

      {items.length === 0 ? (
        <Card className="px-6 py-12 text-center">
          <p className="text-[13px] text-ink-muted">还没有通知。</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <Card
                className={
                  item.read
                    ? "px-5 py-4 opacity-70"
                    : "border-violet-400/35 px-5 py-4"
                }
              >
                <div className="flex items-start gap-3">
                  {/* 未读的小圆点。位置固定，读/未读只换颜色，避免行内容左右跳 */}
                  <span
                    aria-hidden="true"
                    className={
                      item.read
                        ? "mt-1.5 size-1.5 shrink-0 rounded-full bg-transparent"
                        : "mt-1.5 size-1.5 shrink-0 rounded-full bg-violet-400"
                    }
                  />

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-ink">
                      <span className="truncate">{item.title}</span>
                      <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[10.5px] font-normal text-ink-dim">
                        {TYPE_LABELS[item.type] ?? item.type}
                      </span>
                    </p>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted text-pretty">
                      {item.content}
                    </p>

                    <div className="mt-2 flex items-center gap-3">
                      {item.actionUrl && (
                        <Link
                          href={item.actionUrl}
                          className="text-[12.5px] text-violet-300 transition-colors hover:text-violet-200"
                        >
                          去处理 →
                        </Link>
                      )}
                      {!item.read && (
                        <form action={markRead}>
                          <input type="hidden" name="id" value={item.id} />
                          <button
                            type="submit"
                            className="text-[12px] text-ink-dim transition-colors hover:text-ink-muted"
                          >
                            标为已读
                          </button>
                        </form>
                      )}
                    </div>
                  </div>

                  <form action={deleteNotification} className="shrink-0">
                    <input type="hidden" name="id" value={item.id} />
                    <button
                      type="submit"
                      aria-label={`删除通知「${item.title}」`}
                      className="grid size-7 place-items-center rounded-lg text-ink-dim opacity-60 transition-colors hover:bg-danger/12 hover:text-danger"
                    >
                      <Trash2 className="size-3.5" strokeWidth={2} />
                    </button>
                  </form>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
