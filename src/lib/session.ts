import { cache } from "react";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { shouldHandle } from "@/lib/next-errors";
import { prisma } from "@/lib/prisma";

/**
 * 读取当前会话（服务端组件 / 路由处理器里用）
 * ══════════════════════════════════════════════════════════════════
 *
 * 包一层有两个理由：
 *
 * 1. **getSession 需要 headers()。** 每个调用点都手写一遍 `await headers()`
 *    是重复噪音，而且 next/headers 的返回值在版本之间变过（15 起改成异步），
 *    收在一处只需改一个地方。
 *
 * 2. **数据库故障不该让登录页 500。** 登录页恰恰要在"会话读不出来"时仍然可用 ——
 *    那正是用户来登录的场景。所以这里吞掉异常并当作未登录，只留一条日志。
 *
 * ⚠️ 反过来说：**需要强一致的页面不要用这个函数**（比如将来的管理后台）。
 * 那里"读不出会话"必须报错，而不是被当成未登录放行。直接用
 * `auth.api.getSession({ headers: await headers() })`。
 */
export async function readSession() {
  try {
    return await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    /*
      ⚠️ **先放行框架信号，再处理自己的错误。**

      Next 用「抛异常」传递控制流：`headers()` 在静态生成阶段会抛
      `DYNAMIC_SERVER_USAGE`，`redirect()` / `notFound()` 也各自抛带 digest
      的错误。这个 catch 本意只是"会话读不出来就当作未登录"，
      如果连框架信号一起吞掉，就会把 redirect 变成静默失效、
      把 notFound 变成正常渲染 —— 而且**一声不响**。

      生产构建时实测踩到过：/login 与 /register 在构建日志里打印
      「读取会话失败，按未登录处理：Dynamic server usage」，
      正是这个 catch 把框架信号当成了故障。
    */
    if (!shouldHandle(error)) throw error;

    console.error("[auth] 读取会话失败，按未登录处理：", error);
    return null;
  }
}

/**
 * 与 readSession 的唯一区别：**读不出会话时抛错，而不是当成未登录。**
 *
 * **写操作与受保护页面必须用这个。** 数据库出故障时，readSession 会返回 null，
 * 调用方于是告诉用户"登录状态已过期，请重新登录"—— 而用户重新登录
 * 一样会失败（因为坏的是数据库），排查方向被彻底带偏。
 * 让它抛出去，由错误边界显示真实的失败，才是诚实的做法。
 *
 * 用 React 的 cache() 包一层：布局与页面**都会**读会话，
 * 不缓存的话同一次请求要跑两遍 getSession —— 那是一到两次多余的数据库往返。
 * cache 的作用域是单次请求，所以不会把 A 用户的会话串给 B 用户。
 */
export const requireSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);

/**
 * 读取当前用户的**权限字段**（role / banned / handle / isPublic）。
 *
 * 这些字段刻意没有加进 Better Auth 的 additionalFields（见 src/lib/auth.ts）——
 * 那会把它们塞进客户端可见的 session 对象里。代价是要用的时候得现查一次，
 * 这里用 React 的 cache 包住，同一次请求内只查一遍。
 *
 * 单独成函数而不是让各处自己查：封禁判断散落在多个页面时，
 * 漏掉一处就是一个越权入口。
 */
export const readUserFlags = cache(async () => {
  const session = await requireSession();
  if (!session) return null;

  return prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, banned: true, handle: true, isPublic: true },
  });
});
