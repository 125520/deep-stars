import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

/**
 * Better Auth 的挂载点。
 *
 * `[...all]` 是 catch-all：注册、登录、登出、取 session、OAuth 回调
 * 全都走这一条路由（/api/auth/*），由 Better Auth 自己分发 ——
 * 不需要为每个动作各写一个 route。
 *
 * 注意这里**不要**加 `export const runtime = "edge"`：
 * Prisma 的 SQLite 适配器依赖 better-sqlite3（原生模块），跑不了 edge。
 */
export const { GET, POST } = toNextJsHandler(auth);
