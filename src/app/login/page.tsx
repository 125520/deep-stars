import type { Metadata } from "next";
import { redirect } from "next/navigation";

import AuthForm from "@/components/auth-form";
import { readSession } from "@/lib/session";

export const metadata: Metadata = { title: "登录" };

export default async function LoginPage() {
  /*
    已登录的人不该再看到登录页 —— 送到观测台，**不是落地页**。

    送到落地页会制造一个很像故障的现象：用户注册成功后会话已经建立，
    之后再打开 /login 会被弹回营销落地页，而落地页看不出"你已经登录"，
    于是被理解成「登录按钮点了没反应」。线上真实发生过。
  */
  if (await readSession()) redirect("/dashboard");

  return <AuthForm mode="login" />;
}
