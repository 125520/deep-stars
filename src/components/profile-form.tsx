"use client";

import * as React from "react";
import { Eye, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { updateProfile, type ProfileState } from "@/lib/actions/profile";
import { profilePath } from "@/lib/handle";
import { cn } from "@/lib/utils";

/**
 * 个人资料表单
 *
 * 用户名、简介、公开开关放在**同一个表单**里提交。
 * 拆成两个表单看似更清晰，但"改完名字忘了开开关"这类半完成状态
 * 会让用户困惑很久（页面显示已公开，地址却是旧的）。
 */
export default function ProfileForm({
  handle,
  bio,
  isPublic,
}: {
  handle: string | null;
  bio: string | null;
  isPublic: boolean;
}) {
  const [state, formAction, pending] = React.useActionState<ProfileState, FormData>(
    updateProfile,
    null,
  );
  const [open, setOpen] = React.useState(isPublic);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="handle">公开用户名</Label>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="shrink-0 text-[12.5px] text-ink-dim">/u/</span>
          <Input
            id="handle"
            name="handle"
            defaultValue={handle ?? ""}
            placeholder="star-gazer"
            maxLength={24}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <p className="mt-1.5 text-[11.5px] text-ink-dim">
          英文小写字母、数字、连字符或下划线，3–24 位。留空表示不修改。
        </p>
      </div>

      <div>
        <Label htmlFor="bio">简介</Label>
        <Textarea
          id="bio"
          name="bio"
          rows={3}
          maxLength={300}
          defaultValue={bio ?? ""}
          placeholder="一句话介绍你在学什么。"
        />
      </div>

      <label
        className={cn(
          "flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 transition-colors",
          open
            ? "border-violet-400/50 bg-violet-500/8"
            : "border-line-2 hover:border-violet-400/40",
        )}
      >
        <input
          type="checkbox"
          name="isPublic"
          defaultChecked={isPublic}
          onChange={(event) => setOpen(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-violet-500"
        />
        <span className="min-w-0">
          <span className="block text-[13px] text-ink">开启公开主页</span>
          <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-dim">
            别人可以通过链接看到你的星图与统计。
            <br />
            <strong className="font-medium text-ink-muted">
              打卡内容本身永远不会公开
            </strong>
            —— 星图是公开的，笔记不是。
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          保存
        </Button>

        {handle && isPublic && (
          <a
            href={profilePath(handle)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[12.5px] text-violet-300 transition-colors hover:text-violet-200"
          >
            <Eye className="size-3.5" />
            查看公开主页
          </a>
        )}
      </div>

      <p role="status" aria-live="polite" className="min-h-[18px] text-[12.5px]">
        {state?.ok === false && <span className="text-danger">{state.error}</span>}
        {state?.ok === true && <span className="text-violet-300">{state.message}</span>}
      </p>
    </form>
  );
}
