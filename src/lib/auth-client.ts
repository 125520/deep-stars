"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Better Auth 客户端
 *
 * **不传 baseURL**：默认就走当前 origin，同源请求。
 * 传了反而要维护一份可能写错的地址（本地 3210、线上是 Vercel 域名），
 * 而同源本来就是这个应用唯一的使用方式。
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
