import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Database, Globe, KeyRound, Settings as SettingsIcon, UserRound } from "lucide-react";

import DataTransfer from "@/components/data-transfer";
import ApiKeyForm from "@/components/api-key-form";
import AvatarForm from "@/components/avatar-form";
import ProfileForm from "@/components/profile-form";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EXPORT_COLLECTIONS } from "@/lib/export-format";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "设置" };

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();
  if (!session) redirect("/login");

  const userId = session.user.id;

  /*
    只数条数，不取内容 —— 这一页只需要"有多少"。
    用 count 而不是 findMany().length：后者会把全部记录读进内存再丢掉。
  */
  /*
    只取非敏感字段：keyCipher 绝不出库房。
    这不是"顺手少写一个字段"，而是这一页唯一能接触密钥表的地方 ——
    一旦把 keyCipher 选进来，它就有机会出现在 HTML、RSC 载荷或错误日志里。
  */
  const apiKey = await prisma.userApiKey.findUnique({
    where: { userId },
    select: { label: true, keyHint: true, baseUrl: true, model: true },
  });

  /*
    头像与历史条数。只数条数不取内容 —— 历史里存的是完整的 data URL，
    每条 15–30KB，把 5 条全读出来只为了显示一个数字是纯浪费。
  */
  const [avatarHistoryCount, viewer] = await Promise.all([
    prisma.avatarChange.count({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { image: true } }),
  ]);

  const [constellations, stars, checkins, plans, planTasks, todos, studyRecords, reviewCards] =
    await Promise.all([
      prisma.constellation.count({ where: { userId } }),
      prisma.star.count({ where: { userId } }),
      prisma.checkin.count({ where: { userId } }),
      prisma.plan.count({ where: { userId } }),
      prisma.planTask.count({ where: { userId } }),
      prisma.todo.count({ where: { userId } }),
      prisma.studyRecord.count({ where: { userId } }),
      prisma.reviewCard.count({ where: { userId } }),
    ]);

  const counts: Record<string, number> = {
    constellations,
    stars,
    checkins,
    plans,
    planTasks,
    todos,
    studyRecords,
    reviewCards,
  };

  // 断言两边的集合名一致：schema 加了表而这里忘了加，导出的数字就会悄悄少一项
  const missing = EXPORT_COLLECTIONS.filter((key) => !(key in counts));

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <header className="mb-8">
        <Badge tone="violet">
          <SettingsIcon className="size-3" />
          设置
        </Badge>
        <h1 className="mt-4 text-[26px] leading-[1.2] font-semibold tracking-[-0.015em] text-ink">
          账号与数据
        </h1>
        <p className="mt-3 max-w-lg text-[14px] text-ink-muted text-pretty">
          你的数据存在自己的数据库里，随时可以完整带走。
        </p>
      </header>

      <Card className="mb-6 px-6 py-5">
        <h2 className="mb-4 text-[14px] font-semibold tracking-tight text-ink">账号</h2>
        <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
          <div>
            <dt className="text-[11.5px] text-ink-dim">昵称</dt>
            <dd className="mt-0.5 text-ink">{session.user.name}</dd>
          </div>
          <div>
            <dt className="text-[11.5px] text-ink-dim">邮箱</dt>
            <dd className="mt-0.5 break-all text-ink">{session.user.email}</dd>
          </div>
        </dl>
      </Card>

      <Card className="mb-6 px-6 py-6">
        <h2 className="mb-5 flex items-center gap-2 text-[14px] font-semibold tracking-tight text-ink">
          <KeyRound className="size-4 text-ink-dim" strokeWidth={2} />
          AI 密钥（BYOK）
        </h2>
        <ApiKeyForm
          existing={
            apiKey
              ? {
                  label: apiKey.label,
                  keyHint: apiKey.keyHint,
                  baseUrl: apiKey.baseUrl,
                  model: apiKey.model,
                }
              : null
          }
        />
      </Card>

      <Card className="mb-6 px-6 py-6">
        <h2 className="mb-5 flex items-center gap-2 text-[14px] font-semibold tracking-tight text-ink">
          <UserRound className="size-4 text-ink-dim" strokeWidth={2} />
          头像
        </h2>
        <AvatarForm
          currentImage={viewer?.image ?? null}
          historyCount={avatarHistoryCount}
        />
      </Card>

      <Card className="mb-6 px-6 py-6">
        <h2 className="mb-5 flex items-center gap-2 text-[14px] font-semibold tracking-tight text-ink">
          <Globe className="size-4 text-ink-dim" strokeWidth={2} />
          公开主页
        </h2>
        <ProfileForm
          handle={session.user.handle ?? null}
          bio={session.user.bio ?? null}
          isPublic={session.user.isPublic ?? false}
        />
      </Card>

      <Card className="px-6 py-6">
        <h2 className="mb-5 flex items-center gap-2 text-[14px] font-semibold tracking-tight text-ink">
          <Database className="size-4 text-ink-dim" strokeWidth={2} />
          数据
        </h2>
        <DataTransfer counts={counts} />
        {missing.length > 0 && (
          <p className="mt-4 text-[11.5px] text-danger">
            内部错误：以下集合没有统计到（{missing.join(", ")}），导出内容可能不完整。
          </p>
        )}
      </Card>
    </main>
  );
}
