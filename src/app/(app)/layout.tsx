import { redirect } from "next/navigation";

import AppNav from "@/components/app-nav";
import { isAdminUser } from "@/lib/admin";
import { readUnreadCount } from "@/lib/notifications-server";
import { readUserFlags, requireSession } from "@/lib/session";

/**
 * 应用外壳（受保护区）
 * ══════════════════════════════════════════════════════════════════
 *
 * `(app)` 是路由组：括号目录**不进 URL**，只用来共享这一层布局。
 * 于是所有登录后才该看到的页面都在这里，登录守卫也只写一次 ——
 * 写在每个页面里迟早会漏掉一个，而漏掉的那个就是越权入口。
 *
 * 用 requireSession 而不是 readSession：数据库故障时必须报错，
 * 不能把用户当成未登录静默踢走 —— 他会以为是自己的问题，反复重登。
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session) redirect("/login");

  /*
    封禁在这里生效，且**只有一个地方**判断。
    后台封禁时已经清掉了会话，但对方还能重新登录 ——
    不在这里拦，封禁就只是"踢下线一次"而已。
  */
  const flags = await readUserFlags();
  if (flags?.banned) redirect("/login?banned=1");

  const isAdmin = isAdminUser(
    { email: session.user.email, role: flags?.role },
    process.env.DEEP_STARS_ADMIN_EMAIL,
  );

  // 未读数在导航栏上，所以要在布局这一层拿 —— 每个页面自己取会重复查询
  const unread = await readUnreadCount();

  return (
    <>
      <AppNav userName={session.user.name} isAdmin={isAdmin} unread={unread} />
      <div className="flex flex-1 flex-col">{children}</div>
    </>
  );
}
