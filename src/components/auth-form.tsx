"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";

import { Starfield } from "@/components/starfield";
import { Button } from "@/components/ui/button";
import { Card, Viewport } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { signIn, signUp } from "@/lib/auth-client";

/**
 * 登录 / 注册表单
 * ══════════════════════════════════════════════════════════════════
 *
 * 两种模式共用一个组件：字段与提交流程只差一处（注册多一个昵称），
 * 拆成两个组件会立刻产生两份几乎相同的校验与错误处理。
 *
 * 用 Better Auth 的客户端方法（signIn.email / signUp.email），
 * **不自己 fetch /api/auth/***：Cookie 的写入方式、错误结构、
 * 字段名都由库决定，手写一份等于把它们抄下来并在升级时静静失效。
 */

type Mode = "login" | "register";

/**
 * Better Auth 的错误信息是英文的，且措辞会随版本变。
 * 这里用**关键词包含**而不是全等匹配 —— 全等匹配一旦库改了措辞就全部失效，
 * 而关键词命中失败也只是退回原文，不会更差。
 */
const ERROR_HINTS: readonly [RegExp, string][] = [
  [/invalid email or password|invalid credentials/i, "邮箱或密码不对，再试一次。"],
  [/already exists|already registered|unique constraint/i, "这个邮箱已经注册过了，直接登录吧。"],
  [/password too short|at least 8/i, "密码至少 8 位。"],
  [/invalid email/i, "邮箱格式看起来不对。"],
];

function toChinese(message: string): string {
  for (const [pattern, hint] of ERROR_HINTS) {
    if (pattern.test(message)) return hint;
  }
  return message;
}

export default function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const isRegister = mode === "register";

  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim();
    const birthday = String(form.get("birthday") ?? "").trim();

    const { error: authError } = isRegister
      ? await signUp.email({
          email,
          password,
          // 昵称留空就取邮箱前缀 —— 比强行要求填写少一道门槛，
          // 而且 User.name 在库里是必填，不能真的空着进去。
          name: name || email.split("@")[0] || "观测者",
          // 生日留空就不传 —— 传空字符串会被当成一个「填了但无效」的值，
          // 而这里空值是有意义的默认状态。
          ...(birthday ? { birthday } : {}),
        })
      : await signIn.email({ email, password });

    if (authError) {
      setError(toChinese(authError.message ?? ""));
      setPending(false);
      return;
    }

    /*
      先 refresh 再 replace。
      Cookie 是刚写下的，服务端组件的缓存里还没有这次会话；
      只 replace 的话首页会短暂地按"未登录"渲染一遍。

      ⚠️ 目的地是 /dashboard，**不是 /**。
      落地页是给还没登录的人看的营销页，跳过去之后看不出"你已经登录了"——
      实测线上就有用户因此以为「注册完了回到初始页面、登录按钮点了没反应」，
      而其实注册和登录都成功了。登录后该直接进应用。
    */
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <main className="grid flex-1 place-items-center px-5 py-16">
      <div className="w-full max-w-sm">
        {/* 顶部一小块观测窗：给表单页一个视觉落点，与首页的星图呼应 */}
        <Viewport className="relative mb-6 h-28 w-full">
          <Starfield className="absolute inset-0" />
          <div className="absolute inset-0 grid place-items-center">
            <span className="grid size-11 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/20 backdrop-blur">
              <Sparkles className="size-5 text-white" strokeWidth={2} />
            </span>
          </div>
        </Viewport>

        <Card className="px-7 py-8">
          <h1 className="text-center text-[21px] font-semibold tracking-tight text-ink">
            {isRegister ? "创建你的星图" : "回到你的星图"}
          </h1>
          <p className="mt-2.5 text-center text-[13px] text-ink-muted">
            {isRegister
              ? "注册后即可开始记录，所有数据都留在你自己的数据库里。"
              : "继续你上一次的观测。"}
          </p>

          <form className="mt-7 flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
            {isRegister && (
              <div>
                <Label htmlFor="name">昵称（可留空）</Label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  autoComplete="nickname"
                  placeholder="观测者"
                  maxLength={40}
                />
              </div>
            )}

            {isRegister && (
              <div>
                <Label htmlFor="birthday">生日（可留空）</Label>
                <Input id="birthday" name="birthday" type="date" autoComplete="bday" />
                {/*
                  说清楚它拿来干什么。留空不影响任何功能 ——
                  但填了，第一张星图就是你自己那个星座，这是这个产品最有说服力的
                  第一印象，所以值得在注册这一步就问一次。
                */}
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-dim">
                  填了就用你的星座作为第一张星图；不填也能用，会从默认星座开始。
                </p>
              </div>
            )}

            <div>
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                autoFocus={!isRegister}
              />
            </div>

            <div>
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete={isRegister ? "new-password" : "current-password"}
                placeholder={isRegister ? "至少 8 位" : "••••••••"}
                autoFocus={isRegister}
              />
            </div>

            {/*
              错误区固定占位，不用条件渲染插入新节点 ——
              否则报错时表单会整体往下跳一行，正在重输的字段会移位。
            */}
            <p
              role="alert"
              aria-live="polite"
              className="min-h-[18px] text-[12.5px] text-danger"
            >
              {error}
            </p>

            <Button type="submit" size="lg" disabled={pending} className="w-full">
              {pending && <Loader2 className="size-4 animate-spin" />}
              {isRegister ? "创建账号" : "登录"}
            </Button>
          </form>

          <div className="mt-6 flex items-center justify-center gap-2 text-[13px] text-ink-muted">
            {isRegister ? "已经有账号了？" : "还没有账号？"}
            <Link
              href={isRegister ? "/login" : "/register"}
              className="font-medium text-violet-300 transition-colors hover:text-violet-200"
            >
              {isRegister ? "去登录" : "去注册"}
            </Link>
          </div>
        </Card>

        <p className="mt-5 text-center text-[12px] text-ink-dim">
          <Link href="/" className="transition-colors hover:text-ink-muted">
            返回首页
          </Link>
        </p>
      </div>
    </main>
  );
}
