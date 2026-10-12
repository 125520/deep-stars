"use client";

import * as React from "react";
import { KeyRound, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { deleteApiKey, saveApiKey, type KeyState } from "@/lib/actions/api-key";
import { DEFAULT_BASE_URLS } from "@/lib/api-key";
import { cn } from "@/lib/utils";

/**
 * BYOK 密钥设置
 *
 * 已保存时**只显示末四位**（keyHint），输入框永远不从服务端回填 ——
 * 明文密钥不该出现在 HTML 里，哪怕是为了"方便用户核对"。
 */

export type ExistingKey = {
  label: string;
  keyHint: string;
  baseUrl: string;
  model: string | null;
} | null;

export default function ApiKeyForm({ existing }: { existing: ExistingKey }) {
  const [state, formAction, pending] = React.useActionState<KeyState, FormData>(saveApiKey, null);

  return (
    <div className="flex flex-col gap-5">
      {existing ? (
        <div className="flex items-start gap-3 rounded-xl border border-line-2 bg-surface-2/50 px-4 py-3.5">
          <KeyRound className="mt-0.5 size-4 shrink-0 text-violet-300" strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-ink">{existing.label}</p>
            <p className="mt-1 font-mono text-[11.5px] text-ink-dim">{existing.keyHint}</p>
            <p className="mt-1 truncate text-[11px] text-ink-dim">{existing.baseUrl}</p>
          </div>
          <form action={deleteApiKey} className="shrink-0">
            <button
              type="submit"
              aria-label="删除已保存的密钥"
              className="grid size-7 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-danger/12 hover:text-danger"
            >
              <Trash2 className="size-3.5" strokeWidth={2} />
            </button>
          </form>
        </div>
      ) : (
        <p className="text-[12.5px] text-ink-muted">
          还没有配置密钥。填入之后，AI 相关功能会用你自己的额度。
        </p>
      )}

      <form action={formAction} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="apiKey">{existing ? "替换密钥" : "API 密钥"}</Label>
          <Input
            id="apiKey"
            name="apiKey"
            type="password"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-…"
            className="font-mono"
          />
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-dim">
            加密后存储，
            <strong className="font-medium text-ink-muted">明文不会留在服务器上</strong>
            ，也不会回传到浏览器。
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="baseUrl">接口地址（可选）</Label>
            <Input
              id="baseUrl"
              name="baseUrl"
              type="url"
              spellCheck={false}
              placeholder={DEFAULT_BASE_URLS["openai-compatible"]}
            />
          </div>
          <div>
            <Label htmlFor="model">模型（可选）</Label>
            <Input id="model" name="model" maxLength={80} placeholder="deepseek-chat" />
          </div>
        </div>

        <div>
          <Label htmlFor="key-label">备注名（可选）</Label>
          <Input id="key-label" name="label" maxLength={40} placeholder="我的 DeepSeek" />
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {existing ? "替换" : "保存"}
          </Button>
        </div>

        <p
          role="status"
          aria-live="polite"
          className={cn("min-h-[18px] text-[12.5px]")}
        >
          {state?.ok === false && <span className="text-danger">{state.error}</span>}
          {state?.ok === true && <span className="text-violet-300">{state.message}</span>}
        </p>
      </form>
    </div>
  );
}
