"use client";

import * as React from "react";
import { AlertTriangle, Download, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { importData, type ImportState } from "@/lib/actions/import";
import { cn } from "@/lib/utils";

/**
 * 数据导出与导入
 *
 * 导出是一个普通链接（`<a href download>`），不需要任何客户端逻辑 ——
 * 服务端的 Route Handler 已经带了 Content-Disposition，
 * 用 fetch 取回来再造 Blob 只是把浏览器本来就会做的事重做一遍。
 */
export default function DataTransfer({ counts }: { counts: Record<string, number> }) {
  const [state, formAction, pending] = React.useActionState<ImportState, FormData>(
    importData,
    null,
  );
  const formRef = React.useRef<HTMLFormElement>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);

  React.useEffect(() => {
    /*
      导入成功后清空文件输入。
      **不在这里清 fileName** —— 在 effect 里 setState 会触发级联渲染，
      React 的 set-state-in-effect 规则（正确地）拦下了它。
      输入框本身已被 reset 清空，标签上留下的文件名反而是有用的线索：
      「我刚才导的是哪个文件」。再点一次导入也不会出事 ——
      输入框是空的，原生 required 会拦住提交。
    */
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return (
    <div className="flex flex-col gap-7">
      <section>
        <h3 className="text-[13.5px] font-medium text-ink">导出</h3>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted text-pretty">
          把全部记录打包成一个 JSON 文件。目前有 {total} 条。
          <br />
          <span className="text-ink-dim">
            不含密码、会话令牌与 AI 密钥 —— 这些永远不会进导出文件。
          </span>
        </p>
        {/*
          这里必须直接把按钮的类名套在 <a> 上，而不是 <a><Button/></a>。
          Button 渲染的是 <button>，套进链接里就是嵌套交互元素 ——
          无效 HTML，而且键盘与读屏会遇到两个重叠的可聚焦目标。
        */}
        <a
          href="/api/export"
          download
          className={cn(buttonVariants({ variant: "outline" }), "mt-3.5")}
        >
          <Download className="size-4" />
          下载导出文件
        </a>
      </section>

      <div className="h-px bg-line" />

      <section>
        <h3 className="text-[13.5px] font-medium text-ink">导入</h3>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-muted text-pretty">
          把导出文件里的记录<strong className="font-medium text-ink">追加</strong>到当前账号。
          <br />
          <span className="text-ink-dim">
            不会删除或覆盖任何现有内容；已经存在的记录会被跳过，
            所以同一个文件导入两次不会产生重复。
          </span>
        </p>

        <form ref={formRef} action={formAction} className="mt-3.5 flex flex-col gap-3">
          <label
            className={cn(
              "flex cursor-pointer items-center gap-2.5 rounded-xl border border-dashed px-4 py-3",
              "border-line-2 transition-colors hover:border-violet-400 hover:bg-violet-500/6",
            )}
          >
            <Upload className="size-4 shrink-0 text-ink-dim" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-muted">
              {fileName ?? "选择一个 .json 导出文件"}
            </span>
            <input
              type="file"
              name="file"
              accept="application/json,.json"
              required
              className="sr-only"
              onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
            />
          </label>

          <div className="flex items-center gap-3">
            <Button type="submit" variant="outline" disabled={pending || !fileName}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {pending ? "正在导入…" : "开始导入"}
            </Button>
          </div>

          {/*
            错误区固定占位：导入失败时表单不能往下跳，
            否则用户正在读的报错会移位。
          */}
          <p role="status" aria-live="polite" className="min-h-[18px] text-[12.5px]">
            {state?.ok === false && (
              <span className="text-danger">
                <AlertTriangle className="mr-1 inline size-3.5 align-[-2px]" />
                {state.error}
              </span>
            )}
            {state?.ok === true && <span className="text-violet-300">{state.summary}</span>}
          </p>
        </form>
      </section>
    </div>
  );
}
