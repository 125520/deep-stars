import type { Metadata } from "next";
import { redirect } from "next/navigation";

import AuthForm from "@/components/auth-form";
import { readSession } from "@/lib/session";

export const metadata: Metadata = { title: "注册" };

export default async function RegisterPage() {
  // 同上：已登录就进观测台。送到落地页会被误读成"注册完了回到初始页面"。
  if (await readSession()) redirect("/dashboard");

  return <AuthForm mode="register" />;
}
