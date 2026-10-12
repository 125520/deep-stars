import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ShieldCheck, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { setUserBanned, setUserRole } from "@/lib/actions/admin";
import { isAdminUser, summarizeUsers } from "@/lib/admin";
import { toLocalDayKey } from "@/lib/constellation";
import { prisma } from "@/lib/prisma";
import { readUserFlags, requireSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "管理",
  // 后台不该被搜索引擎收录
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** 一页显示多少人。多了看不清，也拖慢查询。 */
const PAGE_SIZE = 30;

export default async function AdminPage() {
  const session = await requireSession();
  if (!session) redirect("/login");

  /*
    ⚠️ 非管理员一律 **notFound()**，不是 redirect。
    redirect 到首页等于告诉对方"这个地址存在，只是你没权限"，
    而 404 让"后台存在与否"这件事不泄露出去。
    这不能只靠导航栏藏起入口 —— 页面地址是可以直接敲的。

    role 现查而不是从 session 取：它刻意没进 additionalFields（见 lib/auth.ts），
    否则权限字段会跟着 session 一起送到客户端。
  */
  const flags = await readUserFlags();
  const viewer = { email: session.user.email, role: flags?.role };
  if (!isAdminUser(viewer, process.env.DEEP_STARS_ADMIN_EMAIL)) notFound();

  const [users, starCount, checkinCount, allUsers, activeRows] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        email: true,
        handle: true,
        role: true,
        banned: true,
        isPublic: true,
        createdAt: true,
        _count: { select: { stars: true, checkins: true } },
      },
    }),
    prisma.star.count(),
    prisma.checkin.count(),
    /*
      「总览」必须统计**全站**，不是当前这一页。
      原先的汇总复用了列表那 PAGE_SIZE 条，于是标签只能写成「用户（本页）」——
      数字本身没错，但它回答不了"这个站到底有多少人"。
      这里只取四个字段，几百上千行也不值一提。
    */
    prisma.user.findMany({ select: { role: true, banned: true, isPublic: true, createdAt: true } }),
    // 近 7 天有打卡的人 —— 这才是"活跃"的合理口径，登录数会虚高
    // （用 new Date() 而不是 Date.now()：本仓库开了 react-hooks/purity，
    //   渲染期直接读 Date.now() 会被判为不纯，而 new Date() 是既有代码的写法）
    prisma.checkin.findMany({
      where: { checkinDate: { gte: new Date(new Date().getTime() - 7 * 86_400_000) } },
      select: { userId: true },
    }),
  ]);

  const summary = summarizeUsers(allUsers, new Date());
  const activeUsers = new Set(activeRows.map((r) => r.userId)).size;
  const viewerEmail = (session.user.email ?? "").trim().toLowerCase();

  /*
    引导管理员（role 仍为 user，靠环境变量取得权限）不在数据库计数里，
    于是会出现「管理员 0 人」而当前访问者本人就是管理员这种自相矛盾的显示。
    这里把引导账号补进展示用的数字 —— 注意**只影响显示**：
    权限判断用的仍是数据库里的真实计数（见 lib/admin.ts）。
  */
  const isBootstrapAdmin = flags?.role !== "admin";
  const displayedAdmins = summary.admins + (isBootstrapAdmin ? 1 : 0);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10">
      <header className="mb-8">
        <Badge tone="violet">
          <ShieldCheck className="size-3" />
          管理后台
        </Badge>
        <h1 className="mt-4 text-[26px] leading-[1.2] font-semibold tracking-[-0.015em] text-ink">
          站点与用户
        </h1>
        <p className="mt-3 max-w-lg text-[14px] text-ink-muted text-pretty">
          列出最近注册的 {PAGE_SIZE} 个账号。封禁会同时清掉对方的会话，
          否则他凭手里的 cookie 还能继续用到会话过期。
        </p>
      </header>

      {/*
        ── 用户总览 ──
        全部统计**全站**，不是当前这一页。原先把列表那 PAGE_SIZE 条当成了全站，
        标签只能写「用户（本页）」—— 数字没错，但它回答不了"这个站有多少人"。
      */}
      <section className="mb-6 rounded-2xl border border-line-2 bg-surface-2/50 px-5 py-5">
        <h2 className="text-[14px] font-semibold tracking-tight text-ink">用户总览</h2>
        <p className="mt-1 text-[12px] text-ink-dim">
          统计口径均为全站。活跃 = 近 7 天内有过打卡 —— 用打卡而不是登录，
          因为登录数会把「每天上来瞄一眼」的人也算成活跃。
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="总用户" value={summary.total} unit="人" />
          <Stat label="近 7 天活跃" value={activeUsers} unit="人" />
          <Stat label="管理员" value={displayedAdmins} unit="人" />
          <Stat label="公开页" value={summary.publicProfiles} unit="个" />
          <Stat label="已封禁" value={summary.banned} unit="人" />
        </div>

        {/*
          近 12 周注册趋势。
          没有引图表库：一条 12 格的柱状图用 flex + 高度百分比就够了，
          为它加一个依赖不划算。高度按窗口内最大值归一，全 0 时留一条底线，
          否则整排柱子会消失、看起来像坏了。
        */}
        <div className="mt-5">
          <div className="flex items-baseline justify-between">
            <p className="text-[12px] text-ink-muted">近 12 周注册</p>
            <p className="text-[12px] text-ink-dim tabular-nums">
              本周 {summary.newThisWeek} 人 · 合计{" "}
              {summary.weeklySignups.reduce((a, b) => a + b, 0)} 人
            </p>
          </div>
          <div className="mt-2 flex h-16 items-end gap-1" role="img" aria-label="近 12 周每周注册人数">
            {summary.weeklySignups.map((n, i) => {
              const peak = Math.max(1, ...summary.weeklySignups);
              return (
                <div
                  key={i}
                  className="flex-1 rounded-t-[3px] bg-violet-500/45 transition-colors hover:bg-violet-400/70"
                  style={{ height: `${Math.max(4, (n / peak) * 100)}%` }}
                  title={`${summary.weeklySignups.length - 1 - i} 周前：${n} 人`}
                />
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10.5px] text-ink-dim">
            <span>12 周前</span>
            <span>本周</span>
          </div>
        </div>
      </section>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <Card className="px-5 py-4">
          <p className="text-[12px] text-ink-muted">全站星数</p>
          <p className="mt-2 text-[22px] leading-none font-semibold text-ink tabular-nums">
            {starCount}
          </p>
        </Card>
        <Card className="px-5 py-4">
          <p className="text-[12px] text-ink-muted">全站打卡数</p>
          <p className="mt-2 text-[22px] leading-none font-semibold text-ink tabular-nums">
            {checkinCount}
          </p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-6 py-4">
          <Users className="size-4 text-ink-dim" strokeWidth={2} />
          <h2 className="text-[14px] font-semibold tracking-tight text-ink">用户</h2>
        </div>

        <ul className="divide-y divide-line">
          {users.map((user) => {
            const isSelf = (user.email ?? "").trim().toLowerCase() === viewerEmail;
            return (
              <li key={user.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-4">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[13.5px] text-ink">
                    <span className="truncate">{user.name}</span>
                    {user.role === "admin" && <Badge tone="violet">管理员</Badge>}
                    {user.banned && <Badge tone="danger">已封禁</Badge>}
                    {isSelf && <Badge tone="neutral">你自己</Badge>}
                  </p>
                  <p className="mt-1 truncate text-[11.5px] text-ink-dim">
                    {user.email}
                    {user.handle ? ` · @${user.handle}` : ""}
                    {` · ${user._count.stars} 星 · ${user._count.checkins} 打卡`}
                    {` · ${toLocalDayKey(user.createdAt)} 注册`}
                  </p>
                </div>

                {/*
                  「你自己」那一行不给操作按钮。
                  服务端也有同样的约束（canRestrict），这里是第二道 ——
                  让不该点的东西根本点不到，比点完再报错好。
                */}
                {!isSelf && (
                  <div className="flex shrink-0 items-center gap-2">
                    <form action={setUserRole}>
                      <input type="hidden" name="userId" value={user.id} />
                      <input
                        type="hidden"
                        name="role"
                        value={user.role === "admin" ? "user" : "admin"}
                      />
                      <button
                        type="submit"
                        className="rounded-lg border border-line-2 px-3 py-1.5 text-[12px] text-ink-muted transition-colors hover:border-violet-400 hover:text-ink"
                      >
                        {user.role === "admin" ? "取消管理员" : "设为管理员"}
                      </button>
                    </form>

                    <form action={setUserBanned}>
                      <input type="hidden" name="userId" value={user.id} />
                      <input type="hidden" name="banned" value={user.banned ? "0" : "1"} />
                      <button
                        type="submit"
                        className={
                          user.banned
                            ? "rounded-lg border border-line-2 px-3 py-1.5 text-[12px] text-ink-muted transition-colors hover:border-emerald-400/60 hover:text-ink"
                            : "rounded-lg border border-danger/40 px-3 py-1.5 text-[12px] text-danger transition-colors hover:bg-danger/12"
                        }
                      >
                        {user.banned ? "解封" : "封禁"}
                      </button>
                    </form>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <p className="mt-6 text-[12px] leading-relaxed text-ink-dim">
        第一个管理员通过环境变量 <code className="text-ink-muted">DEEP_STARS_ADMIN_EMAIL</code>{" "}
        指定 —— 全新部署时数据库里没有任何管理员，而「第一个」没法由后台自己产生。
      </p>
    </main>
  );
}

function Stat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <Card className="px-4 py-3.5">
      <p className="text-[11.5px] text-ink-muted">{label}</p>
      <p className="mt-2 text-[20px] leading-none font-semibold text-ink tabular-nums">
        {value}
        <span className="ml-1 text-[11.5px] font-normal text-ink-dim">{unit}</span>
      </p>
    </Card>
  );
}
